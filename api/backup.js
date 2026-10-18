import { db, handler, HttpError, getUser, requireUser, requirePerm, makeBackup, logEvent } from '../lib/server.js';

/* GET be parametrų – kopijų sąrašas; GET ?id=… – kopijos duomenys; POST {action:'create'} – nauja kopija.
   Kasdienę kopiją paleidžia Vercel Cron (vercel.json), kuris siunčia GET su antraštė Authorization: Bearer CRON_SECRET. */
export default handler(async (req, res, body) => {
  const sql = db();
  const auth = req.headers.authorization || '';
  if (req.method === 'GET' && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) {
    await makeBackup(sql, 'auto');
    return { ok: true };
  }
  const me = requireUser(await getUser(req));
  if (me.classIds !== null) throw new HttpError(403, 'Atsarginės kopijos pasiekiamos tik naudotojams, matantiems visus komitetus.');

  if (req.method === 'GET') {
    const id = parseInt(req.query && req.query.id, 10);
    if (id) {
      requirePerm(me, 'data.backup', 'data.restore');
      const [row] = await sql`SELECT day, kind, data FROM backups WHERE id = ${id}`;
      if (!row) throw new HttpError(404, 'Kopija nerasta.');
      return row.data;
    }
    requirePerm(me, 'data.view', 'data.backup', 'data.restore');
    const rows = await sql`SELECT id, day::text AS day, kind, created_at AS "createdAt", jsonb_array_length(data->'classes') AS classes,
      jsonb_array_length(data->'students') AS students FROM backups ORDER BY created_at DESC LIMIT 60`;
    return { backups: rows };
  }

  if (body.action === 'create') {
    requirePerm(me, 'data.backup');
    await makeBackup(sql, 'manual', me);
    return { ok: true };
  }
  if (body.action === 'opened') { /* kliento pranešimas, kad kopija atsisiųsta arba atkurta */
    requirePerm(me, 'data.backup', 'data.restore');
    await logEvent(sql, me, 'backup', String(body.what || 'Atsisiųsta atsarginė kopija').slice(0, 200));
    return { ok: true };
  }
  throw new HttpError(400, 'Nežinomas veiksmas.');
});
