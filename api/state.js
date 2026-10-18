import { db, handler, HttpError, getUser, can, canAny, canView, requireUser } from '../lib/server.js';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = ['', 'P', 'A', 'L', 'E'];
const MAX_OPS = 20000;
const text = (v, max) => String(v == null ? '' : v).slice(0, max);
const needId = (v) => { if (!ID_RE.test(String(v))) throw new HttpError(400, 'Netinkami duomenys.'); return String(v); };

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));

  if (req.method === 'GET') {
    if (!canView(me)) return { classes: [], students: [], records: [] };
    const ids = me.classIds; // null = visos klasės
    const [classes, students, records] = await Promise.all([
      sql`SELECT id, name FROM classes WHERE (${ids}::text[] IS NULL OR id = ANY(${ids}::text[])) ORDER BY name`,
      sql`SELECT id, class_id AS "classId", first_name AS first, last_name AS last, email, parent_email AS "parentEmail", notes FROM students WHERE (${ids}::text[] IS NULL OR class_id = ANY(${ids}::text[]))`,
      sql`SELECT class_id AS c, d, student_id AS sid, s, n FROM records WHERE (${ids}::text[] IS NULL OR class_id = ANY(${ids}::text[]))`,
    ]);
    return { classes, students, records };
  }

  /* Pakeitimai: kliento siunčiamas skirtumas nuo paskutinės serverio būsenos. Kiekvienas veiksmas tikrinamas pagal leidimus. */
  const o = body.ops || {};
  const g = (k) => (o[k] && typeof o[k] === 'object' ? o[k] : {});
  const arr = (a) => (Array.isArray(a) ? a : []);
  const c = g('classes'), s = g('students'), r = g('records');
  const total = arr(c.up).length + arr(c.del).length + arr(s.up).length + arr(s.del).length + arr(r.up).length + arr(r.del).length;
  if (!total) return { ok: true };
  if (total > MAX_OPS) throw new HttpError(400, 'Per daug pakeitimų vienu metu.');

  const need = (list, items) => { if (arr(items).length && !canAny(me, list)) throw new HttpError(403, 'Neturite teisės atlikti šio pakeitimo.'); };
  need(['classes.manage', 'data.restore'], c.up);
  need(['classes.manage', 'data.restore', 'data.wipe'], c.del);
  need(['students.edit', 'students.import', 'data.restore'], s.up);
  need(['students.delete', 'classes.manage', 'data.restore', 'data.wipe'], s.del);
  need(['attendance.mark', 'data.restore'], r.up);
  need(['attendance.mark', 'students.delete', 'classes.manage', 'data.restore', 'data.wipe'], r.del);

  const cUp = arr(c.up).map((x) => ({ id: needId(x.id), name: text(x.name, 200) }));
  const sUp = arr(s.up).map((x) => ({ id: needId(x.id), cid: needId(x.classId), first: text(x.first, 200), last: text(x.last, 200), email: text(x.email, 200), parent: text(x.parentEmail, 200), notes: text(x.notes, 2000) }));
  const rUp = arr(r.up).map((x) => {
    if (!DATE_RE.test(String(x.d)) || !STATUS.includes(String(x.s || ''))) throw new HttpError(400, 'Netinkami duomenys.');
    return { c: needId(x.c), d: String(x.d), sid: needId(x.sid), s: String(x.s || ''), n: text(x.n, 500) };
  });
  const cDel = arr(c.del).map(needId);
  const sDel = arr(s.del).map(needId);
  const rDel = arr(r.del).map((x) => { if (!DATE_RE.test(String(x.d))) throw new HttpError(400, 'Netinkami duomenys.'); return { c: needId(x.c), d: String(x.d), sid: needId(x.sid) }; });

  /* Apribotų vartotojų (be leidimo „Matyti visas klases“) pakeitimai leidžiami tik jų klasėms. Naujai sukurta klasė priskiriama kūrėjui. */
  const q = [];
  if (me.classIds !== null) {
    const deny = () => { throw new HttpError(403, 'Neturite prieigos prie šios klasės.'); };
    const have = new Set(me.classIds);
    const exC = new Set((await sql`SELECT id FROM classes WHERE id = ANY(${cUp.map((x) => x.id)}::text[])`).map((x) => x.id));
    const fresh = cUp.filter((x) => !exC.has(x.id)).map((x) => x.id);
    cUp.forEach((x) => { if (exC.has(x.id) && !have.has(x.id)) deny(); });
    const ok = (cid) => have.has(cid) || fresh.includes(cid);
    const sIds = [...new Set([...sUp.map((x) => x.id), ...sDel])];
    const exS = new Map((await sql`SELECT id, class_id FROM students WHERE id = ANY(${sIds}::text[])`).map((x) => [x.id, x.class_id]));
    sUp.forEach((x) => { if (!ok(x.cid) || (exS.has(x.id) && !have.has(exS.get(x.id)))) deny(); });
    sDel.forEach((id) => { if (exS.has(id) && !have.has(exS.get(id))) deny(); });
    cDel.forEach((id) => { if (!have.has(id)) deny(); });
    rUp.forEach((x) => { if (!ok(x.c)) deny(); });
    rDel.forEach((x) => { if (!have.has(x.c)) deny(); });
    if (fresh.length) q.push(sql`UPDATE users SET class_ids = COALESCE(class_ids, '[]'::jsonb) || ${JSON.stringify(fresh)}::jsonb WHERE id = ${me.id}`);
  }
  if (cUp.length) q.push(sql`INSERT INTO classes (id, name) SELECT * FROM unnest(${cUp.map((x) => x.id)}::text[], ${cUp.map((x) => x.name)}::text[])
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
  if (sUp.length) q.push(sql`INSERT INTO students (id, class_id, first_name, last_name, email, parent_email, notes)
    SELECT t.* FROM unnest(${sUp.map((x) => x.id)}::text[], ${sUp.map((x) => x.cid)}::text[], ${sUp.map((x) => x.first)}::text[], ${sUp.map((x) => x.last)}::text[],
      ${sUp.map((x) => x.email)}::text[], ${sUp.map((x) => x.parent)}::text[], ${sUp.map((x) => x.notes)}::text[]) AS t(id, cid, f, l, e, p, n)
    WHERE EXISTS (SELECT 1 FROM classes WHERE classes.id = t.cid)
    ON CONFLICT (id) DO UPDATE SET class_id = EXCLUDED.class_id, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
      email = EXCLUDED.email, parent_email = EXCLUDED.parent_email, notes = EXCLUDED.notes`);
  if (rUp.length) q.push(sql`INSERT INTO records (class_id, d, student_id, s, n)
    SELECT t.* FROM unnest(${rUp.map((x) => x.c)}::text[], ${rUp.map((x) => x.d)}::text[], ${rUp.map((x) => x.sid)}::text[], ${rUp.map((x) => x.s)}::text[], ${rUp.map((x) => x.n)}::text[]) AS t(c, d, sid, s, n)
    WHERE EXISTS (SELECT 1 FROM students WHERE students.id = t.sid AND students.class_id = t.c)
    ON CONFLICT (class_id, d, student_id) DO UPDATE SET s = EXCLUDED.s, n = EXCLUDED.n`);
  if (rDel.length) q.push(sql`DELETE FROM records USING unnest(${rDel.map((x) => x.c)}::text[], ${rDel.map((x) => x.d)}::text[], ${rDel.map((x) => x.sid)}::text[]) AS t(c, d, sid)
    WHERE records.class_id = t.c AND records.d = t.d AND records.student_id = t.sid`);
  if (sDel.length) q.push(sql`DELETE FROM students WHERE id = ANY(${sDel}::text[])`);
  if (cDel.length) q.push(sql`DELETE FROM classes WHERE id = ANY(${cDel}::text[])`);
  if (q.length) await sql.transaction(q);
  return { ok: true };
});
