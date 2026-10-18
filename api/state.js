import { db, handler, getUser, canView, requireUser, fullState, dailyBackup, str } from '../lib/server.js';
import { applyOps } from '../lib/ops.js';

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));

  if (req.method === 'GET') {
    if (!canView(me)) return { classes: [], students: [], records: [] };
    if (me.classIds === null) { try { await dailyBackup(sql); } catch (e) { console.error('backup', e); } }
    return fullState(sql, me.classIds); // null = visos klasės
  }

  /* Pakeitimai: kliento siunčiamas skirtumas nuo paskutinės serverio būsenos. Leidimai tikrinami ir LOG įrašas sukuriamas lib/ops.js. */
  await applyOps(sql, me, body.ops, { tag: str(body.tag, 80) });
  return { ok: true };
});
