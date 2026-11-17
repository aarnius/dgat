import { db, handler, HttpError, getUser, requireUser, requirePerm, logEvent, newId, str } from '../lib/server.js';

/* REGISTRAS: visų dokumentų (įspėjimų, priėmimo, išėjimo, pokalbių ir t. t.) numeracija. sys_no – bendras sistemos numeris, doc_no – numeris pagal tipą ir metus. */
const KINDS = { warn: 'ISP', talk: 'MP', remove: 'NP', join: 'PRM', rejoin: 'PA', leave: 'NI', cert: 'PZ', minutes: 'PR', plan: 'PLN', other: 'KT' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const needDate = (v) => { if (!DATE_RE.test(String(v))) throw new HttpError(400, 'Netinkama data.'); return String(v); };
const schoolYearEnd = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return `${m >= 9 ? y + 1 : y}-08-31`; };

async function listRows(sql) {
  return sql`SELECT id, sys_no AS "sysNo", kind, year, doc_no AS "docNo", to_char(doc_date,'YYYY-MM-DD') AS "date", student_id AS "studentId", student_name AS "name", grade, reasons, details,
    to_char(valid_until,'YYYY-MM-DD') AS "validUntil", status, void_reason AS "voidReason", created_by_name AS "by", created_at AS "createdAt"
    FROM register_entries ORDER BY sys_no DESC LIMIT 5000`;
}

const pad = (n) => String(n).padStart(3, '0');
const needDocNo = (v) => {
  const x = str(v, 30).toUpperCase().replace(/\s+/g, '');
  if (!/^[\p{L}\p{N}._\/-]{2,30}$/u.test(x)) throw new HttpError(400, 'Netinkamas numeris (pvz. ISP-004).');
  return x;
};

async function issue(sql, me, e, st) {
  const kind = String(e.kind);
  if (!KINDS[kind]) throw new HttpError(400, 'Nežinomas tipas.');
  const date = needDate(e.date), year = +date.slice(0, 4), prefix = KINDS[kind];
  const reasons = (Array.isArray(e.reasons) ? e.reasons : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 20);
  const details = str(e.details, 2000);
  const validUntil = e.validUntil ? needDate(e.validUntil) : (kind === 'warn' ? schoolYearEnd(date) : null);
  const manual = e.docNo ? needDocNo(e.docNo) : '';
  const id = newId('r');
  for (let i = 0; i < 6; i++) {
    let docNo = manual, seq = null;
    if (manual) {
      const m = new RegExp('^' + prefix + '-(\\d+)$').exec(manual);
      if (m) seq = +m[1];
    } else {
      const [{ n }] = await sql`SELECT COALESCE(MAX(seq),0) AS n FROM register_entries WHERE kind = ${kind}`;
      let k = +n + 1;
      for (;;) { const [x] = await sql`SELECT 1 AS x FROM register_entries WHERE doc_no = ${prefix + '-' + pad(k)}`; if (!x) break; k++; }
      seq = k; docNo = prefix + '-' + pad(k);
    }
    try {
      const [r] = await sql`INSERT INTO register_entries (id, sys_no, kind, year, seq, doc_no, doc_date, student_id, student_name, grade, reasons, details, valid_until, created_by, created_by_name)
        VALUES (${id}, (SELECT COALESCE(MAX(sys_no),0)+1 FROM register_entries), ${kind}, ${year}::int, ${seq}, ${docNo}, ${date}::date, ${st ? st.id : null}, ${st ? st.name : str(e.name, 200)}, ${st ? st.grade : ''},
          ${reasons}::text[], ${details}, ${validUntil}::date, ${me.id}, ${me.name})
        RETURNING id, sys_no AS "sysNo", doc_no AS "docNo"`;
      return r;
    } catch (err) {
      if (String(err && err.code) === '23505' && manual && i === 0) {
        const [dup] = await sql`SELECT 1 AS x FROM register_entries WHERE doc_no = ${manual}`;
        if (dup) throw new HttpError(409, 'Numeris ' + manual + ' jau panaudotas.');
      }
      if (String(err && err.code) !== '23505' || i === 5) throw err;
    }
  }
}

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));
  requirePerm(me, 'register.view');
  if (req.method === 'GET') return { entries: await listRows(sql) };
  requirePerm(me, 'register.edit');

  switch (body.action) {
    case 'issue': {
      const items = Array.isArray(body.items) && body.items.length ? body.items.slice(0, 200) : [{}];
      if (body.docNo && items.length > 1) throw new HttpError(400, 'Rankiniu būdu galima įrašyti tik vieną numerį – pasirinkite vieną narį arba numerius generuokite automatiškai.');
      const out = [];
      for (const it of items) {
        let st = null;
        if (it.studentId) {
          const [s] = await sql`SELECT id, last_name || ' ' || first_name AS name, grade FROM students WHERE id = ${String(it.studentId)}`;
          if (!s) throw new HttpError(404, 'Narys nerastas.');
          st = { id: s.id, name: s.name, grade: s.grade || '' };
        }
        const r = await issue(sql, me, { ...body, name: it.name }, st);
        out.push(r);
        await logEvent(sql, me, 'register', `Registras: ${r.docNo}${st ? ' – ' + st.name : ''}`, { kind: body.kind, sysNo: r.sysNo });
      }
      return { ok: true, issued: out, entries: await listRows(sql) };
    }
    case 'update': {
      const id = str(body.id, 40);
      const reasons = (Array.isArray(body.reasons) ? body.reasons : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 20);
      const vu = body.validUntil ? needDate(body.validUntil) : null;
      let docNo = null;
      if (body.docNo) {
        docNo = needDocNo(body.docNo);
        const [dup] = await sql`SELECT 1 AS x FROM register_entries WHERE doc_no = ${docNo} AND id <> ${id}`;
        if (dup) throw new HttpError(409, 'Numeris ' + docNo + ' jau panaudotas.');
      }
      const [r] = await sql`UPDATE register_entries SET doc_no = COALESCE(${docNo}, doc_no), reasons = ${reasons}::text[], details = ${str(body.details, 2000)}, doc_date = ${needDate(body.date)}::date, valid_until = ${vu}::date WHERE id = ${id} RETURNING doc_no`;
      if (!r) throw new HttpError(404, 'Įrašas nerastas.');
      await logEvent(sql, me, 'register', `Registras: pakeistas ${r.doc_no}`, { id });
      return { ok: true, entries: await listRows(sql) };
    }
    case 'void': case 'restore': {
      const id = str(body.id, 40), v = body.action === 'void';
      if (v && !str(body.reason, 300)) throw new HttpError(400, 'Nurodykite panaikinimo priežastį.');
      const [r] = await sql`UPDATE register_entries SET status = ${v ? 'void' : 'active'}, void_reason = ${v ? str(body.reason, 300) : ''} WHERE id = ${id} RETURNING doc_no`;
      if (!r) throw new HttpError(404, 'Įrašas nerastas.');
      await logEvent(sql, me, 'register', `Registras: ${v ? 'panaikintas' : 'atkurtas'} ${r.doc_no}`, { id });
      return { ok: true, entries: await listRows(sql) };
    }
    default: throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});
