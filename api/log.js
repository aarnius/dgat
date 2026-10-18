import { db, handler, HttpError, getUser, requireUser, requirePerm, logEvent, str } from '../lib/server.js';
import { applyOps } from '../lib/ops.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVENTS = {
  'export-json': 'Atsisiųsta atsarginė kopija (JSON)',
  'export-csv': 'Eksportuotas lankomumas (CSV)',
  'export-report': 'Eksportuota ataskaita (CSV)',
  'print-report': 'Spausdinama ataskaita',
  'print-card': 'Spausdinama mokinio kortelė',
  'print-day': 'Spausdinamas dienos lankomumas',
};

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));

  if (req.method === 'GET') {
    requirePerm(me, 'logs.view');
    const qs = req.query || {};
    const kind = str(qs.kind, 20), qtext = str(qs.q, 100);
    const from = DATE_RE.test(qs.from || '') ? qs.from : null, to = DATE_RE.test(qs.to || '') ? qs.to : null;
    const before = parseInt(qs.before, 10) || null;
    const limit = 100;
    const rows = await sql`SELECT id, ts, user_name AS "user", kind, summary, details, (undo IS NOT NULL) AS "canUndo", undone FROM logs
      WHERE (${kind} = '' OR kind = ${kind})
        AND (${from}::date IS NULL OR ts >= (${from}::date)::timestamp AT TIME ZONE 'Europe/Vilnius')
        AND (${to}::date IS NULL OR ts < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Vilnius'))
        AND (${before}::bigint IS NULL OR id < ${before}::bigint)
        AND (${qtext} = '' OR summary ILIKE '%' || ${qtext} || '%' OR user_name ILIKE '%' || ${qtext} || '%')
      ORDER BY id DESC LIMIT ${limit + 1}`;
    return { logs: rows.slice(0, limit), more: rows.length > limit };
  }

  switch (body.action) {
    case 'undo': {
      requirePerm(me, 'logs.undo');
      const id = parseInt(body.id, 10);
      const [e] = await sql`SELECT id, summary, undo, undone FROM logs WHERE id = ${id}`;
      if (!e || !e.undo) throw new HttpError(400, 'Šio įrašo atšaukti negalima.');
      if (e.undone) throw new HttpError(400, 'Šis pakeitimas jau atšauktas.');
      await applyOps(sql, me, e.undo, { skipNeed: true, undoOf: id, summary: 'Atšaukta: ' + e.summary });
      return { ok: true };
    }

    case 'clear': {
      requirePerm(me, 'logs.clear');
      const from = DATE_RE.test(body.from || '') ? body.from : null, to = DATE_RE.test(body.to || '') ? body.to : null;
      if (!from && !to && body.all !== true) throw new HttpError(400, 'Pasirinkite laikotarpį arba valyti visą LOG.');
      const [{ n }] = await sql`WITH d AS (DELETE FROM logs
        WHERE (${from}::date IS NULL OR ts >= (${from}::date)::timestamp AT TIME ZONE 'Europe/Vilnius')
          AND (${to}::date IS NULL OR ts < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Vilnius')) RETURNING 1)
        SELECT count(*)::int AS n FROM d`;
      const period = !from && !to ? 'visi įrašai' : `${from || '…'} – ${to || '…'}`;
      await logEvent(sql, me, 'admin', `LOG išvalytas (${period})`, [`Pašalinta įrašų: ${n}`]);
      return { removed: n };
    }

    case 'event': {
      const what = String(body.what || '');
      if (!EVENTS[what]) throw new HttpError(400, 'Nežinomas įvykis.');
      const info = str(body.info, 120);
      await logEvent(sql, me, 'export', EVENTS[what] + (info ? ': ' + info : ''));
      return { ok: true };
    }

    default:
      throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});
