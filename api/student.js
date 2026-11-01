/* Mokinių prieiga.
   Mokiniai (be paskyros):  GET → mano duomenys · POST login {email, code} · POST logout
   Darbuotojai (leidimas students.access):  POST status · issue {ids} (sukuria kodą ir išsiunčia laišku) · revoke {ids}
   Kodas = 8 simboliai (XXXX-XXXX), DB saugoma tik jo maiša. Galioja 90 dienų, naujas kodas pakeičia seną. */
import crypto from 'node:crypto';
import { db, handler, HttpError, getUser, requirePerm, str, logEvent, codeHash, safeEq, studentCookie, clearStudentCookie, readStudentSid } from '../lib/server.js';
import { transport, sendMail } from '../lib/mail.js';

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_BATCH = 15;
const MAX_PHOTO = 120000; /* simboliais (base64), ~90 KB; naršyklė sumažina iki 256×256 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* 32 simboliai, be painiojamų (I, O, 0, 1) */
const RISK_RATE = 80, RISK_MIN = 3, RISK_STREAK = 3;

function newCode() {
  let s = '';
  for (const b of crypto.randomBytes(8)) s += ALPHABET[b & 31];
  return s;
}
const showCode = (c) => c.slice(0, 4) + '-' + c.slice(4);
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';

/* ---------- bandymų ribojimas (ta pati lentelė kaip darbuotojų prisijungime) ---------- */
async function lockedFor(sql, keys) {
  for (const key of keys) {
    const [l] = await sql`SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - now()))))::int AS wait FROM login_attempts WHERE key = ${key}`;
    if (l && l.wait > 0) throw new HttpError(429, `Per daug bandymų. Palaukite ${l.wait} s.`);
  }
}
async function failFor(sql, key, limit) {
  await sql`INSERT INTO login_attempts (key, count) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET count = login_attempts.count + 1,
    locked_until = CASE WHEN login_attempts.count + 1 >= ${limit} THEN now() + interval '60 seconds' ELSE login_attempts.locked_until END`;
}

/* ---------- mokinio duomenys (tik jo paties) ---------- */
const rateOf = (t) => { const den = t.P + t.L + t.A; return den ? Math.round(((t.P + t.L) / den) * 100) : null; };

async function myData(sql, sid) {
  const [ok] = await sql`SELECT 1 AS x FROM student_codes WHERE student_id = ${sid} AND created_at > now() - interval '90 days'`;
  if (!ok) return null;
  const [s] = await sql`SELECT first_name AS first, last_name AS last, grade FROM students WHERE id = ${sid}`;
  if (!s) return null;
  const [coms, recs, arecs, upcoming, [{ today }], photo] = await Promise.all([
    sql`SELECT c.id, c.name FROM student_classes sc JOIN classes c ON c.id = sc.class_id WHERE sc.student_id = ${sid}`,
    sql`SELECT r.class_id AS c, r.d, r.s, r.by_name AS by, r.marked_at AS at FROM records r WHERE r.student_id = ${sid} AND r.s <> ''
        AND r.class_id IN (SELECT class_id FROM student_classes WHERE student_id = ${sid})`,
    sql`SELECT a.class_id AS c, a.name AS act, ses.d, ar.s, ar.by_name AS by, ar.marked_at AS at FROM activity_records ar
        JOIN activity_sessions ses ON ses.id = ar.session_id JOIN activities a ON a.id = ses.activity_id
        WHERE ar.student_id = ${sid} AND ar.s <> '' AND a.class_id IN (SELECT class_id FROM student_classes WHERE student_id = ${sid})`,
    sql`SELECT ses.d, ses.t_from AS "from", ses.t_to AS "to", a.name, a.place, c.name AS com
        FROM activity_sessions ses JOIN activities a ON a.id = ses.activity_id JOIN classes c ON c.id = a.class_id
        WHERE ses.d >= (now() AT TIME ZONE 'Europe/Vilnius')::date::text
          AND a.class_id IN (SELECT class_id FROM student_classes WHERE student_id = ${sid})
          AND (NOT EXISTS (SELECT 1 FROM activity_students x WHERE x.activity_id = a.id)
               OR EXISTS (SELECT 1 FROM activity_students x WHERE x.activity_id = a.id AND x.student_id = ${sid}))
        ORDER BY ses.d, ses.t_from LIMIT 8`,
    sql`SELECT (now() AT TIME ZONE 'Europe/Vilnius')::date::text AS today`,
    sql`SELECT extract(epoch FROM updated_at)::bigint AS t FROM student_photos WHERE student_id = ${sid}`,
  ]);
  const per = new Map(coms.map((c) => [c.id, { name: c.name, P: 0, A: 0, L: 0, E: 0 }]));
  const seq = [], hist = [];
  const add = (c, d, st, act, by, at) => {
    const x = per.get(c);
    if (!x || !['P', 'A', 'L', 'E'].includes(st)) return;
    x[st]++; seq.push([d, st]); hist.push({ d, c: x.name, a: act || '', s: st, by: by || '', at: at || null });
  };
  recs.forEach((r) => add(r.c, r.d, r.s, '', r.by, r.at));
  arecs.forEach((r) => add(r.c, r.d, r.s, r.act, r.by, r.at));
  const committees = [...per.values()].sort((a, b) => a.name.localeCompare(b.name, 'lt', { numeric: true })).map((x) => ({ ...x, rate: rateOf(x) }));
  const total = { P: 0, A: 0, L: 0, E: 0 };
  committees.forEach((x) => ['P', 'A', 'L', 'E'].forEach((k) => { total[k] += x[k]; }));
  total.rate = rateOf(total);
  /* „Iš eilės“: pateisintos dienos serijos nenutraukia (kaip ir darbuotojų rizikos sąraše). */
  seq.sort((a, b) => a[0].localeCompare(b[0]));
  let streak = 0;
  for (let i = seq.length - 1; i >= 0; i--) { if (seq[i][1] === 'A') streak++; else if (seq[i][1] === 'E') continue; else break; }
  const den = total.P + total.L + total.A;
  hist.sort((a, b) => b.d.localeCompare(a.d));
  return {
    id: sid, photo: photo[0] ? Number(photo[0].t) : 0,
    name: [s.first, s.last].filter(Boolean).join(' '), grade: s.grade || '', today,
    total, committees, streak,
    risk: { low: total.rate != null && total.rate < RISK_RATE && den >= RISK_MIN, streak: streak >= RISK_STREAK ? streak : 0, limit: RISK_RATE },
    history: hist.slice(0, 80), upcoming,
  };
}

