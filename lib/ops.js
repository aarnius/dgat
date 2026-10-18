/* Pakeitimų taikymas: tikrina leidimus, įrašo į DB, suformuoja LOG įrašą ir „Undo“ duomenis (atvirkštinius pakeitimus). */
import { HttpError, canAny, logQ } from './server.js';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = ['', 'P', 'A', 'L', 'E'];
const STATUS_LT = { P: 'Dalyvavo', A: 'Nedalyvavo', L: 'Vėlavo', E: 'Pateisinta', '': 'Žyma pašalinta' };
const MAX_OPS = 20000;
const MAX_UNDO = 30000;
const text = (v, max) => String(v == null ? '' : v).slice(0, max);
const needId = (v) => { if (!ID_RE.test(String(v))) throw new HttpError(400, 'Netinkami duomenys.'); return String(v); };
const arr = (a) => (Array.isArray(a) ? a : []);
const uniq = (a) => [...new Set(a)];
/* Vienas INSERT … ON CONFLICT DO UPDATE negali dukart liesti tos pačios eilutės, todėl pasikartojimai pašalinami (galioja paskutinis). */
const dd = (l, k) => [...new Map(l.map((x) => [k(x), x])).values()];
const nm = (s) => [s.first, s.last].filter(Boolean).join(' ') || '?';

