import { db, handler, HttpError, getUser, requireUser, requirePerm, canAny, canView, newId, str, logQ } from '../lib/server.js';

/* Veiklos: komiteto veikla → užsiėmimai (datos) → lankomumo žymos.
   GET – visa matoma būsena; POST {action} – kūrimas, redagavimas, trynimas, žymėjimas.
   Leidimai (activities.*) ir prieiga prie komitetų tikrinami čia, serveryje. */

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUS = ['', 'P', 'A', 'L', 'E'];
const STATUS_LT = { P: 'Dalyvavo', A: 'Nedalyvavo', L: 'Vėlavo', E: 'Pateisinta', '': 'Žyma pašalinta' };
const MAX_REPEAT = 60;
const MAX_MARKS = 2000;

const uniq = (a) => [...new Set(a)];
const arr = (a) => (Array.isArray(a) ? a : []);
const needId = (v) => { if (!ID_RE.test(String(v))) throw new HttpError(400, 'Netinkami duomenys.'); return String(v); };
const seesClass = (me, cid) => me.classIds === null || me.classIds.includes(cid);
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const validDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && addDays(s, 0) === s;
const nm = (s) => [s.first, s.last].filter(Boolean).join(' ') || '?';
const timeOf = (from, to) => (from ? from + (to ? '–' + to : '') : '');

function parseTimes(body) {
  const from = str(body.from, 5), to = str(body.to, 5);
  if ((from && !TIME_RE.test(from)) || (to && !TIME_RE.test(to))) throw new HttpError(400, 'Netinkamas laikas.');
  if (to && !from) throw new HttpError(400, 'Nurodykite pradžios laiką.');
  if (from && to && to <= from) throw new HttpError(400, 'Pabaigos laikas turi būti vėlesnis už pradžios laiką.');
  return { from, to };
}
/* Pirma data + (neprivaloma) kartojimas kas savaitę iki nurodytos datos. */
function expandDates(d, until) {
  const out = [d];
  if (until && validDate(until) && until > d) {
    for (let x = addDays(d, 7); x <= until && out.length < MAX_REPEAT; x = addDays(x, 7)) out.push(x);
  }
  return out;
}

async function snapshot(sql, me) {
  const ids = me.classIds; // null = visi komitetai
  const [activities, links, sessions, records, people] = await Promise.all([
    sql`SELECT a.id, a.class_id AS "classId", a.name, a.description, a.place, a.teacher_id AS "teacherId", COALESCE(u.name, a.teacher_name) AS "teacherName"
      FROM activities a LEFT JOIN users u ON u.id = a.teacher_id
      WHERE (${ids}::text[] IS NULL OR a.class_id = ANY(${ids}::text[])) ORDER BY a.name`,
    sql`SELECT l.activity_id AS aid, l.student_id AS sid FROM activity_students l JOIN activities a ON a.id = l.activity_id
      WHERE (${ids}::text[] IS NULL OR a.class_id = ANY(${ids}::text[]))`,
    sql`SELECT s.id, s.activity_id AS aid, s.d, s.t_from AS "from", s.t_to AS "to", s.note FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
      WHERE (${ids}::text[] IS NULL OR a.class_id = ANY(${ids}::text[])) ORDER BY s.d, s.t_from`,
    sql`SELECT r.session_id AS ssid, r.student_id AS sid, r.s, r.n FROM activity_records r
      JOIN activity_sessions s ON s.id = r.session_id JOIN activities a ON a.id = s.activity_id
      WHERE (${ids}::text[] IS NULL OR a.class_id = ANY(${ids}::text[]))`,
    canAny(me, ['activities.create', 'activities.edit']) ? sql`SELECT id, name FROM users WHERE active ORDER BY name` : Promise.resolve([]),
  ]);
  const m = new Map();
  links.forEach((l) => { if (!m.has(l.aid)) m.set(l.aid, []); m.get(l.aid).push(l.sid); });
  return { activities: activities.map((a) => ({ ...a, studentIds: m.get(a.id) || [] })), sessions, records, people };
}

