/* Mokinio profilio nuotrauka (JPEG). GET /api/photo?id=<mokinio id>
   Matyti gali: prisijungęs darbuotojas, turintis prieigą prie mokinio komiteto, arba pats mokinys (savo). */
import { db, ensureSchema, getUser, canView, readStudentSid } from '../lib/server.js';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export default async function photo(req, res) {
  try {
    if (req.method !== 'GET') { res.status(405).end(); return; }
    const id = String((req.query && req.query.id) || '');
    if (!ID_RE.test(id)) { res.status(400).end(); return; }
    await ensureSchema();
    const sql = db();
    let allowed = readStudentSid(req) === id;
    let scope = null;
    if (!allowed) {
      const me = await getUser(req);
      if (!me || !canView(me)) { res.status(401).end(); return; }
      scope = me.classIds;
      allowed = true;
    }
    const rows = await sql`SELECT p.data FROM student_photos p WHERE p.student_id = ${id}
      AND (${scope}::text[] IS NULL OR EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = p.student_id AND sc.class_id = ANY(${scope}::text[])))`;
    if (!rows.length) { res.status(404).end(); return; }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).send(Buffer.from(rows[0].data, 'base64'));
  } catch (e) {
    console.error('photo', e);
    res.status(500).end();
  }
}
