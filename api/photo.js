/* Profilio nuotraukos (JPEG).
   GET /api/photo?id=<mokinio id>  – mokinio nuotrauka: darbuotojas su prieiga arba pats mokinys.
   GET /api/photo?u=<vartotojo id> – darbuotojo nuotrauka: bet kuris prisijungęs darbuotojas arba mokinys, kuriam tas darbuotojas pažymėjo lankomumą. */
import { db, ensureSchema, getUser, canView, readStudentSid } from '../lib/server.js';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export default async function photo(req, res) {
  try {
    if (req.method !== 'GET') { res.status(405).end(); return; }
    const id = String((req.query && req.query.id) || ''), uid = String((req.query && req.query.u) || '');
    if (!ID_RE.test(id || uid)) { res.status(400).end(); return; }
    await ensureSchema();
    const sql = db();
    const sid = readStudentSid(req);
    let data = null;
    if (uid) {
      let allowed = !!(await getUser(req));
      if (!allowed && sid) {
        const [x] = await sql`SELECT 1 AS x FROM records WHERE student_id = ${sid} AND by_id = ${uid}
          UNION ALL SELECT 1 FROM activity_records WHERE student_id = ${sid} AND by_id = ${uid} LIMIT 1`;
        allowed = !!x;
      }
      if (!allowed) { res.status(401).end(); return; }
      const [r] = await sql`SELECT data FROM user_photos WHERE user_id = ${uid}`;
      data = r && r.data;
    } else {
      let scope = null;
      if (sid !== id) {
        const me = await getUser(req);
        if (!me || !canView(me)) { res.status(401).end(); return; }
        scope = me.classIds;
      }
      const [r] = await sql`SELECT p.data FROM student_photos p WHERE p.student_id = ${id}
        AND (${scope}::text[] IS NULL OR EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = p.student_id AND sc.class_id = ANY(${scope}::text[])))`;
      data = r && r.data;
    }
    if (!data) { res.status(404).end(); return; }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).send(Buffer.from(data, 'base64'));
  } catch (e) {
    console.error('photo', e);
    res.status(500).end();
  }
}
