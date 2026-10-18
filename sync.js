/* Automatinis išsaugojimas serveryje: po kiekvieno pakeitimo siunčiamas tik skirtumas nuo paskutinės serverio būsenos. */
const Sync = (() => {
  const CUR_KEY = 'attendance-current-class';
  const empty = () => ({ classes: [], students: [], records: {}, currentClassId: null });
  let snap = empty(), timer = null, retry = null, busy = false, dirty = false, hideT = null;
  const clone = (x) => JSON.parse(JSON.stringify(x));

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
  function flat(st) {
    const m = new Map();
    for (const c in st.records) for (const d in st.records[c]) for (const sid in st.records[c][d]) {
      const r = st.records[c][d][sid];
      m.set(c + '|' + d + '|' + sid, { c, d, sid, s: r.s || '', n: r.n || '' });
    }
    return m;
  }
  function diffList(oldL, newL, sig, map) {
    const o = new Map(oldL.map((x) => [x.id, x])), n = new Map(newL.map((x) => [x.id, x]));
    const up = [], del = [];
    n.forEach((v, k) => { const p = o.get(k); if (!p || sig(p) !== sig(v)) up.push(map(v)); });
    o.forEach((v, k) => { if (!n.has(k)) del.push(k); });
    return { up, del };
  }
  function diff(a, b) {
    const classes = diffList(a.classes, b.classes, sigC, (c) => ({ id: c.id, name: c.name }));
    const students = diffList(a.students, b.students, sigS, stud);
    const fa = flat(a), fb = flat(b), rUp = [], rDel = [];
    fb.forEach((v, k) => { const p = fa.get(k); if (!p || p.s !== v.s || p.n !== v.n) rUp.push(v); });
    fa.forEach((v, k) => { if (!fb.has(k)) rDel.push({ c: v.c, d: v.d, sid: v.sid }); });
    return { classes, students, records: { up: rUp, del: rDel } };
  }
  const isEmpty = (o) => !o.classes.up.length && !o.classes.del.length && !o.students.up.length && !o.students.del.length && !o.records.up.length && !o.records.del.length;
  const signature = (st) => JSON.stringify([st.classes.map(sigC).sort(), st.students.map(sigS).sort(), [...flat(st).entries()].map(([k, v]) => k + '=' + v.s + '|' + v.n).sort()]);

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
        if (!isEmpty(ops)) await api('/api/state', { ops });
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
  async function pull() {
    const r = await api('/api/state');
    const recs = {};
    r.records.forEach((x) => { ((recs[x.c] = recs[x.c] || {})[x.d] = recs[x.c][x.d] || {})[x.sid] = { s: x.s, n: x.n }; });
    const next = { classes: r.classes, students: r.students.map(normStudent), records: recs, currentClassId: null };
    const changed = signature(next) !== signature(state);
    let cur = null;
    try { cur = localStorage.getItem(CUR_KEY); } catch (e) { /* ignore */ }
    if (state.currentClassId && next.classes.some((c) => c.id === state.currentClassId)) cur = state.currentClassId;
    next.currentClassId = next.classes.some((c) => c.id === cur) ? cur : (next.classes[0] ? next.classes[0].id : null);
    state = next; snap = clone(state);
    return changed;
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
      ch = (await pull()) || ch;
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
    if (!confirm('Šioje naršyklėje rasti seni lankomumo duomenys (iš versijos be serverio). Įkelti juos į serverį?')) {
      try { localStorage.setItem('attendance-legacy-declined', '1'); } catch (e) { /* ignore */ }
      return;
    }
    state = { classes: old.classes, students: old.students.map(normStudent), records: old.records, currentClassId: old.currentClassId || (old.classes[0] && old.classes[0].id) || null };
    queue(); await flush();
    try { localStorage.setItem(KEY + '-migrated', raw); localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function reset() {
    clearTimeout(timer); clearTimeout(retry);
    dirty = false; snap = empty(); state = empty(); setStatus('', '');
  }

  window.addEventListener('beforeunload', (e) => { if (dirty || busy) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) softPull(); });
  setInterval(softPull, 20000);

  return { queue, flush, pull, softPull, migrateLegacy, reset, diff, isEmpty };
})();