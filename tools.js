/* Įrankiai: grupių skirstymas (su išsaugojimu), atsitiktinis mokinio traukimas, sąrašai spausdinimui, rizikos sąrašas, dublikatų paieška ir sujungimas.
   Naudoja app.js / auth.js / activities.js funkcijas (state, classStudents, stats, Acts, api, head, esc, toast...). */
const Tools = (() => {
  const TABS = [['groups', 'Grupių skirstymas'], ['draw', 'Atsitiktinis mokinys'], ['lists', 'Sąrašai spausdinimui'], ['risk', 'Rizikos sąrašas'], ['dupes', 'Dublikatai']];
  const IGN_KEY = 'attendance-dupe-ignore';
  const loadIgn = () => { try { return new Set(JSON.parse(localStorage.getItem(IGN_KEY) || '[]')); } catch (e) { return new Set(); } };
  let tab = 'groups';
  const S = { src: 'all', grade: '', skip: false, excl: new Set(), pickOpen: false, key: '' };
  const G = { mode: 'n', n: 3, size: 4, mix: false, res: null };
  const D = { n: 1, norepeat: true, drawn: [], hist: [], last: [], busy: false };
  const L = { type: 'sign', title: '', date: '', cols: 4, heads: '', extra: 0, grade: true, rowh: 'normal' };
  const R = { scope: 'com', from: '', to: '', thr: 80, minDays: 3, streak: 3, acts: true };
  const X = { fuzzy: false, ignore: loadIgn() };
  const OBJ = { S, G, D, L, R, X };
  let saved = null, savedSt = 'idle', savedErr = '';

  const cid = () => state.currentClassId;
  const acts = () => (Acts.activitiesOf ? Acts.activitiesOf(cid()) : []);
  const rnd = (n) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const byName = (a, b) => fullName(a).localeCompare(fullName(b), 'lt');
  const dateLt = (d) => new Date(d).toLocaleString('lt-LT', { dateStyle: 'medium', timeStyle: 'short' });
  const comName = (id) => (state.classes.find((c) => c.id === id) || {}).name || '';

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
    api('/api/tools').then((r) => { saved = r.groups; savedErr = ''; }).catch((e) => { savedErr = e.message; saved = []; }).finally(() => { savedSt = 'ready'; if (view === 'tools') render(); });
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

  /* ---------- sąrašai spausdinimui ---------- */
  function renderLists() {
    const ppl = pool();
    const title = L.title.trim() || (L.type === 'sign' ? 'Pasirašymo lapas' : 'Sąrašas') + ' – ' + srcTitle();
    const n = Math.max(0, Math.min(10, Math.floor(L.cols) || 0));
    const heads = L.heads.split(',').map((x) => x.trim());
    const extra = Math.max(0, Math.min(40, Math.floor(L.extra) || 0));
    const rowCls = L.rowh === 'tall' ? 'tall' : '';
    const colHead = L.type === 'sign' ? '<th class="sigcol">Parašas</th>' : Array.from({ length: n }, (_, i) => `<th>${esc(heads[i] || '')}</th>`).join('');
    const blankCells = L.type === 'sign' ? '<td class="sigcol"></td>' : '<td></td>'.repeat(n);
    const rows = ppl.map((s, i) => `<tr class="${rowCls}"><td class="num">${i + 1}</td><td><b>${esc(displayName(s))}</b></td>${L.grade ? `<td>${esc(s.grade || '')}</td>` : ''}${blankCells}</tr>`).join('') +
      Array.from({ length: extra }, (_, i) => `<tr class="${rowCls}"><td class="num">${ppl.length + i + 1}</td><td></td>${L.grade ? '<td></td>' : ''}${blankCells}</tr>`).join('');
    return srcBox() + `<div class="card no-print"><div class="tool-opts">
      <label>Sąrašo tipas<select data-tool="L.type"><option value="sign" ${L.type === 'sign' ? 'selected' : ''}>Pasirašymo sąrašas</option><option value="blank" ${L.type === 'blank' ? 'selected' : ''}>Tuščias lapas (lentelė)</option></select></label>
      <label>Pavadinimas<input data-tool="L.title" value="${esc(L.title)}" placeholder="${esc(title)}" maxlength="150"></label>
      <label>Data (neprivaloma)<input type="date" data-tool="L.date" value="${esc(L.date)}"></label>
      ${L.type === 'blank' ? `<label>Tuščių stulpelių<input type="number" min="0" max="10" data-tool="L.cols" value="${n}"></label><label>Stulpelių pavadinimai (per kablelį)<input data-tool="L.heads" value="${esc(L.heads)}" placeholder="pvz. Pastabos, Balas"></label>` : ''}
      <label>Papildomų tuščių eilučių<input type="number" min="0" max="40" data-tool="L.extra" value="${extra}"></label>
      <label>Eilučių aukštis<select data-tool="L.rowh"><option value="normal" ${L.rowh === 'normal' ? 'selected' : ''}>Įprastas</option><option value="tall" ${L.rowh === 'tall' ? 'selected' : ''}>Didesnis (parašams)</option></select></label>
      <label class="check"><input type="checkbox" data-tool="L.grade" ${L.grade ? 'checked' : ''}> Rodyti klasę</label>
      <button class="btn small" data-act="tool-print" data-t="lists">${ICON.print} Spausdinti</button><button class="btn small" data-act="tool-csv" data-t="lists">CSV</button></div></div>
      <div class="print-only print-title"><h2>${esc(title)}</h2><p>${L.date ? prettyDate(L.date) : 'Data: ____________________'}</p></div>
      <div class="card"><div class="table-wrap"><table class="sheet"><thead><tr><th class="num">Nr.</th><th>Vardas, pavardė</th>${L.grade ? '<th>Klasė</th>' : ''}${colHead}</tr></thead><tbody>${rows || '<tr><td colspan="9" class="muted">Mokinių nėra.</td></tr>'}</tbody></table></div></div>`;
  }

  /* ---------- rizikos sąrašas ---------- */
  function riskRows() {
    const ids = R.scope === 'all' ? state.classes.map((c) => c.id) : [cid()];
    const from = R.from || undefined, to = R.to || undefined;
    const useActs = R.acts && Auth.can('activities.view');
    const out = [];
    state.students.forEach((s) => {
      const mine = (s.classIds || []).filter((c) => ids.includes(c));
      if (!mine.length) return;
      const t = { P: 0, A: 0, L: 0, E: 0 }, seq = [];
      mine.forEach((c) => {
        const x = stats(c, s.id, from, to);
        t.P += x.P; t.A += x.A; t.L += x.L; t.E += x.E;
        const recs = state.records[c] || {};
        for (const d in recs) { if ((from && d < from) || (to && d > to)) continue; const r = recs[d][s.id]; if (r && r.s) seq.push([d, r.s]); }
      });
      if (useActs) { const x = Acts.totals(s.id, R.scope === 'all' ? { from, to } : { cid: cid(), from, to }); t.P += x.P; t.A += x.A; t.L += x.L; t.E += x.E; }
      seq.sort((a, b) => a[0].localeCompare(b[0]));
      let streak = 0, lastAbs = '';
      for (let i = seq.length - 1; i >= 0; i--) { if (seq[i][1] === 'A') streak++; else if (seq[i][1] === 'E') continue; else break; }
      seq.forEach(([d, st]) => { if (st === 'A') lastAbs = d; });
      const den = t.P + t.L + t.A, rate = den ? Math.round(((t.P + t.L) / den) * 100) : null;
      const low = rate != null && rate < R.thr && den >= R.minDays, run = R.streak > 0 && streak >= R.streak;
      if (low || run) out.push({ s, t, rate, den, streak, lastAbs, coms: mine.map(comName).sort((a, b) => a.localeCompare(b, 'lt', { numeric: true })).join(', ') });
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
      <button class="btn small" data-act="tool-print" data-t="risk">${ICON.print} Spausdinti</button><button class="btn small" data-act="tool-csv" data-t="risk">CSV</button></div></div>
      <div class="print-only print-title"><h2>Rizikos sąrašas – ${R.scope === 'all' ? 'visi komitetai' : esc(comName(cid()))}</h2><p>${esc(per)} · lankomumas žemiau ${R.thr}%${R.streak ? ` arba ${R.streak}+ praleidimai iš eilės` : ''}</p></div>
      <div class="card"><h2>Reikia dėmesio: ${rows.length}</h2><p class="sub no-print">Rodiklis = (dalyvavo + vėlavo) ÷ (dalyvavo + vėlavo + nedalyvavo). „Iš eilės“ skaičiuojama pagal komiteto dienų žymas; pateisintos dienos serijos nenutraukia.</p>
        ${rows.length ? `${UI.filterBox({ fk: 'risk', scope: '#riskTbl', placeholder: 'Ieškoti mokinio sąraše…' })}<div class="table-wrap"><table id="riskTbl"><thead><tr><th>Mokinys</th><th class="hide-sm">Komitetai</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Iš eilės</th><th class="hide-sm">Paskutinis praleidimas</th><th class="num">Rodiklis</th></tr></thead><tbody>${rows.map((x) =>
          `<tr><td><div class="who">${avatar(x.s)}<div><b class="name-link" data-act="student-card" data-sid="${x.s.id}" role="button" tabindex="0">${esc(displayName(x.s))}</b>${x.s.grade ? `<small>${esc(x.s.grade)} kl.</small>` : ''}</div></div></td><td class="hide-sm">${esc(x.coms)}</td><td class="num">${x.t.A}</td><td class="num">${x.t.L}</td><td class="num">${x.streak}</td><td class="hide-sm">${esc(x.lastAbs || '–')}</td><td class="num">${rateBadge(x.rate)}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">Pagal šiuos kriterijus nieko nerasta. Puiku!</p>'}</div>`;
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
    if (t === 'lists') { const l = pool(); return ['sarasas', [['Nr.', 'Mokinys', 'Klasė'].map(csvCell).join(','), ...l.map((s, i) => [i + 1, displayName(s), s.grade || ''].map(csvCell).join(','))].join('\n')]; }
    if (t === 'risk') {
      const rows = riskRows();
      return ['rizikos-sarasas', [['Mokinys', 'Klasė', 'Komitetai', 'Nedalyvavo', 'Vėlavo', 'Iš eilės', 'Paskutinis praleidimas', 'Rodiklis %'].map(csvCell).join(','),
        ...rows.map((x) => [displayName(x.s), x.s.grade || '', x.coms, x.t.A, x.t.L, x.streak, x.lastAbs, x.rate == null ? '' : x.rate].map(csvCell).join(','))].join('\n')];
    }
    return null;
  }

  /* ---------- puslapis ---------- */
  function renderPage() {
    const body = { groups: renderGroups, draw: renderDraw, lists: renderLists, risk: renderRisk, dupes: renderDupes }[tab]();
    app.innerHTML = head('Įrankiai', esc(curClass().name)) +
      `<div class="tool-tabs no-print">${TABS.map(([k, l]) => `<button class="btn ${tab === k ? 'primary' : ''}" data-act="tool-tab" data-t="${k}">${l}</button>`).join('')}</div>` + body;
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
      case 'tool-draw': doDraw(); return true;
      case 'tool-draw-reset': D.drawn = []; D.hist = []; D.last = []; render(); return true;
      case 'tool-pick-all': S.excl.clear(); document.querySelectorAll('#tPick input[data-tx]').forEach((i) => { i.checked = true; }); pickCount(); return true;
      case 'tool-pick-none': document.querySelectorAll('#tPick input[data-tx]').forEach((i) => { i.checked = false; S.excl.add(i.dataset.tx); }); pickCount(); return true;
      case 'tool-print': printPage('print-tool', { groups: (G.res && G.res.title) || 'Grupės', lists: 'Sąrašas', risk: 'Rizikos sąrašas' }[el.dataset.t] + ' · ' + comName(cid())); return true;
      case 'tool-csv': { const c = csvFor(el.dataset.t); if (c) { logClient('export-tool', c[0]); download(`${c[0].replace(/[^\p{L}\p{N}]+/gu, '_')}-${today()}.csv`, c[1]); } return true; }
      case 'tool-merge': merge(el.closest('.dup')); return true;
      case 'tool-ignore': X.ignore.add(el.dataset.ck); try { localStorage.setItem(IGN_KEY, JSON.stringify([...X.ignore])); } catch (e) { /* ignore */ } render(); return true;
      case 'tool-unignore': X.ignore.clear(); try { localStorage.removeItem(IGN_KEY); } catch (e) { /* ignore */ } render(); return true;
    }
    return false;
  }
  function pickCount() { const c = document.getElementById('tPickCount'); if (c) c.textContent = pool().length; }

  /* Valdymo laukai: data-tool="Objektas.raktas" – reikšmė įrašoma ir puslapis perpiešiamas. */
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.tx !== undefined) { if (t.checked) S.excl.delete(t.dataset.tx); else S.excl.add(t.dataset.tx); pickCount(); return; }
    if (!t.dataset || !t.dataset.tool) return;
    const [o, k] = t.dataset.tool.split('.');
    if (!OBJ[o]) return;
    OBJ[o][k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    if (o === 'X') { /* ignoruojamų sąrašas nesikeičia */ }
    render();
  });
  document.addEventListener('toggle', (ev) => { if (ev.target.classList && ev.target.classList.contains('tool-pick')) S.pickOpen = ev.target.open; }, true);

  function reset(hard) { saved = null; savedSt = 'idle'; savedErr = ''; if (hard) { G.res = null; D.drawn = []; D.hist = []; D.last = []; S.excl.clear(); S.src = 'all'; S.grade = ''; } }
  return { render: renderPage, act, reset };
})();