/* opts: tag (žyma LOG įraše), skipNeed (atšaukimui), undoOf (LOG įrašo id, kuris pažymimas kaip atšauktas), summary (pilnas pavadinimas vietoj sugeneruoto) */
export async function applyOps(sql, me, o, opts = {}) {
  o = o && typeof o === 'object' ? o : {};
  const g = (k) => (o[k] && typeof o[k] === 'object' ? o[k] : {});
  const c = g('classes'), s = g('students'), r = g('records');
  const total = arr(c.up).length + arr(c.del).length + arr(s.up).length + arr(s.del).length + arr(r.up).length + arr(r.del).length;
  if (!total) return false;
  if (total > MAX_OPS) throw new HttpError(400, 'Per daug pakeitimų vienu metu.');

  if (!opts.skipNeed) {
    const need = (list, items) => { if (arr(items).length && !canAny(me, list)) throw new HttpError(403, 'Neturite teisės atlikti šio pakeitimo.'); };
    need(['classes.manage', 'data.restore'], c.up);
    need(['classes.manage', 'data.restore', 'data.wipe'], c.del);
    need(['students.edit', 'students.import', 'data.restore'], s.up);
    need(['students.delete', 'classes.manage', 'data.restore', 'data.wipe'], s.del);
    need(['attendance.mark', 'data.restore'], r.up);
    need(['attendance.mark', 'students.delete', 'classes.manage', 'data.restore', 'data.wipe'], r.del);
  }

  const cUp = arr(c.up).map((x) => ({ id: needId(x.id), name: text(x.name, 200) }));
  const sUp = arr(s.up).map((x) => {
    const ids = Array.isArray(x.classIds) ? x.classIds : (x.classId ? [x.classId] : []);
    const classIds = uniq(ids.map(needId));
    if (!classIds.length) throw new HttpError(400, 'Mokinys turi priklausyti bent vienam komitetui.');
    return { id: needId(x.id), classIds, first: text(x.first, 200), last: text(x.last, 200), email: text(x.email, 200), parentEmail: text(x.parentEmail, 200), notes: text(x.notes, 2000), grade: text(x.grade, 50) };
  });
  const rUp = arr(r.up).map((x) => {
    if (!DATE_RE.test(String(x.d)) || !STATUS.includes(String(x.s || ''))) throw new HttpError(400, 'Netinkami duomenys.');
    return { c: needId(x.c), d: String(x.d), sid: needId(x.sid), s: String(x.s || ''), n: text(x.n, 500) };
  });
  const cDel = uniq(arr(c.del).map(needId));
  const sDel = uniq(arr(s.del).map(needId));
  const rDel = arr(r.del).map((x) => { if (!DATE_RE.test(String(x.d))) throw new HttpError(400, 'Netinkami duomenys.'); return { c: needId(x.c), d: String(x.d), sid: needId(x.sid) }; });

  const rk = (x) => x.c + '|' + x.d + '|' + x.sid;
  cUp.splice(0, cUp.length, ...dd(cUp, (x) => x.id));
  sUp.splice(0, sUp.length, ...dd(sUp, (x) => x.id));
  rUp.splice(0, rUp.length, ...dd(rUp, rk));
  rDel.splice(0, rDel.length, ...dd(rDel, rk));

  /* ---------- esama būsena (leidimams, LOG aprašui ir Undo) ---------- */
  const cIds = uniq([...cUp.map((x) => x.id), ...cDel]);
  const beforeC = new Map((await sql`SELECT id, name FROM classes WHERE id = ANY(${cIds}::text[])`).map((x) => [x.id, x.name]));
  const cdelLinks = cDel.length ? await sql`SELECT student_id AS sid FROM student_classes WHERE class_id = ANY(${cDel}::text[])` : [];
  const sIds = uniq([...sUp.map((x) => x.id), ...sDel, ...cdelLinks.map((x) => x.sid)]);
  const beforeS = new Map((await sql`SELECT id, first_name AS first, last_name AS last, email, parent_email AS "parentEmail", notes, grade FROM students WHERE id = ANY(${sIds}::text[])`).map((x) => [x.id, x]));
  const beforeL = new Map();
  (await sql`SELECT student_id AS sid, class_id AS cid FROM student_classes WHERE student_id = ANY(${sIds}::text[])`).forEach((x) => { if (!beforeL.has(x.sid)) beforeL.set(x.sid, []); beforeL.get(x.sid).push(x.cid); });
  const beforeSRecs = sIds.length ? await sql`SELECT class_id AS c, d, student_id AS sid, s, n FROM records WHERE student_id = ANY(${sIds}::text[])` : [];
  const beforeCRecs = cDel.length ? await sql`SELECT class_id AS c, d, student_id AS sid, s, n FROM records WHERE class_id = ANY(${cDel}::text[])` : [];
  const rKeys = [...rUp, ...rDel];
  const beforeR = new Map((rKeys.length ? await sql`SELECT r.class_id AS c, r.d, r.student_id AS sid, r.s, r.n FROM records r
    JOIN unnest(${rKeys.map((x) => x.c)}::text[], ${rKeys.map((x) => x.d)}::text[], ${rKeys.map((x) => x.sid)}::text[]) AS t(c, d, sid)
    ON r.class_id = t.c AND r.d = t.d AND r.student_id = t.sid` : []).map((x) => [x.c + '|' + x.d + '|' + x.sid, x]));

  /* ---------- prieigos apribojimai (vartotojai be „Matyti visus komitetus“) ---------- */
  const q = [];
  const restricted = me.classIds !== null;
  const have = new Set(me.classIds || []);
  const fresh = cUp.filter((x) => !beforeC.has(x.id)).map((x) => x.id);
  if (restricted) {
    const deny = () => { throw new HttpError(403, 'Neturite prieigos prie šio komiteto.'); };
    const ok = (cid) => have.has(cid) || fresh.includes(cid);
    cUp.forEach((x) => { if (beforeC.has(x.id) && !have.has(x.id)) deny(); });
    sUp.forEach((x) => {
      x.classIds.forEach((cid) => { if (!ok(cid)) deny(); });
      const ex = beforeL.get(x.id);
      if (ex && ex.length && !ex.some((cid) => have.has(cid))) deny();
    });
    sDel.forEach((id) => { const ex = beforeL.get(id) || []; if (ex.some((cid) => !have.has(cid))) deny(); });
    cDel.forEach((id) => { if (!have.has(id)) deny(); });
    rUp.forEach((x) => { if (!ok(x.c)) deny(); });
    rDel.forEach((x) => { if (!have.has(x.c)) deny(); });
  }
  const scope = restricted ? [...have, ...fresh] : null;
  const inScope = (list) => (restricted ? list.filter((cid) => have.has(cid)) : list);

  /* ---------- atvirkštiniai pakeitimai (Undo) ---------- */
  const inv = { classes: { up: [], del: [] }, students: { up: [], del: [] }, records: { up: [], del: [] } };
  cUp.forEach((x) => { if (beforeC.has(x.id)) inv.classes.up.push({ id: x.id, name: beforeC.get(x.id) }); else inv.classes.del.push(x.id); });
  cDel.forEach((id) => { if (beforeC.has(id)) inv.classes.up.push({ id, name: beforeC.get(id) }); });
  const studentBefore = (id) => ({ ...beforeS.get(id), classIds: inScope(beforeL.get(id) || []) });
  const sUpSet = new Set(sUp.map((x) => x.id));
  sUp.forEach((x) => {
    if (!beforeS.has(x.id)) { inv.students.del.push(x.id); return; }
    inv.students.up.push(studentBefore(x.id));
    const removed = (beforeL.get(x.id) || []).filter((cid) => !x.classIds.includes(cid));
    if (removed.length) beforeSRecs.forEach((rc) => { if (rc.sid === x.id && removed.includes(rc.c)) inv.records.up.push(rc); });
  });
  sDel.forEach((id) => {
    if (!beforeS.has(id)) return;
    inv.students.up.push(studentBefore(id));
    beforeSRecs.forEach((rc) => { if (rc.sid === id) inv.records.up.push(rc); });
  });
  /* ištrinto komiteto mokiniai (kurie lieka kituose komitetuose) atgauna ryšį su juo */
  cdelLinks.forEach(({ sid }) => { if (!sUpSet.has(sid) && !sDel.includes(sid) && beforeS.has(sid) && !inv.students.up.some((x) => x.id === sid)) inv.students.up.push(studentBefore(sid)); });
  beforeCRecs.forEach((rc) => inv.records.up.push(rc));
  rUp.forEach((x) => { const b = beforeR.get(x.c + '|' + x.d + '|' + x.sid); if (b) inv.records.up.push(b); else inv.records.del.push({ c: x.c, d: x.d, sid: x.sid }); });
  rDel.forEach((x) => { const b = beforeR.get(x.c + '|' + x.d + '|' + x.sid); if (b) inv.records.up.push(b); });
  inv.classes.up = dd(inv.classes.up, (x) => x.id);
  inv.students.up = dd(inv.students.up, (x) => x.id);
  inv.records.up = dd(inv.records.up, rk);
  inv.records.del = dd(inv.records.del, rk);
  inv.students.del = uniq(inv.students.del);
  inv.classes.del = uniq(inv.classes.del);
  const invSize = inv.classes.up.length + inv.classes.del.length + inv.students.up.length + inv.students.del.length + inv.records.up.length + inv.records.del.length;
  const undo = invSize && invSize <= MAX_UNDO ? inv : null;

  /* ---------- LOG aprašas ---------- */
  const names = new Map([...beforeC]);
  cUp.forEach((x) => names.set(x.id, x.name));
  const missing = uniq([...rUp.map((x) => x.c), ...rDel.map((x) => x.c)]).filter((id) => !names.has(id));
  if (missing.length) (await sql`SELECT id, name FROM classes WHERE id = ANY(${missing}::text[])`).forEach((x) => names.set(x.id, x.name));
  const cn = (id) => names.get(id) || id;
  const sNames = new Map([...beforeS].map(([id, v]) => [id, nm(v)]));
  sUp.forEach((x) => sNames.set(x.id, nm(x)));
  const rSids = uniq([...rUp.map((x) => x.sid), ...rDel.map((x) => x.sid)]).filter((id) => !sNames.has(id));
  if (rSids.length) (await sql`SELECT id, first_name AS first, last_name AS last FROM students WHERE id = ANY(${rSids}::text[])`).forEach((x) => sNames.set(x.id, nm(x)));
  const sn = (id) => sNames.get(id) || id;
  const comList = (ids) => ids.map(cn).join(', ');

  const lines = [];
  const cnt = { c: 0, s: 0, r: 0 };
  cUp.forEach((x) => {
    if (!beforeC.has(x.id)) { lines.push(`Sukurtas komitetas „${x.name}“`); cnt.c++; }
    else if (beforeC.get(x.id) !== x.name) { lines.push(`Komitetas „${beforeC.get(x.id)}“ pervadintas į „${x.name}“`); cnt.c++; }
  });
  cDel.forEach((id) => { lines.push(`Ištrintas komitetas „${cn(id)}“`); cnt.c++; });
  sUp.forEach((x) => {
    const b = beforeS.get(x.id);
    if (!b) { lines.push(`Pridėtas mokinys ${nm(x)}${x.grade ? ' (' + x.grade + ' kl.)' : ''} – komitetai: ${comList(x.classIds)}`); cnt.s++; return; }
    const ch = [];
    if (nm(b) !== nm(x)) ch.push(`vardas: ${nm(b)} → ${nm(x)}`);
    if ((b.grade || '') !== x.grade) ch.push(`klasė: ${b.grade || '–'} → ${x.grade || '–'}`);
    if (b.email !== x.email) ch.push('el. paštas');
    if (b.parentEmail !== x.parentEmail) ch.push('tėvų el. paštas');
    if (b.notes !== x.notes) ch.push('pastabos');
    const old = (beforeL.get(x.id) || []).slice().sort().join();
    if (old !== x.classIds.slice().sort().join()) ch.push(`komitetai: ${comList(beforeL.get(x.id) || []) || '–'} → ${comList(x.classIds)}`);
    if (ch.length) { lines.push(`Pakeistas mokinys ${nm(x)}: ${ch.join('; ')}`); cnt.s++; }
  });
  sDel.forEach((id) => { lines.push(`Ištrintas mokinys ${sn(id)}`); cnt.s++; });
  const delSkip = new Set(sDel);
  rUp.forEach((x) => {
    const b = beforeR.get(x.c + '|' + x.d + '|' + x.sid);
    if (b && b.s === x.s && b.n === x.n) return;
    const label = b && b.s === x.s && b.n !== x.n ? (x.n ? 'pastaba: ' + x.n : 'pastaba pašalinta') : (STATUS_LT[x.s] + (x.n && x.s ? ` (${x.n})` : ''));
    lines.push(`${sn(x.sid)} – ${label} · ${cn(x.c)}, ${x.d}`); cnt.r++;
  });
  rDel.forEach((x) => { if (delSkip.has(x.sid) || cDel.includes(x.c) || !beforeR.has(x.c + '|' + x.d + '|' + x.sid)) return; lines.push(`${sn(x.sid)} – žyma pašalinta · ${cn(x.c)}, ${x.d}`); cnt.r++; });
  if (!lines.length) { if (opts.undoOf) q.push(sql`UPDATE logs SET undone = true WHERE id = ${opts.undoOf}`); if (!q.length) return false; }

  let auto;
  if (lines.length === 1) auto = lines[0];
  else {
    const parts = [];
    if (cnt.c) parts.push(`komitetai: ${cnt.c}`);
    if (cnt.s) parts.push(`mokiniai: ${cnt.s}`);
    if (cnt.r) parts.push(`lankomumo žymos: ${cnt.r}`);
    auto = 'Pakeitimai – ' + (parts.join(', ') || 'duomenys');
  }
  const summary = opts.summary || (opts.tag ? `${opts.tag}: ${auto}` : auto);
  const kind = opts.undoOf ? 'undo' : opts.tag ? 'data' : (cnt.r && !cnt.s && !cnt.c) ? 'attendance' : (cnt.s && !cnt.c && !cnt.r) ? 'students' : (cnt.c && !cnt.s && !cnt.r) ? 'committees' : 'data';
  if (lines.length > 80) { const more = lines.length - 80; lines.length = 80; lines.push(`…ir dar ${more}`); }

  /* ---------- įrašymas (viena transakcija) ---------- */
  if (restricted && fresh.length) q.push(sql`UPDATE users SET class_ids = COALESCE(class_ids, '[]'::jsonb) || ${JSON.stringify(fresh)}::jsonb WHERE id = ${me.id}`);
  if (cUp.length) q.push(sql`INSERT INTO classes (id, name) SELECT * FROM unnest(${cUp.map((x) => x.id)}::text[], ${cUp.map((x) => x.name)}::text[])
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
  if (sUp.length) {
    q.push(sql`INSERT INTO students (id, first_name, last_name, email, parent_email, notes, grade)
      SELECT * FROM unnest(${sUp.map((x) => x.id)}::text[], ${sUp.map((x) => x.first)}::text[], ${sUp.map((x) => x.last)}::text[],
        ${sUp.map((x) => x.email)}::text[], ${sUp.map((x) => x.parentEmail)}::text[], ${sUp.map((x) => x.notes)}::text[], ${sUp.map((x) => x.grade)}::text[])
      ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
        email = EXCLUDED.email, parent_email = EXCLUDED.parent_email, notes = EXCLUDED.notes, grade = EXCLUDED.grade`);
    const pairs = sUp.flatMap((x) => x.classIds.map((cid) => [x.id, cid]));
    q.push(sql`DELETE FROM student_classes WHERE student_id = ANY(${sUp.map((x) => x.id)}::text[]) AND (${scope}::text[] IS NULL OR class_id = ANY(${scope}::text[]))`);
    q.push(sql`INSERT INTO student_classes (student_id, class_id) SELECT t.sid, t.cid FROM unnest(${pairs.map((p) => p[0])}::text[], ${pairs.map((p) => p[1])}::text[]) AS t(sid, cid)
      WHERE EXISTS (SELECT 1 FROM classes WHERE classes.id = t.cid) ON CONFLICT DO NOTHING`);
    /* pašalinus mokinį iš komiteto, to komiteto jo žymos nebeišlieka */
    q.push(sql`DELETE FROM records WHERE student_id = ANY(${sUp.map((x) => x.id)}::text[])
      AND NOT EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = records.student_id AND sc.class_id = records.class_id)`);
  }
  if (rUp.length) q.push(sql`INSERT INTO records (class_id, d, student_id, s, n)
    SELECT t.* FROM unnest(${rUp.map((x) => x.c)}::text[], ${rUp.map((x) => x.d)}::text[], ${rUp.map((x) => x.sid)}::text[], ${rUp.map((x) => x.s)}::text[], ${rUp.map((x) => x.n)}::text[]) AS t(c, d, sid, s, n)
    WHERE EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = t.sid AND sc.class_id = t.c)
    ON CONFLICT (class_id, d, student_id) DO UPDATE SET s = EXCLUDED.s, n = EXCLUDED.n`);
  if (rDel.length) q.push(sql`DELETE FROM records USING unnest(${rDel.map((x) => x.c)}::text[], ${rDel.map((x) => x.d)}::text[], ${rDel.map((x) => x.sid)}::text[]) AS t(c, d, sid)
    WHERE records.class_id = t.c AND records.d = t.d AND records.student_id = t.sid`);
  if (sDel.length) q.push(sql`DELETE FROM students WHERE id = ANY(${sDel}::text[])`);
  if (cDel.length) {
    q.push(sql`DELETE FROM records WHERE class_id = ANY(${cDel}::text[])`);
    q.push(sql`DELETE FROM classes WHERE id = ANY(${cDel}::text[])`);
    q.push(sql`DELETE FROM students s WHERE NOT EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = s.id)`);
  }
  if (opts.undoOf) q.push(sql`UPDATE logs SET undone = true WHERE id = ${opts.undoOf}`);
  q.push(logQ(sql, me, kind, summary, lines, undo));
  await sql.transaction(q);
  return true;
}
