/* Įrankiai: grupių skirstymas (su išsaugojimu), atsitiktinis mokinio traukimas, redaguojami sąrašai spausdinimui (su šablonais), rizikos sąrašas,
   laiškų siuntimas mokiniams (su šablonais), dublikatų paieška ir sujungimas.
   Čia taip pat yra kalendoriaus kortelė (Tools.calendar), kurią rodo „Apžvalga“.
   Naudoja app.js / auth.js / activities.js funkcijas (state, classStudents, stats, Acts, api, head, esc, toast...). */
const Tools = (() => {
  const TABS = [['groups', 'Grupių skirstymas'], ['draw', 'Atsitiktinis mokinys'], ['lists', 'Sąrašai spausdinimui'], ['risk', 'Rizikos sąrašas'], ['mail', 'Laiškai'], ['dupes', 'Dublikatai']];
  const IGN_KEY = 'attendance-dupe-ignore';
  const loadIgn = () => { try { return new Set(JSON.parse(localStorage.getItem(IGN_KEY) || '[]')); } catch (e) { return new Set(); } };

  let tab = 'groups';
  const S = { src: 'all', grade: '', skip: false, excl: new Set(), pickOpen: false, key: '' };
  const G = { mode: 'n', n: 3, size: 4, mix: false, res: null };
  const D = { n: 1, norepeat: true, drawn: [], hist: [], last: [], busy: false };
  const L = { tpl: '', title: '', sub: 'Data: ____________________', hNr: 'Nr.', hName: 'Vardas, pavardė', hGrade: 'Klasė', num: true, grade: true, cols: [{ n: 'Parašas', w: 'xl' }], extra: 0, rowh: 'normal', fs: 'm', land: false };
  const R = { scope: 'com', from: '', to: '', thr: 80, minDays: 3, streak: 3, acts: true };
  const X = { fuzzy: false, ignore: loadIgn() };
  const C = { m: '', mode: 'com' };
  const M = { onlyRisk: false, to: 'student', tplId: '', subject: '', body: '', test: '', busy: false, status: '', bad: false };
  const OBJ = { S, G, D, L, R, X, C, M };
  let saved = null, savedSt = 'idle', savedErr = '', tpls = [];
  let mailTpls = null, mailTplSt = 'idle', mailFirst = null;

  const cid = () => state.currentClassId;
  const acts = () => (Acts.activitiesOf ? Acts.activitiesOf(cid()) : []);
  const rnd = (n) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const byName = (a, b) => fullName(a).localeCompare(fullName(b), 'lt');
  const dateLt = (d) => new Date(d).toLocaleString('lt-LT', { dateStyle: 'medium', timeStyle: 'short' });
  const comName = (id) => (state.classes.find((c) => c.id === id) || {}).name || '';
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------- šaltinis: komitetas arba veikla, klasė, praleidžiantys ---------- */
  function syncSrc() {
    if (S.src !== 'all' && !acts().some((a) => 'a:' + a.id === S.src)) S.src = 'all';
    const k = cid() + '|' + S.src;
    if (S.key !== k) { S.key = k; S.excl.clear(); }
  }
  function base() {
    syncSrc();
    let list;
    if (S.src === 'all') list = classStudents();
    else { const a = acts().find((x) => 'a:' + x.id === S.src); list = a ? Acts.participants(a) : classStudents(); }
    if (S.grade) list = list.filter((s) => (s.grade || '') === S.grade);
    if (S.skip) list = list.filter((s) => getRec(cid(), today(), s.id).s !== 'A');
    return list.slice().sort(byName);
  }
  const pool = () => base().filter((s) => !S.excl.has(s.id));
  function srcTitle() {
    const a = S.src !== 'all' && acts().find((x) => 'a:' + x.id === S.src);
    return comName(cid()) + (a ? ' · ' + a.name : '') + (S.grade ? ' · ' + S.grade + ' kl.' : '');
  }
  function srcBox() {
    syncSrc();
    const bs = base(), pl = pool();
    const sel = (k, v) => `data-tool="S.${k}"` + (v ? '' : '');
    return `<div class="card no-print"><div class="tool-opts">
      <label>Šaltinis<select ${sel('src')}><option value="all" ${S.src === 'all' ? 'selected' : ''}>Visas komitetas</option>${acts().map((a) => `<option value="a:${a.id}" ${S.src === 'a:' + a.id ? 'selected' : ''}>Veikla: ${esc(a.name)}</option>`).join('')}</select></label>
      <label>Mokinio klasė<select ${sel('grade')}><option value="">Visos</option>${gradeList().map((g) => `<option value="${esc(g)}" ${S.grade === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" ${sel('skip')} ${S.skip ? 'checked' : ''}> Neįtraukti šiandien pažymėtų „Nedalyvavo“</label></div>
      <details class="tool-pick" ${S.pickOpen ? 'open' : ''}><summary>Mokiniai: <b id="tPickCount">${pl.length}</b> iš ${bs.length} <span class="muted">(spauskite, jei reikia pašalinti kuriuos nors)</span></summary>
      <div class="actions" style="margin:10px 0">${UI.filterBox({ scope: '#tPick', rows: 'label.check', placeholder: 'Ieškoti mokinio sąraše…' })}<button class="btn small" data-act="tool-pick-all">Visi</button><button class="btn small" data-act="tool-pick-none">Nė vieno</button></div>
      <div id="tPick" class="pick-list">${bs.map((s) => `<label class="check"><input type="checkbox" data-tx="${s.id}" ${S.excl.has(s.id) ? '' : 'checked'}> ${esc(displayName(s))}${s.grade ? ` <small class="muted">${esc(s.grade)}</small>` : ''}</label>`).join('') || '<p class="muted">Mokinių nėra.</p>'}</div></details></div>`;
  }

  /* ---------- grupės ---------- */
  function makeGroups() {
    const ppl = pool();
    if (ppl.length < 2) { toast('Per mažai mokinių grupėms sudaryti'); return; }
    let n = G.mode === 'n' ? Math.max(1, Math.floor(G.n) || 1) : Math.ceil(ppl.length / Math.max(1, Math.floor(G.size) || 1));
    n = Math.min(n, ppl.length);
    let list = shuffle(ppl);
    if (G.mix) list = list.map((s, i) => ({ s, i })).sort((a, b) => (a.s.grade || '').localeCompare(b.s.grade || '', 'lt', { numeric: true }) || a.i - b.i).map((x) => x.s);
    const groups = Array.from({ length: n }, () => []);
    list.forEach((s, i) => groups[i % n].push(s));
    G.res = {
      groups: groups.map((g) => g.sort(byName).map((s) => s.id)), names: Object.fromEntries(ppl.map((s) => [s.id, displayName(s)])),
      title: '', src: srcTitle(), mode: G.mix ? 'mix' : 'random', activityId: S.src.startsWith('a:') ? S.src.slice(2) : '', at: new Date().toISOString(), savedId: '',
    };
  }
  function loadSaved() {
    if (savedSt === 'loading') return;
    savedSt = 'loading';
    api('/api/tools').then((r) => { saved = r.groups; tpls = r.templates || []; savedErr = ''; }).catch((e) => { savedErr = e.message; saved = []; }).finally(() => { savedSt = 'ready'; if (view === 'tools') render(); });
  }
  const nameOf = (id, res) => { const s = state.students.find((x) => x.id === id); return s ? displayName(s) : (res.names[id] || '?') + ' (nebėra sąraše)'; };
  const gradeOf = (id) => { const s = state.students.find((x) => x.id === id); return s ? s.grade || '' : ''; };

  function groupsOut() {
    const r = G.res;
    if (!r) return '';
    const total = r.groups.reduce((n, g) => n + g.length, 0);
    return `<div class="print-only print-title"><h2>${esc(r.title || 'Grupės')}</h2><p>${esc(r.src || '')} · ${esc(dateLt(r.at))} · grupių: ${r.groups.length} · mokinių: ${total}</p></div>
      <div class="card"><div class="tool-bar no-print"><div><h2>${r.title ? esc(r.title) : 'Rezultatas'}</h2><p class="sub" style="margin:0">Grupių: ${r.groups.length} · mokinių: ${total}${r.savedId ? ' · išsaugota' : ''}</p></div>
      <div class="actions"><button class="btn small" data-act="tool-groups">Perskirstyti</button><button class="btn small" data-act="tool-print" data-t="groups">${ICON.print} Spausdinti</button><button class="btn small" data-act="tool-csv" data-t="groups">CSV</button>${r.savedId ? '' : `<button class="btn small primary" data-act="tool-gsave">Išsaugoti…</button>`}</div></div>
      <div class="grp-grid">${r.groups.map((g, i) => `<div class="grp"><h4>Grupė ${i + 1} <small>${g.length}</small></h4><ol>${g.map((id) => `<li>${esc(nameOf(id, r))}${gradeOf(id) ? ` <small class="muted">${esc(gradeOf(id))}</small>` : ''}</li>`).join('')}</ol></div>`).join('')}</div></div>`;
  }
  function savedCard() {
    if (saved === null && savedSt === 'idle') loadSaved();
    const mine = (saved || []).filter((g) => g.classId === cid());
    const rows = mine.map((g) => `<tr><td><b>${esc(g.name)}</b></td><td class="nowrap">${esc(dateLt(g.createdAt))}</td><td class="hide-sm">${esc(g.by || '')}</td><td class="num">${g.data.groups.length}</td>
      <td class="row-actions"><button class="btn small" data-act="tool-gopen" data-gid="${g.id}">Atidaryti</button> <button class="btn small danger" data-act="tool-gdel" data-gid="${g.id}">Ištrinti</button></td></tr>`).join('');
    return `<div class="card no-print"><h2>Išsaugoti sugrupavimai · ${esc(comName(cid()))}</h2>
      ${savedErr ? `<p class="muted">${esc(savedErr)}</p>` : saved === null ? '<p class="muted">Kraunama…</p>' : mine.length
        ? `${mine.length > 6 ? UI.filterBox({ scope: '#savedTbl', placeholder: 'Ieškoti pagal pavadinimą…' }) : ''}<div class="table-wrap"><table id="savedTbl"><thead><tr><th>Pavadinimas</th><th>Sukurta</th><th class="hide-sm">Sukūrė</th><th class="num">Grupių</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="muted">Išsaugotų sugrupavimų šiame komitete dar nėra.</p>'}</div>`;
  }
  function renderGroups() {
    return srcBox() + `<div class="card no-print"><div class="tool-opts">
      <label>Skirstyti pagal<select data-tool="G.mode"><option value="n" ${G.mode === 'n' ? 'selected' : ''}>Grupių skaičių</option><option value="size" ${G.mode === 'size' ? 'selected' : ''}>Mokinių skaičių grupėje</option></select></label>
      ${G.mode === 'n' ? `<label>Grupių skaičius<input type="number" min="1" max="50" data-tool="G.n" value="${G.n}"></label>` : `<label>Mokinių grupėje<input type="number" min="1" max="100" data-tool="G.size" value="${G.size}"></label>`}
      <label class="check"><input type="checkbox" data-tool="G.mix" ${G.mix ? 'checked' : ''}> Maišyti klases (kiekvienoje grupėje skirtingų klasių mokiniai)</label>
      <button class="btn primary" data-act="tool-groups">Sudaryti grupes</button></div></div>` + groupsOut() + savedCard();
  }

  /* ---------- atsitiktinis mokinys ---------- */
  function doDraw() {
    if (D.busy) return;
    const left = pool().filter((s) => !D.norepeat || !D.drawn.includes(s.id));
    if (!left.length) { toast(D.norepeat ? 'Visi mokiniai jau ištraukti – pradėkite iš naujo' : 'Nėra mokinių'); return; }
    const pick = shuffle(left).slice(0, Math.min(Math.max(1, Math.floor(D.n) || 1), left.length));
    const fin = () => { D.busy = false; D.last = pick.map((s) => s.id); D.drawn.push(...D.last); D.hist.unshift({ t: Date.now(), ids: D.last.slice() }); render(); };
    const big = document.getElementById('drawBig');
    if (!big) { fin(); return; }
    D.busy = true; big.classList.add('rolling');
    const names = left.map(displayName); let k = 0;
    const iv = setInterval(() => { big.textContent = names[rnd(names.length)]; if (++k >= 16) { clearInterval(iv); fin(); } }, 70);
  }
  function renderDraw() {
    const byId = new Map(state.students.map((s) => [s.id, s]));
    const left = pool().filter((s) => !D.norepeat || !D.drawn.includes(s.id)).length;
    const nm = (id) => (byId.get(id) ? displayName(byId.get(id)) : '?');
    return srcBox() + `<div class="card"><div class="tool-opts no-print">
      <label>Kiek mokinių traukti<input type="number" min="1" max="50" data-tool="D.n" value="${D.n}"></label>
      <label class="check"><input type="checkbox" data-tool="D.norepeat" ${D.norepeat ? 'checked' : ''}> Nekartoti jau ištrauktų</label>
      <button class="btn primary" data-act="tool-draw">🎲 Traukti</button><button class="btn" data-act="tool-draw-reset">Pradėti iš naujo</button></div>
      <div class="draw-stage" id="drawBig">${D.last.length ? D.last.map((id) => `<div class="draw-name">${byId.get(id) ? avatar(byId.get(id)) : ''}<span>${esc(nm(id))}</span></div>`).join('') : '<span class="muted">Paspauskite „Traukti“</span>'}</div>
      <p class="muted" style="text-align:center;margin:8px 0 0">Liko neištrauktų: <b>${left}</b> · ištraukta: ${D.drawn.length}</p></div>
      ${D.hist.length ? `<div class="card no-print"><h2>Istorija</h2><ol class="draw-hist">${D.hist.slice(0, 12).map((h) => `<li><span class="muted">${new Date(h.t).toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> ${h.ids.map((id) => esc(nm(id))).join(', ')}</li>`).join('')}</ol></div>` : ''}`;
  }

  /* ---------- sąrašai spausdinimui: viskas redaguojama, nustatymai saugomi šablonuose ---------- */
  const WIDTHS = [['auto', 'Automatinis'], ['xs', 'Labai siauras'], ['s', 'Siauras'], ['m', 'Vidutinis'], ['l', 'Platus'], ['xl', 'Labai platus']];
  const PCT = { xs: 5, s: 9, m: 15, l: 25, xl: 38 };
  const wStyle = (w) => (PCT[w] ? ` style="width:${PCT[w]}%"` : '');
  /* Sąrašo nustatymai vienodu pavidalu (tinka ir senesnio formato šablonams). */
  function normTpl(d) {
    d = d || {};
    let cols = Array.isArray(d.cols) ? d.cols : null;
    if (!cols) {
      if (d.type === 'blank') { const h = String(d.heads || '').split(','); cols = Array.from({ length: Math.max(0, Math.min(10, Number(d.cols) || 0)) }, (_, i) => ({ n: (h[i] || '').trim(), w: 'auto' })); }
      else cols = [{ n: 'Parašas', w: 'xl' }];
    }
    return {
      title: d.title || '', sub: d.sub !== undefined ? d.sub : 'Data: ____________________',
      hNr: d.hNr !== undefined ? d.hNr : 'Nr.', hName: d.hName !== undefined ? d.hName : 'Vardas, pavardė', hGrade: d.hGrade !== undefined ? d.hGrade : 'Klasė',
      num: d.num !== false, grade: d.grade !== false, cols: cols.map((c) => ({ n: String((c && c.n) || ''), w: (c && c.w) || 'auto' })),
      extra: Number(d.extra) || 0, rowh: d.rowh || 'normal', fs: d.fs || 'm', land: !!d.land,
    };
  }
  const tplData = () => normTpl(L);
  const curTpl = () => tpls.find((t) => t.id === L.tpl);
  function applyTpl() { const t = curTpl(); if (t) Object.assign(L, normTpl(t.data)); }
  async function tplSave(id, name, data) {
    try {
      const r = await api('/api/tools', { action: 'tpl-save', id, name, data });
      tpls = r.templates; L.tpl = r.id; toast(id ? 'Šablonas išsaugotas' : 'Šablonas sukurtas');
    } catch (e) { toast(e.message); }
    render();
  }
  function tplBox() {
    if (saved === null && savedSt === 'idle') loadSaved();
    const cur = curTpl(), can = Auth.can('tools.save');
    const changed = cur && JSON.stringify(normTpl(cur.data)) !== JSON.stringify(tplData());
    return `<div class="card no-print"><div class="tool-opts">
      <label>Šablonas<select data-tool="L.tpl"><option value="">– be šablono –</option>${tpls.map((t) => `<option value="${t.id}" ${t.id === L.tpl ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      ${can && cur ? `<button class="btn small ${changed ? 'primary' : ''}" data-act="tool-tpl-update">Išsaugoti šablono pakeitimus</button><button class="btn small" data-act="tool-tpl-rename">Pervadinti</button><button class="btn small danger" data-act="tool-tpl-del">Ištrinti</button>` : ''}
      ${can ? `<button class="btn small" data-act="tool-tpl-new">${ICON.plus} Naujas šablonas iš šių nustatymų</button>` : ''}</div>
      <p class="sub" style="margin:10px 0 0">${cur
        ? (changed ? 'Nustatymai pakeisti – paspauskite „Išsaugoti šablono pakeitimus“, kad šablonas būtų atnaujintas.' : 'Šablonas pritaikytas. Norėdami jį redaguoti, keiskite nustatymus ar lentelę žemiau.')
        : 'Šablonas išsaugo visus sąrašo nustatymus: pavadinimą, stulpelius, jų pavadinimus ir plotį, eilutes, šriftą ir lapo padėtį. Šablonai bendri visiems komitetams.'}</p></div>`;
  }
  const hIn = (attrs, v, ph) => `<input class="th-in no-print" ${attrs} value="${esc(v)}" placeholder="${esc(ph)}" maxlength="60"><span class="print-only">${esc(v)}</span>`;
  function renderLists() {
    const ppl = pool();
    const title = L.title.trim() || 'Sąrašas – ' + srcTitle();
    const extra = Math.max(0, Math.min(40, Math.floor(L.extra) || 0));
    const rowCls = L.rowh === 'normal' ? '' : L.rowh;
    const blank = L.cols.map(() => '<td></td>').join('');
    const nCols = (L.num ? 1 : 0) + 1 + (L.grade ? 1 : 0) + L.cols.length;
    const row = (i, s) => `<tr class="${rowCls}">${L.num ? `<td class="num">${i + 1}</td>` : ''}<td>${s ? `<b>${esc(displayName(s))}</b>` : ''}</td>${L.grade ? `<td>${s ? esc(s.grade || '') : ''}</td>` : ''}${blank}</tr>`;
    const rows = ppl.map((s, i) => row(i, s)).join('') + Array.from({ length: extra }, (_, i) => row(ppl.length + i, null)).join('');
    const thead = `${L.num ? `<th class="num" style="width:6%">${hIn('data-lh="hNr"', L.hNr, 'Nr.')}</th>` : ''}<th>${hIn('data-lh="hName"', L.hName, 'Vardas, pavardė')}</th>${L.grade ? `<th style="width:9%">${hIn('data-lh="hGrade"', L.hGrade, 'Klasė')}</th>` : ''}` +
      L.cols.map((c, i) => `<th${wStyle(c.w)}>${hIn(`data-lcol="${i}" data-lf="n"`, c.n, 'Stulpelis ' + (i + 1))}</th>`).join('');
    const colRows = L.cols.map((c, i) => `<div class="col-row"><span class="muted">${i + 1}.</span>
      <input data-lcol="${i}" data-lf="n" value="${esc(c.n)}" placeholder="Stulpelio pavadinimas" maxlength="60">
      <select data-lcol="${i}" data-lf="w" aria-label="Stulpelio plotis">${WIDTHS.map(([k, l]) => `<option value="${k}" ${c.w === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn small" data-act="tool-lcol" data-op="up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="Perkelti kairiau">←</button>
      <button class="btn small" data-act="tool-lcol" data-op="down" data-i="${i}" ${i < L.cols.length - 1 ? '' : 'disabled'} aria-label="Perkelti dešiniau">→</button>
      <button class="btn small danger" data-act="tool-lcol" data-op="del" data-i="${i}" aria-label="Pašalinti stulpelį">×</button></div>`).join('');
    return srcBox() + tplBox() + `<div class="card no-print"><div class="tool-opts">
      <label>Pavadinimas<input data-tool="L.title" value="${esc(L.title)}" placeholder="${esc(title)}" maxlength="150"></label>
      <label>Eilutė po pavadinimu<input data-tool="L.sub" value="${esc(L.sub)}" placeholder="pvz. Data: ____________" maxlength="200"></label>
      <label>Papildomų tuščių eilučių<input type="number" min="0" max="40" data-tool="L.extra" value="${extra}"></label>
      <label>Eilučių aukštis<select data-tool="L.rowh"><option value="compact" ${L.rowh === 'compact' ? 'selected' : ''}>Žemas</option><option value="normal" ${L.rowh === 'normal' ? 'selected' : ''}>Įprastas</option><option value="tall" ${L.rowh === 'tall' ? 'selected' : ''}>Aukštas (parašams)</option></select></label>
      <label>Šrifto dydis<select data-tool="L.fs"><option value="s" ${L.fs === 's' ? 'selected' : ''}>Mažas</option><option value="m" ${L.fs === 'm' ? 'selected' : ''}>Įprastas</option><option value="l" ${L.fs === 'l' ? 'selected' : ''}>Didelis</option></select></label>
      <label class="check"><input type="checkbox" data-tool="L.num" ${L.num ? 'checked' : ''}> Rodyti numerį</label>
      <label class="check"><input type="checkbox" data-tool="L.grade" ${L.grade ? 'checked' : ''}> Rodyti klasę</label>
      <label class="check"><input type="checkbox" data-tool="L.land" ${L.land ? 'checked' : ''}> Gulsčias lapas</label></div>
      <h2 style="margin-top:18px">Papildomi stulpeliai</h2>
      <div class="col-list">${colRows || '<p class="muted" style="margin:0">Papildomų stulpelių nėra.</p>'}</div>
      <div class="actions" style="margin-top:12px"><button class="btn small" data-act="tool-lcol" data-op="add">${ICON.plus} Pridėti stulpelį</button>
      <button class="btn small" data-act="tool-lpreset" data-p="sign">Pasirašymo lapas</button><button class="btn small" data-act="tool-lpreset" data-p="blank">Tuščia lentelė</button>
      <span class="spacer"></span><button class="btn small" data-act="tool-print" data-t="lists">${ICON.print} Spausdinti</button><button class="btn small" data-act="tool-csv" data-t="lists">CSV</button></div>
      <p class="sub" style="margin:10px 0 0">Stulpelių pavadinimus galite keisti ir tiesiai lentelės antraštėje žemiau.</p></div>
      ${L.land ? '<style>@page { size: A4 landscape; }</style>' : ''}
      <div class="card"><div class="sheet-head"><h2>${esc(title)}</h2>${L.sub.trim() ? `<p>${esc(L.sub)}</p>` : ''}</div>
      <div class="table-wrap"><table class="sheet fs-${esc(L.fs)}"><thead><tr>${thead}</tr></thead><tbody>${rows || `<tr><td colspan="${nCols}" class="muted">Mokinių nėra.</td></tr>`}</tbody></table></div></div>`;
  }

  /* ---------- rizikos sąrašas ---------- */
  /* Vieno mokinio lankomumo suvestinė (naudoja rizikos sąrašas ir laiškų kintamieji). null – mokinys nepriklauso nurodytiems komitetams. */
  function calcRow(s, ids, actOpts, from, to, useActs) {
    const mine = (s.classIds || []).filter((c) => ids.includes(c));
    if (!mine.length) return null;
    const t = { P: 0, A: 0, L: 0, E: 0 }, seq = [];
    mine.forEach((c) => {
      const x = stats(c, s.id, from, to);
      t.P += x.P; t.A += x.A; t.L += x.L; t.E += x.E;
      const recs = state.records[c] || {};
      for (const d in recs) { if ((from && d < from) || (to && d > to)) continue; const r = recs[d][s.id]; if (r && r.s) seq.push([d, r.s]); }
    });
    if (useActs) {
      const x = Acts.totals(s.id, actOpts); t.P += x.P; t.A += x.A; t.L += x.L; t.E += x.E;
      Acts.marks(s.id, actOpts).forEach((m) => { if (m.s) seq.push([m.d, m.s]); }); /* veiklų užsiėmimai įskaičiuojami į „iš eilės“ ir „paskutinis praleidimas“ */
    }
    seq.sort((a, b) => a[0].localeCompare(b[0]));
    let streak = 0, lastAbs = '';
    for (let i = seq.length - 1; i >= 0; i--) { if (seq[i][1] === 'A') streak++; else if (seq[i][1] === 'E') continue; else break; }
    seq.forEach(([d, st]) => { if (st === 'A') lastAbs = d; });
    const den = t.P + t.L + t.A, rate = den ? Math.round(((t.P + t.L) / den) * 100) : null;
    return { t, rate, den, streak, lastAbs, coms: mine.map(comName).sort((a, b) => a.localeCompare(b, 'lt', { numeric: true })).join(', ') };
  }
  function riskRows() {
    const ids = R.scope === 'all' ? state.classes.map((c) => c.id) : [cid()];
    const from = R.from || undefined, to = R.to || undefined;
    const useActs = R.acts && Auth.can('activities.view');
    const ao = R.scope === 'all' ? { from, to } : { cid: cid(), from, to };
    const out = [];
    state.students.forEach((s) => {
      const r = calcRow(s, ids, ao, from, to, useActs);
      if (!r) return;
      const low = r.rate != null && r.rate < R.thr && r.den >= R.minDays, run = R.streak > 0 && r.streak >= R.streak;
      if (low || run) out.push({ s, ...r });
    });
    return out.sort((a, b) => (a.rate == null ? 101 : a.rate) - (b.rate == null ? 101 : b.rate) || b.streak - a.streak);
  }
  function renderRisk() {
    const rows = riskRows();
    const per = R.from || R.to ? `${R.from || '…'} – ${R.to || '…'}` : 'visas laikotarpis';
    return `<div class="card no-print"><div class="tool-opts">
      <label>Apimtis<select data-tool="R.scope"><option value="com" ${R.scope === 'com' ? 'selected' : ''}>Šis komitetas</option><option value="all" ${R.scope === 'all' ? 'selected' : ''}>Visi komitetai</option></select></label>
      <label>Nuo<input type="date" data-tool="R.from" value="${esc(R.from)}"></label><label>Iki<input type="date" data-tool="R.to" value="${esc(R.to)}"></label>
      <label>Lankomumas žemiau, %<input type="number" min="1" max="100" data-tool="R.thr" value="${R.thr}"></label>
      <label>Bent pažymėtų dienų<input type="number" min="1" max="100" data-tool="R.minDays" value="${R.minDays}"></label>
      <label>Praleista iš eilės (0 – nežiūrėti)<input type="number" min="0" max="30" data-tool="R.streak" value="${R.streak}"></label>
      ${Auth.can('activities.view') ? `<label class="check"><input type="checkbox" data-tool="R.acts" ${R.acts ? 'checked' : ''}> Įskaičiuoti veiklų lankomumą</label>` : ''}
      <button class="btn small" data-act="tool-print" data-t="risk">${ICON.print} Spausdinti</button><button class="btn small" data-act="tool-csv" data-t="risk">CSV</button>${Auth.can('tools.save') ? '<button class="btn small primary" data-act="tool-mail-risk">✉ Siųsti laišką</button>' : ''}</div></div>
      <div class="print-only print-title"><h2>Rizikos sąrašas – ${R.scope === 'all' ? 'visi komitetai' : esc(comName(cid()))}</h2><p>${esc(per)} · lankomumas žemiau ${R.thr}%${R.streak ? ` arba ${R.streak}+ praleidimai iš eilės` : ''}</p></div>
      <div class="card"><h2>Reikia dėmesio: ${rows.length}</h2><p class="sub no-print">Rodiklis = (dalyvavo + vėlavo) ÷ (dalyvavo + vėlavo + nedalyvavo). „Iš eilės“ skaičiuojama pagal komiteto dienų žymas; pateisintos dienos serijos nenutraukia.</p>
      ${rows.length ? `${UI.filterBox({ fk: 'risk', scope: '#riskTbl', placeholder: 'Ieškoti mokinio sąraše…' })}<div class="table-wrap"><table id="riskTbl"><thead><tr><th>Mokinys</th><th class="hide-sm">Komitetai</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Iš eilės</th><th class="hide-sm">Paskutinis praleidimas</th><th class="num">Rodiklis</th></tr></thead><tbody>${rows.map((x) =>
        `<tr><td><div class="who">${avatar(x.s)}<div><b class="name-link" data-act="student-card" data-sid="${x.s.id}" role="button" tabindex="0">${esc(displayName(x.s))}</b>${x.s.grade ? `<small>${esc(x.s.grade)} kl.</small>` : ''}</div></div></td><td class="hide-sm">${esc(x.coms)}</td><td class="num">${x.t.A}</td><td class="num">${x.t.L}</td><td class="num">${x.streak}</td><td class="hide-sm">${esc(x.lastAbs || '–')}</td><td class="num">${rateBadge(x.rate)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Pagal šiuos kriterijus nieko nerasta. Puiku!</p>'}</div>`;
  }

  /* ---------- laiškai mokiniams: gavėjai, turinys, šablonai ---------- */
  const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
  const MAIL_CHUNK = 15; /* kiek laiškų siunčiama per vieną užklausą (Vercel funkcijos laiko riba) */
  const MAIL_PRESETS = [
    { id: 'b:risk', name: 'Dėl lankomumo', subject: 'Dėl lankomumo', body: 'Sveiki, {vardas},\n\npastebėjome, kad Jūsų lankomumas komitete „{komitetas}“ šiuo metu yra {rodiklis} (nedalyvavote {nedalyvavo} kartus). Prašome susisiekti su manimi ir aptarti, kuo galime padėti.\n\nPagarbiai,\n{mano_vardas}' },
    { id: 'b:remind', name: 'Priminimas apie susirinkimą', subject: 'Priminimas: {komitetas} susirinkimas', body: 'Sveiki, {vardas},\n\npriminame, kad netrukus vyks komiteto „{komitetas}“ susirinkimas.\nData ir laikas: ____________\nVieta: ____________\n\nLaukiame Jūsų!\n{mano_vardas}' },
    { id: 'b:thanks', name: 'Padėka už dalyvavimą', subject: 'Ačiū už dalyvavimą', body: 'Sveiki, {vardas},\n\ndėkojame už aktyvų dalyvavimą komiteto „{komitetas}“ veikloje. Jūsų indėlis labai vertinamas.\n\nPagarbiai,\n{mano_vardas}' },
    { id: 'b:blank', name: 'Tuščias laiškas', subject: '', body: 'Sveiki, {vardas},\n\n\n\nPagarbiai,\n{mano_vardas}' },
  ];
  const MAIL_VARS = [['vardas', 'vardas'], ['pavarde', 'pavardė'], ['klase', 'klasė'], ['komitetas', 'komitetas'], ['rodiklis', 'rodiklis'], ['nedalyvavo', 'nedalyvavo'], ['velavo', 'vėlavo'], ['ireiles', 'iš eilės'], ['mano_vardas', 'mano vardas']];
  const myName = () => { try { return (Auth.user() || {}).name || ''; } catch (e) { return ''; } };
  const fillT = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
  const allPresets = () => MAIL_PRESETS.concat(mailTpls || []);
  const curPreset = () => allPresets().find((p) => p.id === M.tplId);
  const isSavedPreset = (p) => !!p && !String(p.id).startsWith('b:');

  function loadMailTpls() {
    if (mailTplSt === 'loading') return;
    mailTplSt = 'loading';
    api('/api/send-email', { action: 'tpl-list' }).then((r) => { mailTpls = r.templates || []; }).catch(() => { mailTpls = []; })
      .finally(() => { mailTplSt = 'ready'; if (view === 'tools' && tab === 'mail') render(); });
  }
  function applyMailTpl() { const p = curPreset(); if (p) { M.subject = p.subject; M.body = p.body; } }
  function mailVars(s) {
    const from = R.from || undefined, to = R.to || undefined;
    const r = calcRow(s, [cid()], { cid: cid(), from, to }, from, to, R.acts && Auth.can('activities.view'));
    return {
      rodiklis: r && r.rate != null ? r.rate + '%' : '–', nedalyvavo: String(r ? r.t.A : 0), velavo: String(r ? r.t.L : 0), ireiles: String(r ? r.streak : 0),
      komitetas: comName(cid()), klase: s.grade || '',
    };
  }
  function mailRecipients() {
    let list = pool();
    if (M.onlyRisk) { const ids = new Set(riskRows().map((x) => x.s.id)); list = list.filter((s) => ids.has(s.id)); }
    return list.map((s) => ({ s, email: String((M.to === 'parent' ? s.parentEmail : s.email) || '').trim(), vars: mailVars(s) }));
  }
  const mailOk = (r) => EMAIL_RE.test(r.email);
  function mailPreviewHtml() {
    const f = mailFirst;
    if (!f) return '<span class="muted">Nėra gavėjų – pasirinkite mokinius.</span>';
    const v = { vardas: f.s.first, pavarde: f.s.last, ...f.vars, mano_vardas: myName() };
    return `<div class="muted" style="font-size:.8rem;margin-bottom:4px">Peržiūra pirmam gavėjui (${esc(displayName(f.s))}${f.email ? ' · ' + esc(f.email) : ''})</div><b>${esc(fillT(M.subject, v) || '(be temos)')}</b><div style="white-space:pre-wrap;margin-top:6px">${esc(fillT(M.body, v))}</div>`;
  }
  function mailPreview() { const p = document.getElementById('mPrev'); if (p) p.innerHTML = mailPreviewHtml(); }
  function mailStatus(html, bad) {
    M.status = html; M.bad = !!bad;
    const s = document.getElementById('mStatus');
    if (s) { s.innerHTML = html; s.style.color = bad ? 'var(--danger, #c0392b)' : ''; }
  }
  function renderMail() {
    if (mailTpls === null && mailTplSt === 'idle') loadMailTpls();
    const recs = mailRecipients(), ok = recs.filter(mailOk), bad = recs.filter((r) => !mailOk(r));
    mailFirst = ok[0] || recs[0] || null;
    const can = Auth.can('tools.save'), cur = curPreset(), parent = M.to === 'parent';
    const opt = (p) => `<option value="${esc(p.id)}" ${p.id === M.tplId ? 'selected' : ''}>${esc(p.name)}</option>`;
    const savedList = (mailTpls || []);
    return srcBox() + `<div class="card no-print"><h2>Gavėjai</h2><div class="tool-opts">
      <label>Siųsti į<select data-tool="M.to"><option value="student" ${parent ? '' : 'selected'}>Mokinio el. paštą</option><option value="parent" ${parent ? 'selected' : ''}>Tėvų el. paštą</option></select></label>
      <label class="check"><input type="checkbox" data-tool="M.onlyRisk" ${M.onlyRisk ? 'checked' : ''}> Tik rizikos sąrašo mokiniai (kriterijai – skiltyje „Rizikos sąrašas“)</label></div>
      <p style="margin:10px 0 0"><b>Gavėjų: ${ok.length}</b>${bad.length ? ` <span class="muted">· be ${parent ? 'tėvų ' : ''}el. pašto: ${bad.length}</span>` : ''}</p>
      ${bad.length ? `<details style="margin-top:6px"><summary class="muted">Kam laiškas nebus išsiųstas (${bad.length})</summary><p class="muted" style="margin:6px 0 0">${bad.map((r) => esc(displayName(r.s))).join(', ')}</p></details>` : ''}
      <p class="sub" style="margin:8px 0 0">Gavėjus pasirinkite aukščiau („Šaltinis“, klasė, mokinių sąrašas). Kiekvienam išsiunčiamas atskiras laiškas – vieni gavėjai kitų nemato.</p></div>
      <div class="card no-print"><h2>Laiško turinys</h2>
      <div class="tool-opts"><label>Šablonas<select data-tool="M.tplId"><option value="">– pasirinkite šabloną –</option><optgroup label="Standartiniai">${MAIL_PRESETS.map(opt).join('')}</optgroup>${savedList.length ? `<optgroup label="Išsaugoti">${savedList.map(opt).join('')}</optgroup>` : ''}</select></label>
      ${can ? `<button class="btn small" data-act="tool-mtpl-new">${ICON.plus} Išsaugoti kaip naują šabloną</button>${isSavedPreset(cur) ? '<button class="btn small primary" data-act="tool-mtpl-update">Atnaujinti šabloną</button><button class="btn small" data-act="tool-mtpl-rename">Pervadinti</button><button class="btn small danger" data-act="tool-mtpl-del">Ištrinti</button>' : ''}` : ''}</div>
      <label class="ui-lbl" style="display:block;margin-top:12px">Tema<input class="ui-input" data-mail="subject" maxlength="150" value="${esc(M.subject)}" placeholder="Laiško tema" autocomplete="off" style="width:100%"></label>
      <label class="ui-lbl" style="display:block;margin-top:10px">Laiško tekstas<textarea id="mBody" data-mail="body" rows="10" maxlength="5000" style="width:100%" placeholder="Laiško tekstas">${esc(M.body)}</textarea></label>
      <div class="actions" style="margin-top:8px;flex-wrap:wrap"><span class="muted" style="font-size:.85rem">Įterpti:</span>${MAIL_VARS.map(([k, l]) => `<button type="button" class="btn small" data-act="tool-mail-ins" data-v="${k}">${esc(l)}</button>`).join('')}</div>
      <p class="sub" style="margin:8px 0 0">Kiekvienam gavėjui šie laukai užpildomi automatiškai (rodiklis, nedalyvavo ir kt. – pagal šio komiteto lankomumą).</p>
      <div id="mPrev" class="preview" style="margin-top:12px;padding:12px">${mailPreviewHtml()}</div></div>
      <div class="card no-print"><div class="tool-opts"><label>Bandomasis laiškas į<input type="email" data-mail="test" value="${esc(M.test)}" placeholder="jūsų el. paštas" autocomplete="off"></label>
      <button class="btn small" data-act="tool-mail-test" ${can ? '' : 'disabled'}>Išsiųsti bandomąjį</button>
      <span class="spacer"></span><button class="btn primary" id="mSend" data-act="tool-mail-send" ${can && ok.length ? '' : 'disabled'}>✉ Siųsti: ${ok.length}</button></div>
      <div id="mStatus" class="muted" style="margin-top:10px;min-height:1.2em${M.bad ? ';color:var(--danger, #c0392b)' : ''}">${M.status}</div>
      ${can ? '' : '<p class="muted" style="margin:8px 0 0">Laiškams siųsti reikia leidimo „tools.save“.</p>'}</div>`;
  }
  function mailInsert(key) {
    const ta = document.getElementById('mBody');
    if (!ta) return;
    const tok = '{' + key + '}', a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + tok + ta.value.slice(b);
    ta.focus(); ta.selectionStart = ta.selectionEnd = a + tok.length;
    M.body = ta.value; mailPreview();
  }
  async function mailSaveTpl(id, name) {
    try {
      const r = await api('/api/send-email', { action: 'tpl-save', id, name, subject: M.subject.trim(), body: M.body });
      mailTpls = r.templates; M.tplId = r.id; toast(id ? 'Šablonas išsaugotas' : 'Šablonas sukurtas');
    } catch (e) { toast(e.message); }
    render();
  }
  function mailPayload(items, extra) {
    const me = { mano_vardas: myName() };
    return { to: M.to, subject: fillT(M.subject.trim(), me), message: fillT(M.body.trim(), me), items: items.map((r) => ({ id: r.s.id, vars: r.vars })), ...extra };
  }
  async function mailTest() {
    if (M.busy) return;
    const to = M.test.trim(), first = mailFirst;
    if (!M.subject.trim() || !M.body.trim()) { mailStatus('Įrašykite laiško temą ir tekstą.', true); return; }
    if (!EMAIL_RE.test(to)) { mailStatus('Įrašykite savo el. paštą bandomajam laiškui.', true); return; }
    if (!first) { mailStatus('Nėra gavėjų – bandomajam laiškui reikia bent vieno mokinio duomenų.', true); return; }
    M.busy = true; mailStatus('Siunčiamas bandomasis laiškas…');
    try { await api('/api/send-email', mailPayload([first], { testTo: to })); mailStatus(`Bandomasis laiškas išsiųstas į ${esc(to)} (pavyzdys: ${esc(displayName(first.s))}).`); }
    catch (e) { mailStatus('Klaida: ' + esc(e.message), true); }
    M.busy = false;
  }
  async function mailSend() {
    if (M.busy) return;
    const recs = mailRecipients().filter(mailOk);
    if (!recs.length) { toast('Nėra gavėjų su el. paštu'); return; }
    if (!M.subject.trim() || !M.body.trim()) { mailStatus('Įrašykite laiško temą ir tekstą.', true); return; }
    const ok = await UI.confirm(`Išsiųsti laišką ${recs.length} gavėjams (${M.to === 'parent' ? 'tėvams' : 'mokiniams'})?\n\nTema: ${M.subject.trim()}\n\nŠio veiksmo atšaukti negalima.`, { title: 'Patvirtinkite siuntimą', okText: 'Siųsti' });
    if (!ok) return;
    M.busy = true;
    const btn = document.getElementById('mSend'); if (btn) btn.disabled = true;
    const sent = [], failed = [], skipped = [];
    let err = null;
    try {
      for (let i = 0; i < recs.length; i += MAIL_CHUNK) {
        mailStatus(`Siunčiama… ${sent.length + failed.length} iš ${recs.length}`);
        const r = await api('/api/send-email', mailPayload(recs.slice(i, i + MAIL_CHUNK)));
        sent.push(...r.sent); failed.push(...r.failed); skipped.push(...r.skipped);
      }
    } catch (e) { err = e; }
    M.busy = false;
    const b2 = document.getElementById('mSend'); if (b2) b2.disabled = false;
    const bad = failed.map((f) => ({ name: f.name, error: f.error })).concat(skipped.map((s) => ({ name: s.name, error: s.reason })));
    mailStatus(`<b>Išsiųsta: ${sent.length}</b>${bad.length ? ` · nepavyko / praleista: ${bad.length}` : ''}${err ? `<br>Siuntimas nutrauktas: ${esc(err.message)}. Likusiems laiškai neišsiųsti.` : ''}` +
      (bad.length ? `<br><small>${bad.slice(0, 15).map((x) => esc(x.name) + ' – ' + esc(x.error)).join('<br>')}${bad.length > 15 ? '<br>…' : ''}</small>` : ''), !!err || (!sent.length && !!bad.length));
    toast(`Išsiųsta laiškų: ${sent.length}${bad.length ? ` · nepavyko: ${bad.length}` : ''}`);
  }

  /* ---------- kalendorius (rodomas „Apžvalgoje“) ---------- */
  const MONTHS = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'];
  function calendarCard() {
    if (!cid()) return '';
    if (!C.m) C.m = today().slice(0, 7);
    const canAll = Auth.can('calendar.all');
    const all = canAll && C.mode === 'all'; // bendras visų matomų komitetų kalendorius
    const [y, m] = C.m.split('-').map(Number);
    const days = new Date(y, m, 0).getDate(), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // savaitė prasideda pirmadieniu
    const t = today();
    const coms = all ? state.classes.slice().sort((a, b) => a.name.localeCompare(b.name, 'lt', { numeric: true })) : state.classes.filter((c) => c.id === cid());
    const canActs = Auth.can('activities.view');
    let cells = '<div class="cal-day out"></div>'.repeat(lead), nSess = 0;
    for (let n = 1; n <= days; n++) {
      const d = `${y}-${pad2(m)}-${pad2(n)}`;
      const ss = [];
      let marked = 0;
      coms.forEach((c) => {
        if (canActs) Acts.sessionsOn(c.id, d).forEach((s) => ss.push({ s, com: c.name }));
        const day = (state.records[c.id] || {})[d];
        if (day) for (const sid in day) if (day[sid] && day[sid].s) marked++;
      });
      if (all) ss.sort((a, b) => (a.s.from || '').localeCompare(b.s.from || '') || a.com.localeCompare(b.com, 'lt', { numeric: true }));
      nSess += ss.length;
      cells += `<div class="cal-day${d === t ? ' today' : ''}"><div class="cal-num"><span>${n}</span>${marked ? `<span class="cal-att" title="Dienos lankomume pažymėta: ${marked}">✓ ${marked}</span>` : ''}</div>` +
        ss.map(({ s, com }) => `<button class="cal-ev" data-act="sess-mark" data-ssid="${s.id}" title="${esc((all ? com + ' · ' : '') + s.act.name + (Acts.hhmm(s) ? ' · ' + Acts.hhmm(s) : '') + (s.note ? ' · ' + s.note : ''))}">${s.from ? `<b>${esc(s.from)}</b> ` : ''}${all ? `<small>${esc(com)}:</small> ` : ''}${esc(s.act.name)}</button>`).join('') + '</div>';
    }
    const modeSel = canAll ? `<select data-tool="C.mode" aria-label="Kalendoriaus apimtis"><option value="com" ${all ? '' : 'selected'}>${esc(comName(cid()))}</option><option value="all" ${all ? 'selected' : ''}>Visi komitetai</option></select>` : '';
    return `<div class="card no-print"><div class="tool-bar"><div><h2>Kalendorius · ${MONTHS[m - 1]} ${y}</h2><p class="sub" style="margin:0">${all ? 'Visi komitetai' : esc(comName(cid()))} · užsiėmimų: ${nSess}. Paspaudus užsiėmimą atidaromas jo žymėjimas.</p></div>
      <div class="actions">${modeSel}<button class="btn small" data-act="tool-cal" data-d="-1" aria-label="Ankstesnis mėnuo">&larr;</button><button class="btn small" data-act="tool-cal" data-d="0">Šiandien</button><button class="btn small" data-act="tool-cal" data-d="1" aria-label="Kitas mėnuo">&rarr;</button></div></div>
      <div class="cal-grid">${['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'].map((w) => `<div class="cal-wd">${w}</div>`).join('')}${cells}</div></div>`;
  }

  /* ---------- dublikatai ---------- */
  const keyOfName = (s) => [s.first, s.last].map((x) => UI.norm(x).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean).join(' ').split(' ').filter(Boolean).sort().join(' ');
  function lev1(a, b) { // ar skiriasi ne daugiau nei viena raidė
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
  }
  function findDupes() {
    const st = state.students, par = st.map((_, i) => i);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const byKey = new Map(), byMail = new Map(), keys = st.map(keyOfName);
    st.forEach((s, i) => {
      if (keys[i]) { if (byKey.has(keys[i])) uni(i, byKey.get(keys[i])); else byKey.set(keys[i], i); }
      const m = (s.email || '').trim().toLowerCase();
      if (m) { if (byMail.has(m)) uni(i, byMail.get(m)); else byMail.set(m, i); }
    });
    if (X.fuzzy) {
      const buckets = new Map();
      keys.forEach((k, i) => { if (k.length >= 6) { const b = k[0]; if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(i); } });
      buckets.forEach((idx) => { for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) if (lev1(keys[idx[a]], keys[idx[b]])) uni(idx[a], idx[b]); });
    }
    const groups = new Map();
    st.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
    return [...groups.values()].filter((g) => g.length > 1).map((g) => ({ list: g, ck: g.map((s) => s.id).sort().join('~') })).filter((c) => !X.ignore.has(c.ck)).sort((a, b) => b.list.length - a.list.length);
  }
  const markCount = (sid) => { let n = 0; for (const c in state.records) for (const d in state.records[c]) if (state.records[c][d][sid]) n++; return n; };
  function renderDupes() {
    const clusters = findDupes();
    const canMerge = Auth.can('students.edit') && Auth.can('students.delete') && Auth.user().classIds === null;
    const score = (s) => markCount(s.id) * 3 + (s.classIds || []).length * 2 + [s.email, s.parentEmail, s.notes, s.grade].filter(Boolean).length;
    const cards = clusters.map((c, ci) => {
      const best = c.list.slice().sort((a, b) => score(b) - score(a))[0].id;
      return `<div class="card dup" data-ck="${c.ck}"><div class="tool-bar"><div><h2>${esc(displayName(c.list[0]))} <small class="muted">· įrašų: ${c.list.length}</small></h2></div><div class="actions no-print">
        <button class="btn small" data-act="tool-ignore" data-ck="${c.ck}">Tai skirtingi mokiniai</button>${canMerge ? '<button class="btn small primary" data-act="tool-merge">Sujungti</button>' : ''}</div></div>
        <div class="table-wrap"><table><thead><tr><th>Palikti</th><th>Sujungti</th><th>Mokinys</th><th>Klasė</th><th class="hide-sm">Komitetai</th><th class="hide-sm">El. paštas</th><th class="num">Žymų</th></tr></thead><tbody>${c.list.map((s) => `<tr>
        <td><input type="radio" name="keep${ci}" value="${s.id}" ${s.id === best ? 'checked' : ''} ${canMerge ? '' : 'disabled'}></td><td><input type="checkbox" data-drop value="${s.id}" ${s.id === best ? '' : 'checked'} ${canMerge ? '' : 'disabled'}></td>
        <td><b class="name-link" data-act="student-card" data-sid="${s.id}" role="button" tabindex="0">${esc(displayName(s))}</b></td><td>${esc(s.grade || '')}</td><td class="hide-sm">${esc((s.classIds || []).map(comName).join(', '))}</td><td class="hide-sm">${esc(s.email || '')}</td><td class="num">${markCount(s.id)}</td></tr>`).join('')}</tbody></table></div></div>`;
    }).join('');
    return `<div class="card no-print"><div class="tool-opts"><label class="check"><input type="checkbox" data-tool="X.fuzzy" ${X.fuzzy ? 'checked' : ''}> Ieškoti ir panašių vardų (skiriasi viena raidė)</label>
      ${X.ignore.size ? `<button class="btn small" data-act="tool-unignore">Rodyti paslėptus (${X.ignore.size})</button>` : ''}</div>
      <p class="sub" style="margin:10px 0 0">Ieškoma visuose komitetuose: sutampa vardas ir pavardė (bet kokia tvarka, be lietuviškų raidžių skirtumų) arba el. paštas. Sujungiant komitetai, lankomumas ir veiklų žymos perkeliami į paliekamą įrašą.${canMerge ? '' : ' Sujungti gali tik naudotojas su leidimais „Redaguoti“ ir „Ištrinti mokinius“ bei prieiga prie visų komitetų.'}</p></div>
      ${cards || '<div class="card empty"><h2>Dublikatų nerasta</h2><p>Pasikartojančių mokinių nėra.</p></div>'}`;
  }
  async function merge(card) {
    const keep = (card.querySelector('input[type=radio]:checked') || {}).value;
    const drops = [...card.querySelectorAll('input[data-drop]:checked')].map((x) => x.value).filter((id) => id !== keep);
    if (!keep || !drops.length) { toast('Pažymėkite, ką sujungti'); return; }
    const nm = (id) => { const s = state.students.find((x) => x.id === id); return s ? displayName(s) : id; };
    const ok = await UI.confirm(`Sujungti ${drops.length} įrašą(-us) į „${nm(keep)}“?\n\nSujungiami: ${drops.map(nm).join(', ')}.\n\nKomitetai, lankomumas ir veiklų žymos bus perkelti, o likę įrašai pašalinti. Prieš tai automatiškai sukuriama atsarginė kopija. Šio veiksmo atšaukti skiltyje LOG negalima.`, { title: 'Sujungti dublikatus', okText: 'Sujungti', danger: true });
    if (!ok) return;
    try { await Sync.flush(); await api('/api/tools', { action: 'merge', keepId: keep, dropIds: drops }); await Sync.pull(); toast('Mokiniai sujungti'); } catch (e) { toast(e.message); }
    render();
  }

  /* ---------- CSV / spausdinimas ---------- */
  function csvFor(t) {
    if (t === 'groups' && G.res) {
      const r = G.res, lines = [['Grupė', 'Mokinys', 'Klasė'].map(csvCell).join(',')];
      r.groups.forEach((g, i) => g.forEach((id) => lines.push([i + 1, nameOf(id, r), gradeOf(id)].map(csvCell).join(','))));
      return [(r.title || 'grupes'), lines.join('\n')];
    }
    if (t === 'lists') {
      const l = pool();
      const hd = [...(L.num ? [L.hNr] : []), L.hName, ...(L.grade ? [L.hGrade] : []), ...L.cols.map((c) => c.n)];
      return ['sarasas', [hd.map(csvCell).join(','), ...l.map((s, i) => [...(L.num ? [i + 1] : []), displayName(s), ...(L.grade ? [s.grade || ''] : []), ...L.cols.map(() => '')].map(csvCell).join(','))].join('\n')];
    }
    if (t === 'risk') {
      const rows = riskRows();
      return ['rizikos-sarasas', [['Mokinys', 'Klasė', 'Komitetai', 'Nedalyvavo', 'Vėlavo', 'Iš eilės', 'Paskutinis praleidimas', 'Rodiklis %'].map(csvCell).join(','),
        ...rows.map((x) => [displayName(x.s), x.s.grade || '', x.coms, x.t.A, x.t.L, x.streak, x.lastAbs, x.rate == null ? '' : x.rate].map(csvCell).join(','))].join('\n')];
    }
    return null;
  }

  /* ---------- puslapis ---------- */
  function renderPage() {
    const tabs = TABS.filter(([k]) => k !== 'mail' || Auth.can('tools.save') || Auth.can('tools.view'));
    const body = { groups: renderGroups, draw: renderDraw, lists: renderLists, risk: renderRisk, mail: renderMail, dupes: renderDupes }[tab]();
    app.innerHTML = `<div class="no-print">${head('Įrankiai', esc(curClass().name))}</div>` +
      `<div class="tool-tabs no-print">${tabs.map(([k, l]) => `<button class="btn ${tab === k ? 'primary' : ''}" data-act="tool-tab" data-t="${k}">${l}</button>`).join('')}</div>` + body;
  }

  async function saveGroups() {
    const r = G.res;
    if (!r) return;
    const def = `Grupės ${comName(cid())} ${today()}`;
    const name = await UI.prompt('Išsaugoti sugrupavimą', def, { label: 'Pavadinimas (data pridedama automatiškai)', okText: 'Išsaugoti', max: 120 });
    if (!name) return;
    try {
      const x = await api('/api/tools', { action: 'group-save', classId: cid(), name, groups: r.groups, names: r.names, mode: r.mode, activityId: r.activityId });
      saved = x.groups; r.title = name; r.savedId = x.id; toast('Sugrupavimas išsaugotas');
    } catch (e) { toast(e.message); }
    render();
  }

  function act(a, el) {
    switch (a) {
      case 'tool-tab': tab = el.dataset.t; render(); window.scrollTo(0, 0); return true;
      case 'tool-groups': makeGroups(); render(); return true;
      case 'tool-gsave': saveGroups(); return true;
      case 'tool-gopen': {
        const g = (saved || []).find((x) => x.id === el.dataset.gid);
        if (g) { G.res = { groups: g.data.groups, names: g.data.names || {}, title: g.name, src: comName(g.classId), mode: g.data.mode, activityId: g.data.activityId || '', at: g.createdAt, savedId: g.id }; render(); window.scrollTo(0, 0); }
        return true;
      }
      case 'tool-gdel': {
        const g = (saved || []).find((x) => x.id === el.dataset.gid);
        if (!g) return true;
        UI.confirm(`Ištrinti išsaugotą sugrupavimą „${g.name}“?`, { title: 'Ištrinti sugrupavimą', okText: 'Ištrinti', danger: true }).then(async (ok) => {
          if (!ok) return;
          try { saved = (await api('/api/tools', { action: 'group-delete', id: g.id })).groups; if (G.res && G.res.savedId === g.id) G.res.savedId = ''; toast('Ištrinta'); } catch (e) { toast(e.message); }
          render();
        });
        return true;
      }
      case 'tool-tpl-new':
        UI.prompt('Naujas šablonas', L.title.trim(), { label: 'Šablono pavadinimas', okText: 'Išsaugoti', max: 120 }).then((name) => { if (name) tplSave('', name, tplData()); });
        return true;
      case 'tool-tpl-update': { const t = curTpl(); if (t) tplSave(t.id, t.name, tplData()); return true; }
      case 'tool-tpl-rename': {
        const t = curTpl();
        if (t) UI.prompt('Pervadinti šabloną', t.name, { label: 'Naujas pavadinimas', okText: 'Išsaugoti', max: 120 }).then((name) => { if (name) tplSave(t.id, name, normTpl(t.data)); });
        return true;
      }
      case 'tool-tpl-del': {
        const t = curTpl();
        if (t) UI.confirm(`Ištrinti šabloną „${t.name}“?`, { title: 'Ištrinti šabloną', okText: 'Ištrinti', danger: true }).then(async (ok) => {
          if (!ok) return;
          try { tpls = (await api('/api/tools', { action: 'tpl-delete', id: t.id })).templates; L.tpl = ''; toast('Šablonas ištrintas'); } catch (e) { toast(e.message); }
          render();
        });
        return true;
      }
      case 'tool-lcol': {
        const i = Number(el.dataset.i), op = el.dataset.op, c = L.cols;
        if (op === 'add') { if (c.length < 15) c.push({ n: '', w: 'auto' }); else toast('Daugiausia 15 stulpelių'); }
        else if (op === 'del') c.splice(i, 1);
        else if (op === 'up' && i > 0) [c[i - 1], c[i]] = [c[i], c[i - 1]];
        else if (op === 'down' && i < c.length - 1) [c[i + 1], c[i]] = [c[i], c[i + 1]];
        render(); return true;
      }
      case 'tool-lpreset':
        if (el.dataset.p === 'sign') { L.cols = [{ n: 'Parašas', w: 'xl' }]; L.rowh = 'tall'; }
        else { L.cols = Array.from({ length: 4 }, () => ({ n: '', w: 'auto' })); L.rowh = 'normal'; }
        render(); return true;
      case 'tool-cal': {
        const k = Number(el.dataset.d);
        if (!k) C.m = today().slice(0, 7);
        else { const [y, m] = (C.m || today().slice(0, 7)).split('-').map(Number); const dt = new Date(y, m - 1 + k, 1); C.m = dt.getFullYear() + '-' + pad2(dt.getMonth() + 1); }
        render(); return true;
      }
      case 'tool-draw': doDraw(); return true;
      case 'tool-draw-reset': D.drawn = []; D.hist = []; D.last = []; render(); return true;
      case 'tool-pick-all': S.excl.clear(); document.querySelectorAll('#tPick input[data-tx]').forEach((i) => { i.checked = true; }); pickCount(); return true;
      case 'tool-pick-none': document.querySelectorAll('#tPick input[data-tx]').forEach((i) => { i.checked = false; S.excl.add(i.dataset.tx); }); pickCount(); return true;
      case 'tool-print': printPage('print-tool', { groups: (G.res && G.res.title) || 'Grupės', lists: 'Sąrašas', risk: 'Rizikos sąrašas' }[el.dataset.t] + ' · ' + comName(cid())); return true;
      case 'tool-csv': { const c = csvFor(el.dataset.t); if (c) { logClient('export-tool', c[0]); download(`${c[0].replace(/[^\p{L}\p{N}]+/gu, '_')}-${today()}.csv`, c[1]); } return true; }
      case 'tool-merge': merge(el.closest('.dup')); return true;
      case 'tool-ignore': X.ignore.add(el.dataset.ck); try { localStorage.setItem(IGN_KEY, JSON.stringify([...X.ignore])); } catch (e) { /* ignore */ } render(); return true;
      case 'tool-unignore': X.ignore.clear(); try { localStorage.removeItem(IGN_KEY); } catch (e) { /* ignore */ } render(); return true;
      /* ----- laiškai ----- */
      case 'tool-mail-risk': tab = 'mail'; M.onlyRisk = true; render(); window.scrollTo(0, 0); return true;
      case 'tool-mail-ins': mailInsert(el.dataset.v); return true;
      case 'tool-mail-test': mailTest(); return true;
      case 'tool-mail-send': mailSend(); return true;
      case 'tool-mtpl-new':
        UI.prompt('Naujas laiško šablonas', (curPreset() && !isSavedPreset(curPreset()) ? curPreset().name : M.subject.trim()), { label: 'Šablono pavadinimas', okText: 'Išsaugoti', max: 120 }).then((name) => { if (name) mailSaveTpl('', name); });
        return true;
      case 'tool-mtpl-update': { const p = curPreset(); if (isSavedPreset(p)) mailSaveTpl(p.id, p.name); return true; }
      case 'tool-mtpl-rename': {
        const p = curPreset();
        if (isSavedPreset(p)) UI.prompt('Pervadinti šabloną', p.name, { label: 'Naujas pavadinimas', okText: 'Išsaugoti', max: 120 }).then((name) => { if (name) mailSaveTpl(p.id, name); });
        return true;
      }
      case 'tool-mtpl-del': {
        const p = curPreset();
        if (isSavedPreset(p)) UI.confirm(`Ištrinti laiško šabloną „${p.name}“?`, { title: 'Ištrinti šabloną', okText: 'Ištrinti', danger: true }).then(async (ok) => {
          if (!ok) return;
          try { mailTpls = (await api('/api/send-email', { action: 'tpl-delete', id: p.id })).templates; M.tplId = ''; toast('Šablonas ištrintas'); } catch (e) { toast(e.message); }
          render();
        });
        return true;
      }
    }
    return false;
  }
  function pickCount() { const c = document.getElementById('tPickCount'); if (c) c.textContent = pool().length; }

  /* Valdymo laukai: data-tool="Objektas.raktas" – reikšmė įrašoma ir puslapis perpiešiamas. */
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.tx !== undefined) { if (t.checked) S.excl.delete(t.dataset.tx); else S.excl.add(t.dataset.tx); pickCount(); return; }
    if (t.dataset && t.dataset.lcol !== undefined) {
      const c = L.cols[Number(t.dataset.lcol)];
      if (c && (t.dataset.lf === 'n' || t.dataset.lf === 'w')) c[t.dataset.lf] = t.value;
      render(); return;
    }
    if (t.dataset && ['hNr', 'hName', 'hGrade'].includes(t.dataset.lh)) { L[t.dataset.lh] = t.value; render(); return; }
    if (!t.dataset || !t.dataset.tool) return;
    const [o, k] = t.dataset.tool.split('.');
    if (!OBJ[o]) return;
    OBJ[o][k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    if (o === 'L' && k === 'tpl') applyTpl();
    if (o === 'M' && k === 'tplId') applyMailTpl();
    render();
  });
  /* Laiško tema, tekstas ir bandomasis adresas saugomi rašant, be perpiešimo (kad nešokinėtų žymeklis ir nepasimestų paspaudimas ant mygtuko). */
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t.dataset || !t.dataset.mail) return;
    M[t.dataset.mail] = t.value;
    if (t.dataset.mail === 'subject' || t.dataset.mail === 'body') mailPreview();
  });
  document.addEventListener('toggle', (ev) => { if (ev.target.classList && ev.target.classList.contains('tool-pick')) S.pickOpen = ev.target.open; }, true);

  function reset(hard) {
    saved = null; savedSt = 'idle'; savedErr = ''; tpls = []; mailTpls = null; mailTplSt = 'idle';
    if (hard) { G.res = null; D.drawn = []; D.hist = []; D.last = []; S.excl.clear(); S.src = 'all'; S.grade = ''; L.tpl = ''; M.tplId = ''; M.subject = ''; M.body = ''; M.status = ''; M.bad = false; M.onlyRisk = false; M.to = 'student'; }
  }

  return { render: renderPage, act, reset, calendar: calendarCard };
})();
