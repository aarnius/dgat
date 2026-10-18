import { db, handler, HttpError, getUser, requireUser, requirePerm, logEvent, logQ, makeBackup, newId, str } from '../lib/server.js';

/* Įrankiai: išsaugoti sugrupavimai, sąrašų šablonai ir dublikatų sujungimas. Atsitiktinis traukimas, sąrašai, kalendorius ir rizikos sąrašas skaičiuojami naršyklėje. */

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const needId = (v) => { if (!ID_RE.test(String(v))) throw new HttpError(400, 'Netinkami duomenys.'); return String(v); };
const WIDTHS = ['auto', 'xs', 's', 'm', 'l', 'xl'];

async function list(sql, me) {
  const ids = me.classIds; // null = visi komitetai
  return sql`SELECT id, class_id AS "classId", name, data, created_by_name AS "by", created_at AS "createdAt" FROM saved_groups
    WHERE (${ids}::text[] IS NULL OR class_id = ANY(${ids}::text[])) ORDER BY created_at DESC LIMIT 200`;
}

const listTpl = (sql) => sql`SELECT id, name, data, created_by_name AS "by", updated_at AS "updatedAt" FROM list_templates ORDER BY name LIMIT 200`;

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));
  requirePerm(me, 'tools.view');
  if (req.method === 'GET') {
    const [groups, templates] = await Promise.all([list(sql, me), listTpl(sql)]);
    return { groups, templates };
  }

  switch (body.action) {
    case 'group-save': {
      requirePerm(me, 'tools.save');
      const classId = needId(body.classId), name = str(body.name, 120);
      if (!name) throw new HttpError(400, 'Įveskite pavadinimą.');
      if (me.classIds !== null && !me.classIds.includes(classId)) throw new HttpError(403, 'Neturite prieigos prie šio komiteto.');
      const [cls] = await sql`SELECT name FROM classes WHERE id = ${classId}`;
      if (!cls) throw new HttpError(404, 'Komitetas nerastas.');
      const raw = Array.isArray(body.groups) ? body.groups : [];
      if (!raw.length || raw.length > 100) throw new HttpError(400, 'Netinkami duomenys.');
      const groups = raw.map((g) => (Array.isArray(g) ? g.slice(0, 500).map(needId) : []));
      const names = {};
      const nm = body.names && typeof body.names === 'object' ? body.names : {};
      groups.flat().forEach((id) => { names[id] = str(nm[id], 120); });
      const data = { groups, names, mode: str(body.mode, 20), activityId: body.activityId ? needId(body.activityId) : '', note: str(body.note, 200) };
      const id = newId('g');
      await sql`INSERT INTO saved_groups (id, class_id, name, data, created_by, created_by_name) VALUES (${id}, ${classId}, ${name}, ${JSON.stringify(data)}::jsonb, ${me.id}, ${me.name})`;
      await logEvent(sql, me, 'tools', `Išsaugotas sugrupavimas „${name}“ (${cls.name})`, [`Grupių: ${groups.length}`, `Mokinių: ${groups.flat().length}`]);
      return { groups: await list(sql, me), id };
    }
    case 'group-delete': {
      requirePerm(me, 'tools.save');
      const id = needId(body.id);
      const [g] = await sql`SELECT id, class_id, name FROM saved_groups WHERE id = ${id}`;
      if (!g) return { groups: await list(sql, me) };
      if (me.classIds !== null && !me.classIds.includes(g.class_id)) throw new HttpError(403, 'Neturite prieigos prie šio komiteto.');
      await sql`DELETE FROM saved_groups WHERE id = ${id}`;
      await logEvent(sql, me, 'tools', `Ištrintas sugrupavimas „${g.name}“`);
      return { groups: await list(sql, me) };
    }
    /* Sąrašų spausdinimui šablonai (bendri visiems komitetams). */
    case 'tpl-save': {
      requirePerm(me, 'tools.save');
      const name = str(body.name, 120);
      if (!name) throw new HttpError(400, 'Įveskite pavadinimą.');
      const d = body.data && typeof body.data === 'object' ? body.data : {};
      const num = (v, min, max) => Math.max(min, Math.min(max, Math.floor(Number(v)) || 0));
      const cols = (Array.isArray(d.cols) ? d.cols : []).slice(0, 15).map((c) => ({ n: str(c && c.n, 60), w: WIDTHS.includes(c && c.w) ? c.w : 'auto' }));
      const data = {
        title: str(d.title, 150), sub: str(d.sub, 200),
        hNr: str(d.hNr, 60), hName: str(d.hName, 60), hGrade: str(d.hGrade, 60),
        num: d.num !== false, grade: !!d.grade, cols, extra: num(d.extra, 0, 40),
        rowh: ['compact', 'normal', 'tall'].includes(d.rowh) ? d.rowh : 'normal',
        fs: ['s', 'm', 'l'].includes(d.fs) ? d.fs : 'm', land: !!d.land,
      };
      let id = body.id ? needId(body.id) : '';
      if (id) {
        const rows = await sql`UPDATE list_templates SET name = ${name}, data = ${JSON.stringify(data)}::jsonb, updated_at = now() WHERE id = ${id} RETURNING id`;
        if (!rows.length) throw new HttpError(404, 'Šablonas nerastas. Atnaujinkite puslapį.');
      } else {
        id = newId('t');
        await sql`INSERT INTO list_templates (id, name, data, created_by, created_by_name) VALUES (${id}, ${name}, ${JSON.stringify(data)}::jsonb, ${me.id}, ${me.name})`;
      }
      await logEvent(sql, me, 'tools', `${body.id ? 'Atnaujintas' : 'Sukurtas'} sąrašo šablonas „${name}“`);
      return { templates: await listTpl(sql), id };
    }
    case 'tpl-delete': {
      requirePerm(me, 'tools.save');
      const id = needId(body.id);
      const [t] = await sql`DELETE FROM list_templates WHERE id = ${id} RETURNING name`;
      if (t) await logEvent(sql, me, 'tools', `Ištrintas sąrašo šablonas „${t.name}“`);
      return { templates: await listTpl(sql) };
    }
    /* Dublikatų sujungimas: komitetai, lankomumas ir veiklų žymos perkeliami į paliekamą mokinį, likę įrašai pašalinami.
       Prieš tai automatiškai sukuriama atsarginė kopija (šio veiksmo „Undo“ nepalaiko). */
    case 'merge': {
      requirePerm(me, 'students.edit');
      requirePerm(me, 'students.delete');
      if (me.classIds !== null) throw new HttpError(403, 'Sujungti dublikatus gali tik naudotojai, matantys visus komitetus.');
      const keep = needId(body.keepId);
      const drops = [...new Set((Array.isArray(body.dropIds) ? body.dropIds : []).map(needId))].filter((x) => x !== keep);
      if (!drops.length || drops.length > 30) throw new HttpError(400, 'Netinkami duomenys.');
      const found = await sql`SELECT id, first_name AS first, last_name AS last FROM students WHERE id = ANY(${[keep, ...drops]}::text[])`;
      const kept = found.find((x) => x.id === keep);
      if (!kept || found.length !== drops.length + 1) throw new HttpError(404, 'Mokinys nerastas (galbūt jau sujungtas). Atnaujinkite puslapį.');
      await makeBackup(sql, 'manual', me);
      const nm = (x) => [x.first, x.last].filter(Boolean).join(' ');
      await sql.transaction([
        sql`INSERT INTO student_classes (student_id, class_id) SELECT ${keep}::text, class_id FROM student_classes WHERE student_id = ANY(${drops}::text[]) ON CONFLICT DO NOTHING`,
        sql`INSERT INTO records (class_id, d, student_id, s, n) SELECT DISTINCT ON (class_id, d) class_id, d, ${keep}::text, s, n FROM records
            WHERE student_id = ANY(${drops}::text[]) ORDER BY class_id, d, (s <> '') DESC
            ON CONFLICT (class_id, d, student_id) DO UPDATE SET s = CASE WHEN records.s = '' THEN EXCLUDED.s ELSE records.s END, n = CASE WHEN records.n = '' THEN EXCLUDED.n ELSE records.n END`,
        sql`INSERT INTO activity_students (activity_id, student_id) SELECT activity_id, ${keep}::text FROM activity_students WHERE student_id = ANY(${drops}::text[]) ON CONFLICT DO NOTHING`,
        sql`INSERT INTO activity_records (session_id, student_id, s, n) SELECT DISTINCT ON (session_id) session_id, ${keep}::text, s, n FROM activity_records
            WHERE student_id = ANY(${drops}::text[]) ORDER BY session_id, (s <> '') DESC
            ON CONFLICT (session_id, student_id) DO UPDATE SET s = CASE WHEN activity_records.s = '' THEN EXCLUDED.s ELSE activity_records.s END, n = CASE WHEN activity_records.n = '' THEN EXCLUDED.n ELSE activity_records.n END`,
        sql`UPDATE students k SET
            email = CASE WHEN k.email = '' THEN COALESCE((SELECT d.email FROM students d WHERE d.id = ANY(${drops}::text[]) AND d.email <> '' LIMIT 1), '') ELSE k.email END,
            parent_email = CASE WHEN k.parent_email = '' THEN COALESCE((SELECT d.parent_email FROM students d WHERE d.id = ANY(${drops}::text[]) AND d.parent_email <> '' LIMIT 1), '') ELSE k.parent_email END,
            grade = CASE WHEN k.grade = '' THEN COALESCE((SELECT d.grade FROM students d WHERE d.id = ANY(${drops}::text[]) AND d.grade <> '' LIMIT 1), '') ELSE k.grade END,
            notes = CASE WHEN k.notes = '' THEN COALESCE((SELECT d.notes FROM students d WHERE d.id = ANY(${drops}::text[]) AND d.notes <> '' LIMIT 1), '') ELSE k.notes END
            WHERE k.id = ${keep}`,
        sql`DELETE FROM students WHERE id = ANY(${drops}::text[])`,
        logQ(sql, me, 'students', `Sujungti dublikatai: ${nm(kept)} (pašalinta įrašų: ${drops.length})`,
          found.filter((x) => x.id !== keep).map((x) => `Sujungtas ir pašalintas: ${nm(x)}`), null),
      ]);
      return { ok: true };
    }
    default:
      throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});