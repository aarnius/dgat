import { db, handler, getUser, canView, requireUser, fullState, dailyBackup, dataVersion, str } from '../lib/server.js';
import { applyOps } from '../lib/ops.js';

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));
  if (req.method === 'GET') {
    if (!canView(me)) return { classes: [], students: [], records: [] };
    /* Atsarginė kopija (jei cron jos dar nepadarė) vykdoma lygiagrečiai ir nebestabdo atsakymo. */
    const backupP = me.classIds === null
      ? dailyBackup(sql).catch((e) => console.error('backup', e))
      : Promise.resolve();
    /* Versija skaičiuojama PRIEŠ duomenis, todėl ji niekada nebūna „naujesnė“ už grąžintus duomenis.
       Į ją įtraukiami ir vartotojo komitetai, kad pasikeitus prieigai duomenys būtų perkrauti. */
    const scope = me.classIds === null ? '*' : me.classIds.slice().sort().join(',');
    const v = (await dataVersion(sql)) + ':' + scope;
    const known = String((req.query && req.query.v) || '');
    if (known && known === v) { await backupP; return { same: true, v }; }
    const [st] = await Promise.all([fullState(sql, me.classIds), backupP]);
    return { ...st, v };
  }
  /* Pakeitimai: kliento siunčiamas skirtumas nuo paskutinės serverio būsenos. Leidimai tikrinami ir LOG įrašas sukuriamas lib/ops.js. */
  await applyOps(sql, me, body.ops, { tag: str(body.tag, 80) });
  return { ok: true };
});