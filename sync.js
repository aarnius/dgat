/* Automatinis išsaugojimas serveryje: po kiekvieno pakeitimo siunčiamas tik skirtumas nuo paskutinės serverio būsenos.
   Foninis atnaujinimas pirmiausia lygina duomenų versiją – jei niekas nepasikeitė, viso žurnalo nebesiunčiama. */
const Sync = (() => {
  const CUR_KEY = 'attendance-current-class';
  const empty = () => ({ classes: [], students: [], records: {}, currentClassId: null });
  let tagText = '';
  /* Žyma, kuri bus įrašyta į LOG prie kito išsaugojimo (pvz. „Atkurta iš kopijos“). */
  const tag = (t) => { tagText = t || ''; };
  const nest = (list) => {
    const recs = {};
    list.forEach((x) => { ((recs[x.c] = recs[x.c] || {})[x.d] = recs[x.c][x.d] || {})[x.sid] = { s: x.s, n: x.n }; });
    return recs;
  };
  let snap = empty(), timer = null, retry = null, busy = false, dirty = false, hideT = null;
  let lastV = ''; /* paskutinė iš serverio gauta duomenų versija */

  /* structuredClone daug greitesnis už JSON kopijavimą; jei nepavyktų – grįžtame prie seno būdo. */
  const clone = (x) => {
    if (typeof structuredClone === 'function') { try { return structuredClone(x); } catch (e) { /* ignore */ } }
    return JSON.parse(JSON.stringify(x));
  };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function setStatus(kind, msg) {
    const e = document.getElementById('saveStatus');
    if (!e) return;
    e.dataset.kind = kind; e.textContent = msg || ''; e.hidden = !msg;
    clearTimeout(hideT);
    if (kind === 'saved') hideT = setTimeout(() => { e.hidden = true; }, 2500);
  }

  /* ---------- skirtumų skaičiavimas ---------- */
  const sigC = (c) => JSON.stringify([c.id, c.name]);
  const sigS = (s) => JSON.stringify([s.id, (s.classIds || []).slice().sort(), s.first || '', s.last || '', s.email || '', s.parentEmail || '', s.notes || '', s.grade || '']);
  const stud = (s) => ({ id: s.id, classIds: (s.classIds || []).slice().sort(), first: s.first || '', last: s.last || '', email: s.email || '', parentEmail: s.parentEmail || '', notes: s.notes || '', grade: s.grade || '' });

  function diffList(oldL, newL, sig, map) {
    const o = new Map(oldL.map((x) => [x.id, x])), n = new Map(newL.map((x) => [x.id, x]));
    const up = [], del = [];
    n.forEach((v, k) => { const p = o.get(k); if (!p || sig(p) !== sig(v)) up.push(map(v)); });
    o.forEach((v, k) => { if (!n.has(k)) del.push(k); });
    return { up, del };
  }

  /* Lankomumo įrašai lyginami tiesiogiai įdėtiniuose objektuose – be tarpinių Map ir milžiniškų eilučių. */
  function diffRecords(ra, rb) {
    const up = [], del = [];
    for (const c in rb) {
      const bc = rb[c], ac = own(ra, c) ? ra[c] : {};
      for (const d in bc) {
        const bd = bc[d], ad = own(ac, d) ? ac[d] : {};
        for (const sid in bd) {
          const v = bd[sid], p = own(ad, sid) ? ad[sid] : null;
          const s = v.s || '', n = v.n || '';
          if (!p || (p.s || '') !== s || (p.n || '') !== n) up.push({ c, d, sid, s, n });
        }
      }
    }
    for (const c in ra) {
      const ac = ra[c], bc = own(rb, c) ? rb[c] : {};
      for (const d in ac) {
        const bd = own(bc, d) ? bc[d] : {};
        for (const sid in ac[d]) if (!own(bd, sid)) del.push({ c, d, sid });
      }
    }
    return { up, del };
  }

  function diff(a, b) {
    const classes = diffList(a.classes, b.classes, sigC, (c) => ({ id: c.id, name: c.name }));
    const students = diffList(a.students, b.students, sigS, stud);
    const records = diffRecords(a.records || {}, b.records || {});
    return { classes, students, records };
  }
  const isEmpty = (o) => !o.classes.up.length && !o.classes.del.length && !o.students.up.length && !o.students.del.length && !o.records.up.length && !o.records.del.length;

  /* ---------- saugojimas ---------- */
  function queue() {
    if (!Auth.user()) return;
    try { localStorage.setItem(CUR_KEY, state.currentClassId || ''); } catch (e) { /* ignore */ }
    dirty = true;
    setStatus('saving', 'Saugoma…');
    clearTimeout(timer); clearTimeout(retry);
    timer = setTimeout(flush, 250);
  }

  async function flush() {
    if (busy) return;
    busy = true;
    try {
      while (dirty) {
        dirty = false;
        const next = clone(state);
        const ops = diff(snap, next);
        if (!isEmpty(ops)) { const t = tagText; await api('/api/state', t ? { ops, tag: t } : { ops }); if (tagText === t) tagText = ''; }
        snap = next;
      }
      setStatus('saved', 'Išsaugota ✓');
    } catch (e) {
      if (e.status === 401) { busy = false; return; }
      if (e.status === 400 || e.status === 403) {
        dirty = false; toast(e.message); setStatus('error', 'Pakeitimas atmestas');
        try { await pull(); render(); } catch (e2) { /* ignore */ }
      } else {
        dirty = true; setStatus('error', 'Nepavyko išsaugoti. Bandoma iš naujo…');
        retry = setTimeout(flush, 5000);
      }
    } finally { busy = false; }
  }

  /* ---------- gavimas iš serverio ---------- */
  /* useV = true: siunčiama turima versija; jei serveryje niekas nepasikeitė, duomenys nesiunčiami.
     Be parametro (prisijungus, po klaidos, po atkūrimo) visada parsiunčiami pilni duomenys. */
  async function pull(useV) {
    /* Veiklos kraunamos lygiagrečiai su pagrindiniais duomenimis. */
    const actP = typeof Acts !== 'undefined' ? Acts.refresh().catch(() => false) : Promise.resolve(false);
    let r;
    try { r = await api(useV && lastV ? '/api/state?v=' + encodeURIComponent(lastV) : '/api/state'); } catch (e) { await actP; throw e; }
    if (r && r.same) return await actP;
    const recs = nest(r.records);
    const next = { classes: r.classes, students: r.students.map(normStudent), records: recs, currentClassId: null };
    const changed = !isEmpty(diff(state, next));
    lastV = r.v || '';
    let cur = null;
    try { cur = localStorage.getItem(CUR_KEY); } catch (e) { /* ignore */ }
    if (state.currentClassId && next.classes.some((c) => c.id === state.currentClassId)) cur = state.currentClassId;
    next.currentClassId = next.classes.some((c) => c.id === cur) ? cur : (next.classes[0] ? next.classes[0].id : null);
    state = next; snap = clone(state);
    const actCh = await actP;
    return changed || actCh;
  }

  /* Fone atnaujina duomenis (kiti vartotojai gali būti ką nors pakeitę), bet netrukdo, kol žmogus rašo ar saugoma. */
  async function softPull() {
    if (!Auth.user() || dirty || busy || document.hidden) return;
    const a = document.activeElement;
    if ((a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || document.querySelector('dialog[open]')) return;
    try {
      let ch = await Auth.refreshMe();
      if (!Auth.user()) return;
      if (dirty || busy) return;
      ch = (await pull(true)) || ch;
      if (ch) render();
    } catch (e) { /* ignore */ }
  }

  /* Seni duomenys iš šios naršyklės (iki serverio versijos) – vieną kartą pasiūlome įkelti. */
  async function migrateLegacy() {
    let old = null, raw = null;
    try { raw = localStorage.getItem(KEY); old = raw ? load() : null; } catch (e) { return; }
    if (!old || !old.classes.length || state.classes.length) return;
    if (localStorage.getItem('attendance-legacy-declined')) return;
    if (!Auth.can('data.restore')) return;
    if (!(await UI.confirm('Šioje naršyklėje rasti seni lankomumo duomenys (iš versijos be serverio). Įkelti juos į serverį?', { title: 'Seni duomenys', okText: 'Įkelti', cancelText: 'Ne' }))) {
      try { localStorage.setItem('attendance-legacy-declined', '1'); } catch (e) { /* ignore */ }
      return;
    }
    state = { classes: old.classes, students: old.students.map(normStudent), records: old.records, currentClassId: old.currentClassId || (old.classes[0] && old.classes[0].id) || null };
    queue(); await flush();
    try { localStorage.setItem(KEY + '-migrated', raw); localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function reset() {
    clearTimeout(timer); clearTimeout(retry);
    dirty = false; tagText = ''; lastV = ''; snap = empty(); state = empty(); setStatus('', '');
    if (typeof Logs !== 'undefined') Logs.reset(true);
    if (typeof Acts !== 'undefined') Acts.reset();
    if (typeof Tools !== 'undefined') Tools.reset(true);
    if (typeof Backups !== 'undefined') Backups.reset(true);
    if (typeof Dash !== 'undefined') Dash.reset();
  }

  window.addEventListener('beforeunload', (e) => { if (dirty || busy) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) softPull(); });
  setInterval(softPull, 20000);

  return { queue, flush, pull, softPull, migrateLegacy, reset, diff, isEmpty, tag, nest, setStatus };
})();