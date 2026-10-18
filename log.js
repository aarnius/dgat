/* LOG (pakeitimų istorija) ir atsarginės kopijos serveryje. Naudoja app.js / auth.js funkcijas (api, esc, head, ICON, render...). */
const Logs = (() => {
  const KINDS = [['', 'Visi įvykiai'], ['attendance', 'Lankomumas'], ['activities', 'Veiklos'], ['students', 'Mokiniai'], ['committees', 'Komitetai'], ['data', 'Duomenys'], ['undo', 'Atšaukimai'],
    ['auth', 'Prisijungimai'], ['admin', 'Administravimas'], ['backup', 'Kopijos'], ['export', 'Eksportas / spausdinimas']];
  const kindName = (k) => { const x = KINDS.find((y) => y[0] === k); return x ? x[1] : k; };
  let f = { kind: '', from: '', to: '', q: '' }, items = [], more = false, st = 'idle', err = '';
  const fmt = (ts) => new Date(ts).toLocaleString('lt-LT', { dateStyle: 'short', timeStyle: 'medium' });

  async function load(append) {
    st = 'loading';
    const qs = new URLSearchParams();
    Object.keys(f).forEach((k) => { if (f[k]) qs.set(k, f[k]); });
    if (append && items.length) qs.set('before', items[items.length - 1].id);
    try {
      const r = await api('/api/log?' + qs.toString());
      items = append ? items.concat(r.logs) : r.logs; more = r.more; err = '';
    } catch (e) { err = e.message; if (!append) items = []; more = false; }
    st = 'ready';
    if (view === 'logs') render();
  }

  function renderPage() {
    if (st === 'idle') load(false);
    const rows = items.map((x) => {
      const det = (x.details || []).filter((d) => d !== x.summary);
      const undoBtn = x.canUndo && !x.undone && Auth.can('logs.undo')
        ? `<button class="btn small" data-act="log-undo" data-lid="${x.id}">${x.kind === 'undo' ? 'Grąžinti' : 'Atšaukti'}</button>` : '';
      return `<tr><td class="nowrap">${esc(fmt(x.ts))}</td><td>${esc(x.user || '–')}</td>
        <td><span class="kind k-${esc(x.kind)}">${esc(kindName(x.kind))}</span> ${esc(x.summary)}${x.undone ? ' <span class="rate na">atšaukta</span>' : ''}
        ${det.length ? `<details class="log-det"><summary>Išsamiau (${det.length})</summary><ul>${det.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}</td>
        <td class="row-actions">${undoBtn}</td></tr>`;
    }).join('');
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
    app.innerHTML = head('LOG', 'Pakeitimų ir įvykių istorija',
      `<button class="btn" data-act="log-reload">Atnaujinti</button><button class="btn danger" data-act="log-clear">Valyti LOG</button>`) +
      `<div class="card">
        <div class="actions" style="margin-bottom:12px">
          <select id="logKind" aria-label="Įvykio tipas">${KINDS.map(([v, l]) => opt(v, l, f.kind)).join('')}</select>
          <label class="muted">Nuo <input type="date" id="logFrom" value="${esc(f.from)}"></label>
          <label class="muted">Iki <input type="date" id="logTo" value="${esc(f.to)}"></label>
          <input type="search" class="search" id="logQ" placeholder="Ieškoti (Enter)" value="${esc(f.q)}">
        </div>
        ${err ? `<p class="form-err">${esc(err)}</p>` : st === 'loading' && !items.length ? '<p class="muted">Kraunama…</p>'
          : items.length ? `<div class="table-wrap"><table class="logtable"><thead><tr><th>Laikas</th><th>Vartotojas</th><th>Įvykis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
            ${more ? '<div style="text-align:center;margin-top:14px"><button class="btn" data-act="log-more">Rodyti senesnius</button></div>' : ''}`
            : '<p class="muted">Įrašų nėra.</p>'}
      </div>
      <p class="muted" style="font-size:.82rem">„Atšaukti“ grąžina duomenis į būseną prieš tą pakeitimą. Vėlesni to paties lankomumo ar mokinio pakeitimai bus perrašyti.</p>`;
  }

  async function undo(id) {
    const x = items.find((i) => String(i.id) === String(id));
    if (!x || !confirm(`Atšaukti šį pakeitimą?\n\n${x.summary}\n\nDuomenys bus grąžinti į buvusią būseną.`)) return;
    try {
      await Sync.flush();
      await api('/api/log', { action: 'undo', id: x.id });
      await Sync.pull();
      toast('Pakeitimas atšauktas');
    } catch (e) { toast(e.message); }
    await load(false);
    render();
  }

  function openClear() {
    importDlg.innerHTML = `<div class="dlg">
      <div class="dlg-head"><h3>Valyti LOG</h3><button type="button" class="icon-btn" data-act="close-import" aria-label="Uždaryti">&times;</button></div>
      <label class="check"><input type="radio" name="lc" value="range" checked> Pagal laikotarpį</label>
      <div class="grid2"><label>Nuo<input type="date" id="lcFrom"></label><label>Iki (imtinai)<input type="date" id="lcTo"></label></div>
      <p class="muted" style="font-size:.8rem;margin-top:0">Palikus vieną datą tuščią, valoma nuo pat pradžios arba iki pat pabaigos.</p>
      <label class="check"><input type="radio" name="lc" value="all"> Visi įrašai</label>
      <p class="muted" style="font-size:.8rem">Ištrintų įrašų pakeitimų atšaukti (Undo) nebebus galima. Pačią valymo operaciją LOG užfiksuos.</p>
      <div class="dlg-actions"><button type="button" class="btn" data-act="close-import">Atšaukti</button><button type="button" class="btn danger" data-act="log-clear-do">Išvalyti</button></div></div>`;
    importDlg.showModal();
  }
  async function doClear() {
    const all = importDlg.querySelector('input[name=lc]:checked').value === 'all';
    const from = importDlg.querySelector('#lcFrom').value, to = importDlg.querySelector('#lcTo').value;
    if (!all && !from && !to) { toast('Pasirinkite bent vieną datą arba „Visi įrašai“'); return; }
    if (!confirm(all ? 'Tikrai ištrinti VISĄ LOG?' : `Ištrinti LOG įrašus ${from || '…'} – ${to || '…'}?`)) return;
    try {
      const r = await api('/api/log', all ? { action: 'clear', all: true } : { action: 'clear', from, to });
      importDlg.close(); toast(`Pašalinta įrašų: ${r.removed}`);
    } catch (e) { toast(e.message); return; }
    await load(false); render();
  }

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'logKind') f.kind = t.value;
    else if (t.id === 'logFrom') f.from = t.value;
    else if (t.id === 'logTo') f.to = t.value;
    else if (t.id === 'logQ') f.q = t.value.trim();
    else return;
    load(false);
  });

  function act(a, el) {
    switch (a) {
      case 'log-reload': load(false); return true;
      case 'log-more': load(true); return true;
      case 'log-undo': undo(el.dataset.lid); return true;
      case 'log-clear': openClear(); return true;
      case 'log-clear-do': doClear(); return true;
    }
    return false;
  }
  const reset = (hard) => { st = 'idle'; if (hard) { items = []; f = { kind: '', from: '', to: '', q: '' }; err = ''; } };
  return { render: renderPage, act, reset };
})();

/* Atsarginės kopijos serveryje (kasdien automatiškai). */
const Backups = (() => {
  let list = null, err = '';
  const kindLt = { auto: 'Automatinė', manual: 'Rankinė' };
  async function load() {
    try { list = (await api('/api/backup')).backups; err = ''; } catch (e) { err = e.message; list = []; }
    if (view === 'data') render();
  }
  function html() {
    if (list === null) { load(); return '<p class="muted">Kraunama…</p>'; }
    if (err) return `<p class="muted">${esc(err)}</p>`;
    if (!list.length) return '<p class="muted">Kopijų dar nėra. Pirma automatinė kopija bus sukurta šiandien.</p>';
    return `<div class="table-wrap"><table><thead><tr><th>Sukurta</th><th>Tipas</th><th class="num">Komitetai</th><th class="num">Mokiniai</th><th></th></tr></thead><tbody>${list.map((b) =>
      `<tr><td>${esc(new Date(b.createdAt).toLocaleString('lt-LT', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${kindLt[b.kind] || b.kind}</td><td class="num">${b.classes}</td><td class="num">${b.students}</td>
      <td class="row-actions"><button class="btn small" data-act="backup-download" data-bid="${b.id}">Atsisiųsti</button> <button class="btn small danger" data-act="backup-restore" data-bid="${b.id}">Atkurti</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  async function create() {
    try { await api('/api/backup', { action: 'create' }); toast('Kopija sukurta'); } catch (e) { toast(e.message); }
    load();
  }
  async function getFile(id) {
    try {
      const d = await api('/api/backup?id=' + id);
      const out = { classes: d.classes, students: d.students, records: Sync.nest(d.records), currentClassId: null, activities: d.activities || null };
      download(`attendance-backup-server-${id}.json`, JSON.stringify(out, null, 2), 'application/json');
      api('/api/backup', { action: 'opened', what: 'Atsisiųsta serverio kopija #' + id }).catch(() => {});
    } catch (e) { toast(e.message); }
  }
  async function restore(id) {
    if (!confirm('Pakeisti VISUS dabartinius duomenis šios kopijos duomenimis? (Pakeitimą bus galima atšaukti skiltyje LOG.)')) return;
    try {
      await Sync.flush();
      const d = await api('/api/backup?id=' + id);
      restoreState({ classes: d.classes, students: d.students, records: d.records }, 'Atkurta iš serverio kopijos #' + id);
    } catch (e) { toast(e.message); }
  }
  function act(a, el) {
    switch (a) {
      case 'backup-create': create(); return true;
      case 'backup-download': getFile(el.dataset.bid); return true;
      case 'backup-restore': restore(el.dataset.bid); return true;
    }
    return false;
  }
  const reset = (hard) => { list = null; err = ''; if (!hard) return; };
  return { html, act, reset };
})();