export default handler(async (req, res, body) => {
  const sql = db();

  /* ----- mokinys: savo duomenys ----- */
  if (req.method === 'GET') {
    const sid = readStudentSid(req);
    return { student: sid ? await myData(sql, sid) : null };
  }

  switch (body.action) {
    case 'login': {
      const email = str(body.email, 200).toLowerCase(), code = normCode(body.code);
      if (!EMAIL_RE.test(email) || code.length !== 8) throw new HttpError(400, 'Įveskite el. paštą ir 8 simbolių kodą iš laiško.');
      const kE = 's:' + email, kI = 'ip:' + ipOf(req);
      await lockedFor(sql, [kE, kI]);
      const rows = await sql`SELECT s.id, c.code_hash FROM students s JOIN student_codes c ON c.student_id = s.id
        WHERE lower(trim(s.email)) = ${email} AND c.created_at > now() - interval '90 days'`;
      const hit = rows.find((r) => safeEq(r.code_hash, codeHash(r.id, code)));
      if (!hit) {
        await failFor(sql, kE, 5); await failFor(sql, kI, 20);
        throw new HttpError(401, 'Neteisingas el. paštas arba kodas. Kodą gausite iš administratoriaus.');
      }
      await sql`DELETE FROM login_attempts WHERE key = ANY(${[kE, kI]}::text[])`;
      res.setHeader('Set-Cookie', studentCookie(hit.id));
      return { ok: true };
    }

    case 'logout':
      res.setHeader('Set-Cookie', clearStudentCookie());
      return { ok: true };

    /* ----- darbuotojai, turintys leidimą ----- */
    case 'status': {
      const me = await getUser(req); requirePerm(me, 'students.access');
      const scope = me.classIds;
      const rows = await sql`SELECT c.student_id AS id, c.sent_at AS "sentAt", c.created_at AS "createdAt" FROM student_codes c
        WHERE ${scope}::text[] IS NULL OR EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = c.student_id AND sc.class_id = ANY(${scope}::text[]))`;
      return { codes: Object.fromEntries(rows.map((r) => [r.id, { sentAt: r.sentAt, createdAt: r.createdAt }])) };
    }

    case 'issue': {
      const me = await getUser(req); requirePerm(me, 'students.access');
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => ID_RE.test(x)))];
      if (!ids.length) throw new HttpError(400, 'Nepasirinkta mokinių.');
      if (ids.length > MAX_BATCH) throw new HttpError(400, `Vienu metu galima išsiųsti ne daugiau kaip ${MAX_BATCH} kodų.`);
      const scope = me.classIds;
      const rows = await sql`SELECT s.id, s.first_name AS first, s.last_name AS last, s.email FROM students s
        WHERE s.id = ANY(${ids}::text[]) AND (${scope}::text[] IS NULL OR EXISTS
          (SELECT 1 FROM student_classes sc WHERE sc.student_id = s.id AND sc.class_id = ANY(${scope}::text[])))`;
      const base = (process.env.PUBLIC_URL || ('https://' + req.headers.host)).replace(/\/+$/, '');
      const sent = [], failed = [], skipped = [];
      const found = new Set(rows.map((r) => r.id));
      ids.forEach((id) => { if (!found.has(id)) skipped.push({ id, name: '?', reason: 'mokinys nerastas arba nėra prieigos' }); });
      const queue = [];
      rows.forEach((s) => {
        const name = [s.first, s.last].filter(Boolean).join(' ') || '?';
        if (!EMAIL_RE.test((s.email || '').trim())) skipped.push({ id: s.id, name, reason: 'nėra el. pašto' });
        else queue.push({ s, name, to: s.email.trim() });
      });
      const tx = queue.length ? transport() : null;
      for (let i = 0; i < queue.length; i += 3) {
        await Promise.all(queue.slice(i, i + 3).map(async ({ s, name, to }) => {
          const code = newCode();
          try {
            await sql`INSERT INTO student_codes (student_id, code_hash, created_at, sent_at, created_by_name)
              VALUES (${s.id}, ${codeHash(s.id, code)}, now(), NULL, ${me.name})
              ON CONFLICT (student_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, created_at = now(), sent_at = NULL, created_by_name = EXCLUDED.created_by_name`;
            const text = `Sveiki, ${s.first || ''}!\n\nČia jūsų prisijungimo duomenys, kuriais galite pasižiūrėti savo lankomumą:\n\n` +
              `Puslapis: ${base}/mano\nEl. paštas: ${to}\nKodas: ${showCode(code)}\n\n` +
              `Kodas galioja 90 dienų. Nesidalinkite juo su kitais. Jei šio laiško nelaukėte, tiesiog jo nepaisykite.\n\nMokinių taryba`;
            await sendMail(tx, to, 'Jūsų lankomumo peržiūros kodas', text);
            await sql`UPDATE student_codes SET sent_at = now() WHERE student_id = ${s.id}`;
            sent.push({ id: s.id, name });
          } catch (e) {
            console.error('student code', s.id, e.message);
            try { await sql`DELETE FROM student_codes WHERE student_id = ${s.id}`; } catch (e2) { /* ignore */ }
            failed.push({ id: s.id, name, error: String(e.response || e.message || 'SMTP klaida').slice(0, 160) });
          }
        }));
      }
      if (sent.length || failed.length) {
        await logEvent(sql, me, 'email', `Išsiųsti mokinių prisijungimo kodai: ${sent.length}${failed.length ? `, nepavyko: ${failed.length}` : ''}`,
          [...sent.map((x) => 'Išsiųsta: ' + x.name), ...failed.map((x) => `Nepavyko: ${x.name} (${x.error})`)]);
      }
      return { ok: true, sent, failed, skipped };
    }

    case 'revoke': {
      const me = await getUser(req); requirePerm(me, 'students.access');
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => ID_RE.test(x)))].slice(0, 500);
      if (!ids.length) throw new HttpError(400, 'Nepasirinkta mokinių.');
      const scope = me.classIds;
      const gone = await sql`DELETE FROM student_codes c WHERE c.student_id = ANY(${ids}::text[]) AND (${scope}::text[] IS NULL OR EXISTS
        (SELECT 1 FROM student_classes sc WHERE sc.student_id = c.student_id AND sc.class_id = ANY(${scope}::text[]))) RETURNING c.student_id`;
      if (gone.length) await logEvent(sql, me, 'email', `Atšaukta mokinių prieiga: ${gone.length}`);
      return { ok: true, revoked: gone.length };
    }

    /* ----- profilio nuotraukos ----- */
    case 'photo-save': {
      const me = await getUser(req); requirePerm(me, 'students.photo');
      const id = str(body.id, 40);
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
      if (!ID_RE.test(id) || !m) throw new HttpError(400, 'Netinkama nuotrauka.');
      if (m[1].length > MAX_PHOTO) throw new HttpError(400, 'Nuotrauka per didelė.');
      if (Buffer.from(m[1].slice(0, 8), 'base64')[0] !== 0xff) throw new HttpError(400, 'Netinkama nuotrauka (reikia JPEG).');
      const scope = me.classIds;
      const [s] = await sql`SELECT s.id, s.first_name AS first, s.last_name AS last FROM students s WHERE s.id = ${id} AND (${scope}::text[] IS NULL OR EXISTS
        (SELECT 1 FROM student_classes sc WHERE sc.student_id = s.id AND sc.class_id = ANY(${scope}::text[])))`;
      if (!s) throw new HttpError(404, 'Mokinys nerastas arba nėra prieigos.');
      await sql`INSERT INTO student_photos (student_id, data, updated_at) VALUES (${id}, ${m[1]}, now())
        ON CONFLICT (student_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      await logEvent(sql, me, 'students', `Pakeista mokinio nuotrauka: ${[s.first, s.last].filter(Boolean).join(' ')}`);
      return { ok: true };
    }
    case 'photo-delete': {
      const me = await getUser(req); requirePerm(me, 'students.photo');
      const id = str(body.id, 40);
      if (!ID_RE.test(id)) throw new HttpError(400, 'Netinkami duomenys.');
      const scope = me.classIds;
      const gone = await sql`DELETE FROM student_photos p WHERE p.student_id = ${id} AND (${scope}::text[] IS NULL OR EXISTS
        (SELECT 1 FROM student_classes sc WHERE sc.student_id = p.student_id AND sc.class_id = ANY(${scope}::text[]))) RETURNING p.student_id`;
      if (gone.length) await logEvent(sql, me, 'students', 'Pašalinta mokinio nuotrauka');
      return { ok: true };
    }

    default:
      throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});