async function loadActivity(sql, me, id) {
  const [a] = await sql`SELECT a.id, a.class_id, a.name, a.description, a.place, a.teacher_id, a.teacher_name, c.name AS class_name
    FROM activities a JOIN classes c ON c.id = a.class_id WHERE a.id = ${id}`;
  if (!a) throw new HttpError(404, 'Veikla nerasta.');
  if (!seesClass(me, a.class_id)) throw new HttpError(403, 'Neturite prieigos prie šio komiteto.');
  return a;
}

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));

  if (req.method === 'GET') {
    if (!canView(me)) return { activities: [], sessions: [], records: [], people: [] };
    return snapshot(sql, me);
  }

  switch (body.action) {
    /* ---------- veikla: kurti / redaguoti ---------- */
    case 'activity-save': {
      const id = str(body.id, 40);
      const name = str(body.name, 150);
      if (!name) throw new HttpError(400, 'Įveskite veiklos pavadinimą.');
      const description = str(body.description, 2000), place = str(body.place, 150);
      let teacherId = str(body.teacherId, 40) || null, teacherName = str(body.teacherName, 100);
      if (teacherId) {
        const [u] = await sql`SELECT name FROM users WHERE id = ${teacherId} AND active`;
        if (!u) throw new HttpError(400, 'Pasirinktas mokytojas nerastas.');
        teacherName = u.name;
      }
      let ex = null, classId, className;
      if (id) {
        requirePerm(me, 'activities.edit');
        ex = await loadActivity(sql, me, id);
        classId = ex.class_id; className = ex.class_name;
      } else {
        requirePerm(me, 'activities.create');
        classId = str(body.classId, 40);
        const [c] = await sql`SELECT id, name FROM classes WHERE id = ${classId}`;
        if (!c) throw new HttpError(400, 'Pasirinkite komitetą.');
        if (!seesClass(me, classId)) throw new HttpError(403, 'Neturite prieigos prie šio komiteto.');
        className = c.name;
      }
      const wanted = uniq(arr(body.studentIds).map(needId));
      const sids = wanted.length ? (await sql`SELECT student_id AS id FROM student_classes WHERE class_id = ${classId} AND student_id = ANY(${wanted}::text[])`).map((r) => r.id) : [];
      if (wanted.length && !sids.length) throw new HttpError(400, 'Pasirinkti dalyviai nepriklauso šiam komitetui.');

      const q = [];
      const details = [];
      if (ex) {
        const old = (await sql`SELECT student_id AS id FROM activity_students WHERE activity_id = ${id}`).map((r) => r.id).sort().join();
        if (ex.name !== name) details.push(`pavadinimas: ${ex.name} → ${name}`);
        if (ex.description !== description) details.push('aprašymas pakeistas');
        if (ex.place !== place) details.push(`vieta: ${ex.place || '–'} → ${place || '–'}`);
        if ((ex.teacher_name || '') !== teacherName) details.push(`atsakingas: ${ex.teacher_name || '–'} → ${teacherName || '–'}`);
        if (old !== sids.slice().sort().join()) details.push(sids.length ? `dalyviai: ${sids.length}` : 'dalyviai: visi komiteto mokiniai');
        q.push(sql`UPDATE activities SET name = ${name}, description = ${description}, place = ${place}, teacher_id = ${teacherId}, teacher_name = ${teacherName} WHERE id = ${id}`);
        q.push(sql`DELETE FROM activity_students WHERE activity_id = ${id}`);
        if (sids.length) q.push(sql`INSERT INTO activity_students (activity_id, student_id) SELECT ${id}::text, x FROM unnest(${sids}::text[]) AS x`);
        if (details.length) q.push(logQ(sql, me, 'activities', `Atnaujinta veikla „${name}“ · ${className}`, details, null));
      } else {
        const nid = newId('a');
        q.push(sql`INSERT INTO activities (id, class_id, name, description, place, teacher_id, teacher_name, created_by)
          VALUES (${nid}, ${classId}, ${name}, ${description}, ${place}, ${teacherId}, ${teacherName}, ${me.id})`);
        if (sids.length) q.push(sql`INSERT INTO activity_students (activity_id, student_id) SELECT ${nid}::text, x FROM unnest(${sids}::text[]) AS x`);
        details.push(`Komitetas: ${className}`);
        if (teacherName) details.push(`Atsakingas: ${teacherName}`);
        if (place) details.push(`Vieta: ${place}`);
        details.push(sids.length ? `Dalyvių: ${sids.length}` : 'Dalyviai: visi komiteto mokiniai');
        const first = body.session && typeof body.session === 'object' ? body.session : null;
        if (first && str(first.d, 10)) {
          const d = str(first.d, 10);
          if (!validDate(d)) throw new HttpError(400, 'Netinkama data.');
          const { from, to } = parseTimes(first);
          const note = str(first.note, 500);
          const dates = expandDates(d, str(first.repeatUntil, 10));
          q.push(sql`INSERT INTO activity_sessions (id, activity_id, d, t_from, t_to, note)
            SELECT * FROM unnest(${dates.map(() => newId('s'))}::text[], ${dates.map(() => nid)}::text[], ${dates}::text[], ${dates.map(() => from)}::text[], ${dates.map(() => to)}::text[], ${dates.map(() => note)}::text[])`);
          details.push(dates.length === 1 ? `Užsiėmimas: ${d}${from ? ' ' + timeOf(from, to) : ''}` : `Užsiėmimų: ${dates.length} (${dates[0]} – ${dates[dates.length - 1]}, kas savaitę)`);
        }
        q.push(logQ(sql, me, 'activities', `Sukurta veikla „${name}“ · ${className}`, details, null));
      }
      await sql.transaction(q);
      return snapshot(sql, me);
    }

    case 'activity-delete': {
      requirePerm(me, 'activities.delete');
      const a = await loadActivity(sql, me, needId(body.id));
      const [{ ns, nr }] = await sql`SELECT (SELECT count(*)::int FROM activity_sessions WHERE activity_id = ${a.id}) AS ns,
        (SELECT count(*)::int FROM activity_records r JOIN activity_sessions s ON s.id = r.session_id WHERE s.activity_id = ${a.id}) AS nr`;
      await sql.transaction([
        sql`DELETE FROM activities WHERE id = ${a.id}`,
        logQ(sql, me, 'activities', `Ištrinta veikla „${a.name}“ · ${a.class_name}`, [`Pašalinta užsiėmimų: ${ns}`, `Pašalinta lankomumo žymų: ${nr}`], null),
      ]);
      return snapshot(sql, me);
    }

    /* ---------- užsiėmimai (datos) ---------- */
    case 'session-save': {
      const id = str(body.id, 40);
      const a = await loadActivity(sql, me, needId(body.activityId));
      const d = str(body.d, 10);
      if (!validDate(d)) throw new HttpError(400, 'Įveskite tinkamą datą.');
      const { from, to } = parseTimes(body);
      const note = str(body.note, 500);
      const label = `${d}${from ? ' ' + timeOf(from, to) : ''}`;
      if (id) {
        requirePerm(me, 'activities.edit');
        const [s] = await sql`SELECT id, d FROM activity_sessions WHERE id = ${id} AND activity_id = ${a.id}`;
        if (!s) throw new HttpError(404, 'Užsiėmimas nerastas.');
        await sql.transaction([
          sql`UPDATE activity_sessions SET d = ${d}, t_from = ${from}, t_to = ${to}, note = ${note} WHERE id = ${id}`,
          logQ(sql, me, 'activities', `Veikla „${a.name}“: pakeistas užsiėmimas ${s.d !== d ? s.d + ' → ' : ''}${label}`, note ? [`Aprašymas: ${note}`] : [], null),
        ]);
      } else {
        requirePerm(me, 'activities.create', 'activities.edit');
        const dates = expandDates(d, str(body.repeatUntil, 10));
        await sql.transaction([
          sql`INSERT INTO activity_sessions (id, activity_id, d, t_from, t_to, note)
            SELECT * FROM unnest(${dates.map(() => newId('s'))}::text[], ${dates.map(() => a.id)}::text[], ${dates}::text[], ${dates.map(() => from)}::text[], ${dates.map(() => to)}::text[], ${dates.map(() => note)}::text[])`,
          logQ(sql, me, 'activities', dates.length === 1 ? `Veikla „${a.name}“: pridėtas užsiėmimas ${label}` : `Veikla „${a.name}“: pridėta užsiėmimų: ${dates.length} (kas savaitę)`,
            dates.length === 1 ? (note ? [`Aprašymas: ${note}`] : []) : [`Nuo ${dates[0]} iki ${dates[dates.length - 1]}`], null),
        ]);
      }
      return snapshot(sql, me);
    }

    case 'session-delete': {
      requirePerm(me, 'activities.edit');
      const sid = needId(body.id);
      const [s] = await sql`SELECT s.id, s.d, s.t_from, s.t_to, s.activity_id FROM activity_sessions s WHERE s.id = ${sid}`;
      if (!s) return snapshot(sql, me);
      const a = await loadActivity(sql, me, s.activity_id);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM activity_records WHERE session_id = ${sid}`;
      await sql.transaction([
        sql`DELETE FROM activity_sessions WHERE id = ${sid}`,
        logQ(sql, me, 'activities', `Veikla „${a.name}“: ištrintas užsiėmimas ${s.d}${s.t_from ? ' ' + timeOf(s.t_from, s.t_to) : ''}`, [`Pašalinta lankomumo žymų: ${n}`], null),
      ]);
      return snapshot(sql, me);
    }

    /* ---------- lankomumo žymėjimas užsiėmime ---------- */
    case 'mark': {
      requirePerm(me, 'activities.mark');
      const ssid = needId(body.sessionId);
      const [s] = await sql`SELECT s.id, s.d, a.id AS aid, a.name AS aname, a.class_id AS cid, c.name AS cname
        FROM activity_sessions s JOIN activities a ON a.id = s.activity_id JOIN classes c ON c.id = a.class_id WHERE s.id = ${ssid}`;
      if (!s) throw new HttpError(404, 'Užsiėmimas nerastas.');
      if (!seesClass(me, s.cid)) throw new HttpError(403, 'Neturite prieigos prie šio komiteto.');
      const raw = arr(body.marks);
      if (raw.length > MAX_MARKS) throw new HttpError(400, 'Per daug pakeitimų vienu metu.');
      const marks = [...new Map(raw.map((x) => {
        const st = String(x && x.s || '');
        if (!STATUS.includes(st)) throw new HttpError(400, 'Netinkami duomenys.');
        return [needId(x && x.sid), { sid: String(x.sid), s: st, n: String(x.n == null ? '' : x.n).slice(0, 500) }];
      })).values()];
      if (!marks.length) return { ok: true };
      const sids = marks.map((x) => x.sid);

      /* Mokinys turi priklausyti komitetui ir (jei dalyviai apriboti) veiklos dalyvių sąrašui. */
      const ok = new Set((await sql`SELECT sc.student_id AS id FROM student_classes sc WHERE sc.class_id = ${s.cid} AND sc.student_id = ANY(${sids}::text[])
        AND (NOT EXISTS (SELECT 1 FROM activity_students x WHERE x.activity_id = ${s.aid})
          OR EXISTS (SELECT 1 FROM activity_students x WHERE x.activity_id = ${s.aid} AND x.student_id = sc.student_id))`).map((r) => r.id));
      if (marks.some((x) => (x.s || x.n) && !ok.has(x.sid))) throw new HttpError(400, 'Mokinys nepriklauso šiai veiklai.');
      const valid = marks.filter((x) => ok.has(x.sid) || (!x.s && !x.n));

      const before = new Map((await sql`SELECT student_id AS sid, s, n FROM activity_records WHERE session_id = ${ssid} AND student_id = ANY(${sids}::text[])`).map((r) => [r.sid, r]));
      const ups = [], dels = [];
      valid.forEach((x) => {
        const b = before.get(x.sid);
        if (!x.s && !x.n) { if (b) dels.push(x); return; }
        if (b && b.s === x.s && b.n === x.n) return;
        ups.push(x);
      });
      if (!ups.length && !dels.length) return { ok: true };

      const changed = [...ups, ...dels];
      const names = new Map((await sql`SELECT id, first_name AS first, last_name AS last FROM students WHERE id = ANY(${changed.map((x) => x.sid)}::text[])`).map((r) => [r.id, nm(r)]));
      const lines = changed.slice(0, 80).map((x) => {
        const b = before.get(x.sid);
        const label = !x.s && !x.n ? 'žyma pašalinta' : (b && b.s === x.s && b.n !== x.n ? (x.n ? 'pastaba: ' + x.n : 'pastaba pašalinta') : STATUS_LT[x.s] + (x.n && x.s ? ` (${x.n})` : ''));
        return `${names.get(x.sid) || x.sid} – ${label} · ${s.aname}, ${s.d}`;
      });
      if (changed.length > 80) lines.push(`…ir dar ${changed.length - 80}`);
      const summary = changed.length === 1 ? lines[0] : `Veiklos „${s.aname}“ lankomumas ${s.d} – žymų: ${changed.length}`;

      const q = [];
      if (ups.length) q.push(sql`INSERT INTO activity_records (session_id, student_id, s, n)
        SELECT ${ssid}::text, t.sid, t.s, t.n FROM unnest(${ups.map((x) => x.sid)}::text[], ${ups.map((x) => x.s)}::text[], ${ups.map((x) => x.n)}::text[]) AS t(sid, s, n)
        ON CONFLICT (session_id, student_id) DO UPDATE SET s = EXCLUDED.s, n = EXCLUDED.n`);
      if (dels.length) q.push(sql`DELETE FROM activity_records WHERE session_id = ${ssid} AND student_id = ANY(${dels.map((x) => x.sid)}::text[])`);
      q.push(logQ(sql, me, 'activities', summary, changed.length === 1 ? [] : lines, null));
      await sql.transaction(q);
      return { ok: true };
    }

    default:
      throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});