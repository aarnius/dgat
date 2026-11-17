/* REGISTRAS: visų dokumentų (įspėjimų, priėmimo, išėjimo, pokalbių ir t. t.) numeriai. Stulpeliai: sistemos Nr., tipas, kam, dėl ko (pažymėti punktai). */
const Reg = (() => {
  const KINDS = [['warn', 'Įspėjimas'], ['join', 'Priėmimas į Tarybą'], ['rejoin', 'Grįžimas į Tarybą'], ['leave', 'Išėjimas iš Tarybos'], ['remove', 'Pašalinimas iš Tarybos'],
    ['talk', 'Motyvacinis pokalbis'], ['cert', 'Pažyma'], ['minutes', 'Posėdžio protokolas'], ['plan', 'Renginio / projekto planas'], ['other', 'Kitas dokumentas']];
  const REASONS = {
    warn: ['Be pateisinamos priežasties praleisti 2 posėdžiai iš eilės', 'Pareigų nevykdymas (neatliktos užduotys, nesilaikoma terminų)', 'Netinkamas elgesys'],
    remove: ['Du galiojantys įspėjimai', 'Šiurkštus įstatų pažeidimas', 'Savo noru / prašymu'],
    talk: ['Dėl žemo aktyvumo', 'Dėl elgesio', 'Dėl pareigų vykdymo', 'Kita'],
    join: ['Naujas narys', 'Pateiktas prašymas'], rejoin: ['Grįžta po pertraukos'], leave: ['Savo noru', 'Baigė mokyklą', 'Neaktyvumas', 'Kita'],
    cert: ['Dalyvavimo Taryboje pažyma', 'Kita'], minutes: ['Eilinis posėdis', 'Neeilinis posėdis'], plan: ['Renginys', 'Projektas'], other: ['Kita'],
  };
  const GROUP = ['minutes', 'plan', 'other'];
  const PREFIX = { warn: 'ISP', talk: 'MP', remove: 'NP', join: 'PRM', rejoin: 'PA', leave: 'NI', cert: 'PZ', minutes: 'PR', plan: 'PLN', other: 'KT' };
  /* Kito automatinio numerio peržiūra (pvz. ISP-004): didžiausias to tipo numeris + 1. */
  const nextNo = (kind) => { const re = new RegExp('^' + PREFIX[kind] + '-(\\d+)$'); const used = new Set(E.map((e) => e.docNo)); let n = 0; E.forEach((e) => { const m = re.exec(e.docNo); if (m) n = Math.max(n, +m[1]); }); n++; while (used.has(PREFIX[kind] + '-' + String(n).padStart(3, '0'))) n++; return PREFIX[kind] + '-' + String(n).padStart(3, '0'); };
  const kname = (k) => (KINDS.find((x) => x[0] === k) || [0, k])[1];
  let E = [], st = 'idle', err = '';
  let f = { kind: '', year: '', status: 'active', q: '' };
  const canEdit = () => Auth.can('register.edit');

  async function load() {
    st = 'loading';
    try { E = (await api('/api/register')).entries || []; st = 'ok'; err = ''; } catch (e) { st = 'err'; err = e.message; }
    if (view === 'register') render();
    const cd = document.getElementById('cardDialog');
    if (st === 'ok' && cd && cd.open && window.__cardId) openCard(window.__cardId);
  }
  const validWarn = (e) => e.kind === 'warn' && e.status === 'active' && (!e.validUntil || e.validUntil >= today());
  /* Nario galiojantys įspėjimai (kortelei ir suvestinei). */
  const warnsOf = (sid) => E.filter((e) => e.kind === 'warn' && e.studentId === sid);
  const validCount = (sid) => warnsOf(sid).filter(validWarn).length;
  const ensure = () => { if (st === 'idle' && Auth.can('register.view')) load(); };

  const reasonsHtml = (kind, sel) => (REASONS[kind] || []).map((r, i) => `<label class="check"><input type="checkbox" name="reason" value="${esc(r)}" ${sel.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('');
  const rowHtml = (e) => `<tr class="${e.status === 'void' ? 'muted' : ''}"><td class="num"><b>${e.sysNo}</b></td><td class="nowrap">${esc(e.docNo)}</td><td>${esc(kname(e.kind))}</td>
    <td>${e.name ? esc(e.name) + (e.grade ? ' <small class="muted">' + esc(e.grade) + '</small>' : '') : '–'}</td><td class="nowrap">${esc(e.date)}</td>
    <td>${(e.reasons || []).map((r) => '☒ ' + esc(r)).join('<br>') || '–'}${e.details ? `<div class="muted"><small>${esc(e.details)}</small></div>` : ''}</td>
    <td class="nowrap">${e.kind === 'warn' ? (e.status === 'void' ? '' : e.validUntil ? esc(e.validUntil) : '–') : ''}</td>
    <td>${e.status === 'void' ? `<span class="rate na">panaikinta</span><div class="muted"><small>${esc(e.voidReason)}</small></div>` : e.kind === 'warn' && !validWarn(e) ? '<span class="rate na">nebegalioja</span>' : '<span class="rate good">galioja</span>'}</td>
    <td class="nowrap"><button class="btn small" data-act="reg-doc" data-rid="${e.id}">.docx</button>${canEdit() ? ` <button class="btn small" data-act="reg-edit" data-rid="${e.id}">Taisyti</button> ${e.status === 'void' ? `<button class="btn small" data-act="reg-restore" data-rid="${e.id}">Atkurti</button>` : `<button class="btn small danger" data-act="reg-void" data-rid="${e.id}">Naikinti</button>`}` : ''}</td></tr>`;
  const filtered = () => {
    const q = UI.norm ? UI.norm(f.q) : f.q.toLowerCase();
    return E.filter((e) => (!f.kind || e.kind === f.kind) && (!f.year || String(e.year) === f.year) && (!f.status || e.status === f.status || (f.status === 'active' && e.status === 'active'))
      && (!q || (UI.norm ? UI.norm([e.name, e.docNo, e.details, (e.reasons || []).join(' ')].join(' ')) : [e.name, e.docNo, e.details].join(' ').toLowerCase()).includes(q)));
  };

  function renderPage() {
    ensure();
    const years = [...new Set(E.map((e) => String(e.year)))].sort().reverse();
    const rows = filtered();
    /* nariai su ≥ 2 galiojančiais įspėjimais – pagrindas šalinimui (įstatų 6.2.1 p.) */
    const risk = new Map();
    E.filter(validWarn).forEach((e) => { if (e.studentId) { const r = risk.get(e.studentId) || { name: e.name, n: 0 }; r.n++; risk.set(e.studentId, r); } });
    const warnBox = [...risk.values()].filter((r) => r.n >= 2);
    app.innerHTML = head('Registras', 'Visų dokumentų numeriai: sistemos Nr., tipas, kam ir dėl ko.', canEdit() ? `<button class="btn primary" data-act="reg-new">${ICON.plus} Naujas numeris</button> <button class="btn" data-act="reg-csv">CSV</button>` : '<button class="btn" data-act="reg-csv">CSV</button>')
      + (warnBox.length ? `<div class="card"><b>Dėmesio:</b> ${warnBox.map((r) => esc(r.name) + ' (' + r.n + ' galiojantys įspėjimai)').join('; ')} – pagal įstatų 6.2.1 p. yra pagrindas svarstyti šalinimą.</div>` : '')
      + `<div class="card"><div class="tool-opts">
        <label>Tipas<select data-reg="kind"><option value="">Visi</option>${KINDS.map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Metai<select data-reg="year"><option value="">Visi</option>${years.map((y) => `<option ${f.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <label>Būsena<select data-reg="status"><option value="">Visos</option><option value="active" ${f.status === 'active' ? 'selected' : ''}>Galioja</option><option value="void" ${f.status === 'void' ? 'selected' : ''}>Panaikintos</option></select></label>
        <label>Paieška<input data-reg="q" value="${esc(f.q)}" placeholder="Vardas, numeris, tekstas…"></label></div>
      ${st === 'loading' || st === 'idle' ? '<p class="muted">Kraunama…</p>' : st === 'err' ? `<p class="error">${esc(err)}</p>` : rows.length ? `<div class="table-wrap"><table><thead><tr><th class="num">Sist. Nr.</th><th>Dok. Nr.</th><th>Tipas</th><th>Kam</th><th>Data</th><th>Dėl ko</th><th>Galioja iki</th><th>Būsena</th><th></th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>` : '<p class="muted">Įrašų nėra.</p>'}</div>`;
  }

  /* ---------- langas: naujas numeris / taisymas ---------- */
  let dlg = null;
  function dialog() {
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'regDialog'; document.body.appendChild(dlg);
      dlg.addEventListener('submit', onSubmit);
      dlg.addEventListener('change', (ev) => {
        if (ev.target.name === 'kind') fillKind(ev.target.value);
        if (ev.target.name === 'nmode') dlg.querySelector('#regDocNo').style.display = ev.target.value === 'manual' ? '' : 'none';
      });
    }
    return dlg;
  }
  const schoolEnd = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return `${m >= 9 ? y + 1 : y}-08-31`; };
  function fillKind(kind) {
    const box = dlg.querySelector('#regReasons'); if (box) box.innerHTML = reasonsHtml(kind, []);
    const who = dlg.querySelector('#regWho'); if (who) who.style.display = GROUP.includes(kind) ? 'none' : '';
    const nm = dlg.querySelector('#regName'); if (nm) nm.style.display = GROUP.includes(kind) ? '' : 'none';
    const nx = dlg.querySelector('#regNext'); if (nx) nx.textContent = nextNo(kind);
    const dn = dlg.querySelector('#regDocNo'); if (dn) dn.placeholder = 'pvz. ' + PREFIX[kind] + '-004';
    const vu = dlg.querySelector('#regValid'); if (vu) vu.style.display = kind === 'warn' ? '' : 'none';
  }
  function openNew(opts) {
    opts = opts || {};
    const kind = opts.kind || 'warn', date = today();
    const list = state.students.slice().sort((a, b) => (a.last || '').localeCompare(b.last || '', 'lt'));
    dialog().innerHTML = `<div class="dlg"><div class="dlg-head"><h3>Naujas numeris</h3><button type="button" class="icon-btn" data-act="reg-close" aria-label="Uždaryti">&times;</button></div>
      <form data-regform="new"><label>Tipas<select name="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Data<input type="date" name="date" value="${date}" required></label>
      <fieldset class="classpick" id="regWho"><legend>Kam (narys)</legend>${UI.filterBox({ scope: '#regWho', rows: 'label.check', placeholder: 'Ieškoti nario…' })}
        ${list.map((s) => `<label class="check"><input type="${opts.sid ? 'checkbox' : 'checkbox'}" name="stu" value="${s.id}" ${opts.sid === s.id ? 'checked' : ''}> ${esc(displayName(s))}${s.grade ? ' <small class="muted">' + esc(s.grade) + '</small>' : ''}</label>`).join('')}</fieldset>
      <fieldset class="classpick" style="max-height:none"><legend>Numeris</legend>
        <label class="check"><input type="radio" name="nmode" value="auto" checked> Sugeneruoti automatiškai: <b id="regNext">${nextNo(kind)}</b></label>
        <label class="check"><input type="radio" name="nmode" value="manual"> Įrašyti pačiam</label>
        <input name="docNo" maxlength="30" placeholder="pvz. ${PREFIX[kind]}-004" id="regDocNo" style="display:none"></fieldset>
      <label id="regName" style="display:none">Pavadinimas / kam<input name="name" maxlength="200" placeholder="pvz. Tarybos posėdis 2026-11-17"></label>
      <fieldset class="classpick" style="max-height:none"><legend>Dėl ko (pažymėkite)</legend><div id="regReasons">${reasonsHtml(kind, [])}</div></fieldset>
      <label>Aprašymas / pastabos<textarea name="details" rows="3" maxlength="2000"></textarea></label>
      <label id="regValid">Įspėjimas galioja iki<input type="date" name="validUntil" value="${schoolEnd(date)}"></label>
      <p class="error" id="regErr"></p>
      <div class="dlg-actions"><button type="button" class="btn" data-act="reg-close">Atšaukti</button><button class="btn primary" type="submit">Išduoti numerį</button></div></form></div>`;
    fillKind(kind);
    if (opts.sid || !GROUP.includes(kind)) dlg.querySelector('#regWho').style.display = GROUP.includes(kind) ? 'none' : '';
    dlg.querySelector('#regReasons').innerHTML = reasonsHtml(kind, opts.reasons || []);
    UI.restoreFilters && UI.restoreFilters();
    if (!dlg.open) dlg.showModal();
  }
  function openEdit(e) {
    dialog().innerHTML = `<div class="dlg"><div class="dlg-head"><h3>Taisyti ${esc(e.docNo)}</h3><button type="button" class="icon-btn" data-act="reg-close" aria-label="Uždaryti">&times;</button></div>
      <form data-regform="edit"><input type="hidden" name="id" value="${e.id}">
      <p class="muted">${esc(kname(e.kind))}${e.name ? ' · ' + esc(e.name) : ''}</p>
      <label>Numeris<input name="docNo" value="${esc(e.docNo)}" maxlength="30" required></label>
      <label>Data<input type="date" name="date" value="${e.date}" required></label>
      <fieldset class="classpick" style="max-height:none"><legend>Dėl ko</legend>${reasonsHtml(e.kind, e.reasons || [])}</fieldset>
      <label>Aprašymas / pastabos<textarea name="details" rows="3" maxlength="2000">${esc(e.details)}</textarea></label>
      ${e.kind === 'warn' ? `<label>Galioja iki<input type="date" name="validUntil" value="${e.validUntil || ''}"></label>` : ''}
      <p class="error" id="regErr"></p>
      <div class="dlg-actions"><button type="button" class="btn" data-act="reg-close">Atšaukti</button><button class="btn primary" type="submit">Išsaugoti</button></div></form></div>`;
    dlg.showModal();
  }
  async function onSubmit(ev) {
    ev.preventDefault();
    const fm = ev.target, kind = fm.dataset.regform, fd = new FormData(fm), errEl = dlg.querySelector('#regErr');
    const reasons = fd.getAll('reason');
    try {
      let r;
      if (kind === 'edit') r = await api('/api/register', { action: 'update', id: fd.get('id'), docNo: fd.get('docNo'), date: fd.get('date'), reasons, details: fd.get('details'), validUntil: fd.get('validUntil') || '' });
      else {
        if (fd.get('nmode') === 'manual' && !String(fd.get('docNo') || '').trim()) { errEl.textContent = 'Įrašykite numerį.'; return; }
        const k = fd.get('kind'), ids = GROUP.includes(k) ? [] : fd.getAll('stu');
        if (!GROUP.includes(k) && !ids.length) { errEl.textContent = 'Pasirinkite bent vieną narį.'; return; }
        r = await api('/api/register', { action: 'issue', kind: k, date: fd.get('date'), reasons, details: fd.get('details'), validUntil: k === 'warn' ? fd.get('validUntil') : '', docNo: fd.get('nmode') === 'manual' ? fd.get('docNo') : '',
          items: ids.length ? ids.map((studentId) => ({ studentId })) : [{ name: fd.get('name') || '' }] });
        toast('Išduota: ' + r.issued.map((x) => x.docNo).join(', '));
        if (r.issued[0]) window.__regLast = r.issued;
      }
      E = r.entries; st = 'ok'; dlg.close();
      if (document.getElementById('cardDialog').open) { const sid = fd.getAll('stu')[0]; if (sid) openCard(sid); }
      if (view === 'register') render();
    } catch (e) { errEl.textContent = e.message; }
  }

  /* ---------- dokumento (.docx) sukūrimas iš registro įrašo ---------- */
  function docFor(e) {
    const s = e.studentId ? state.students.find((x) => x.id === e.studentId) : null;
    const coms = s ? (s.classIds || []).map((c) => (state.classes.find((x) => x.id === c) || {}).name).filter(Boolean).join(', ') : '';
    const t = s ? statsAll(s) : {};
    const idx = (REASONS[e.kind] || []).map((r, i) => ((e.reasons || []).includes(r) ? i : -1)).filter((i) => i >= 0);
    const o = { coms, rate: t.rate, date: e.date, author: (Auth.user() || {}).name, nr: e.docNo, details: e.details, validUntil: e.validUntil, reasons: idx };
    const blocks = Forms.many(e.kind === 'other' ? 'cert' : e.kind, s ? [{ id: s.id, first: s.first, last: s.last, grade: s.grade, email: s.email }] : [], () => o);
    Docx.save(`${kname(e.kind)}-${e.docNo}`, Docx.build(blocks, { size: 10, margin: 1000 }));
  }

  /* ---------- nario kortelės skyrius ---------- */
  function cardSection(s) {
    if (!Auth.can('register.view')) return '';
    ensure();
    const w = warnsOf(s.id), vc = validCount(s.id);
    const rows = w.map((e) => `<tr><td class="nowrap">${esc(e.docNo)}</td><td class="nowrap">${esc(e.date)}</td><td>${(e.reasons || []).map(esc).join('; ') || '–'}${e.details ? ' <small class="muted">' + esc(e.details) + '</small>' : ''}</td><td class="nowrap">${esc(e.validUntil || '–')}</td>
      <td>${e.status === 'void' ? '<span class="rate na">panaikinta</span>' : validWarn(e) ? '<span class="rate low">galioja</span>' : '<span class="rate na">nebegalioja</span>'}</td><td><button class="btn small" data-act="reg-doc" data-rid="${e.id}">.docx</button></td></tr>`).join('');
    return `<h4 class="card-sec">Įspėjimai ${vc ? `<span class="rate ${vc >= 2 ? 'low' : 'mid'}">galiojančių: ${vc}</span>` : ''}</h4>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>Nr.</th><th>Data</th><th>Dėl ko</th><th>Galioja iki</th><th>Būsena</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : st === 'loading' ? '<p class="muted">Kraunama…</p>' : '<p class="muted">Įspėjimų nėra.</p>'}
      ${vc >= 2 ? '<p class="error">Du galiojantys įspėjimai – pagal įstatų 6.2.1 p. yra pagrindas svarstyti šalinimą.</p>' : ''}
      ${Auth.can('register.edit') ? `<p><button type="button" class="btn" data-act="reg-warn" data-sid="${s.id}">Skirti įspėjimą</button></p>` : ''}`;
  }

  function csv() {
    const q = (x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    const lines = [['Sistemos Nr.', 'Dokumento Nr.', 'Tipas', 'Kam', 'Klasė', 'Data', 'Dėl ko', 'Aprašymas', 'Galioja iki', 'Būsena'].map(q).join(';')];
    filtered().slice().reverse().forEach((e) => lines.push([e.sysNo, e.docNo, kname(e.kind), e.name, e.grade, e.date, (e.reasons || []).join(' | '), e.details, e.validUntil || '', e.status === 'void' ? 'panaikinta' : 'galioja'].map(q).join(';')));
    download(`registras-${today()}.csv`, '﻿' + lines.join('\r\n'));
  }

  function act(a, el) {
    const byId = () => E.find((x) => x.id === el.dataset.rid);
    switch (a) {
      case 'reg-new': openNew(); return true;
      case 'reg-warn': document.getElementById('cardDialog').close(); openNew({ kind: 'warn', sid: el.dataset.sid }); return true;
      case 'reg-close': dlg && dlg.close(); return true;
      case 'reg-csv': csv(); return true;
      case 'reg-doc': { const e = byId(); if (e) docFor(e); return true; }
      case 'reg-edit': { const e = byId(); if (e) openEdit(e); return true; }
      case 'reg-void': {
        const e = byId(); if (!e) return true;
        UI.prompt('Panaikinti ' + e.docNo, '', { label: 'Panaikinimo priežastis', okText: 'Panaikinti', max: 300 }).then(async (reason) => {
          if (!reason) return;
          try { E = (await api('/api/register', { action: 'void', id: e.id, reason })).entries; render(); } catch (x) { toast(x.message); }
        });
        return true;
      }
      case 'reg-restore': { api('/api/register', { action: 'restore', id: el.dataset.rid }).then((r) => { E = r.entries; render(); }).catch((x) => toast(x.message)); return true; }
      default: return false;
    }
  }
  document.addEventListener('input', (ev) => {
    const k = ev.target && ev.target.dataset && ev.target.dataset.reg; if (!k) return;
    f[k] = ev.target.value;
    if (k === 'q') { const pos = ev.target.selectionStart; render(); const i = document.querySelector('[data-reg="q"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } else render();
  });
  return { render: renderPage, act, cardSection, reload: load, reset: () => { E = []; st = 'idle'; } };
})();
