/* Veiklos: veikla priklauso komitetui, turi užsiėmimus (datas, laiką, aprašymą), dalyvius ir savo lankomumo žymas.
   Duomenys keliauja per /api/activities (ne per Sync skirtumus). Naudoja app.js / auth.js funkcijas (api, esc, head, ICON, render, state...). */
const Acts = (() => {
  const empty = () => ({ activities: [], sessions: [], records: [], people: [] });
  let D = empty(), rec = new Map(), actById = new Map(), sessByAct = new Map(), sig = '';
  let pending = 0, chain = Promise.resolve();
  let repId = null, rFrom = '', rTo = '';
  const more = new Set();
  const dlg = document.createElement('dialog');
  dlg.id = 'actDialog';
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  /* ---------- duomenys ---------- */
  function index() {
    actById = new Map(D.activities.map((a) => [a.id, a]));
    sessByAct = new Map();
    D.sessions.forEach((s) => { if (!sessByAct.has(s.aid)) sessByAct.set(s.aid, []); sessByAct.get(s.aid).push(s); });
    rec = new Map();
    D.records.forEach((r) => { if (!rec.has(r.ssid)) rec.set(r.ssid, new Map()); rec.get(r.ssid).set(r.sid, { s: r.s, n: r.n }); });
  }
  function apply(r) { D = r; sig = JSON.stringify(r); index(); }
  async function refresh() {
    if (!Auth.user() || pending) return false;
    let r;
    try { r = await api('/api/activities'); } catch (e) { return false; }
    if (pending) return false;
    if (JSON.stringify(r) === sig) return false;
    apply(r);
    return true;
  }
  function reset() { D = empty(); sig = ''; index(); repId = null; rFrom = ''; rTo = ''; more.clear(); }
  const dump = () => ({ activities: D.activities, sessions: D.sessions, records: D.records });

  const sessionsOf = (aid) => sessByAct.get(aid) || [];
  const hhmm = (s) => (s && s.from ? s.from + (s.to ? '–' + s.to : '') : '');
  const get = (ssid, sid) => (rec.get(ssid) && rec.get(ssid).get(sid)) || { s: '', n: '' };
  const studentsOf = (cid) => state.students.filter((s) => (s.classIds || []).includes(cid)).sort((x, y) => fullName(x).localeCompare(fullName(y), 'lt'));
  function participants(a) {
    const all = studentsOf(a.classId);
    return a.studentIds && a.studentIds.length ? all.filter((s) => a.studentIds.includes(s.id)) : all;
  }
  function sessionsOn(cid, d) {
    return D.sessions.filter((s) => s.d === d).map((s) => ({ ...s, act: actById.get(s.aid) })).filter((s) => s.act && s.act.classId === cid)
      .sort((a, b) => (a.from || '').localeCompare(b.from || '') || a.act.name.localeCompare(b.act.name, 'lt'));
  }
  const blank = () => ({ P: 0, A: 0, L: 0, E: 0 });
  function fin(t) { const den = t.P + t.L + t.A; t.rate = den ? Math.round(((t.P + t.L) / den) * 100) : null; t.total = den + t.E; return t; }
  /* Mokinio suvestinė pagal veiklų žymas (o: cid, aid, from, to). */
  function totals(sid, o) {
    o = o || {};
    const t = blank();
    D.sessions.forEach((s) => {
      if ((o.from && s.d < o.from) || (o.to && s.d > o.to) || (o.aid && s.aid !== o.aid)) return;
      if (o.cid) { const a = actById.get(s.aid); if (!a || a.classId !== o.cid) return; }
      const m = rec.get(s.id), r = m && m.get(sid);
      if (r && r.s) t[r.s]++;
    });
    return fin(t);
  }
  /* Mokinio atskiri veiklų įrašai (data, būsena, pastaba) – kortelei ir „iš eilės“ skaičiavimui (o: cid, from, to). */
  function marks(sid, o) {
    o = o || {};
    const out = [];
    D.sessions.forEach((s) => {
      if ((o.from && s.d < o.from) || (o.to && s.d > o.to)) return;
      const a = actById.get(s.aid);
      if (!a || (o.cid && a.classId !== o.cid)) return;
      const m = rec.get(s.id), r = m && m.get(sid);
      if (r && (r.s || r.n)) out.push({ d: s.d, s: r.s, n: r.n, act: a.name, classId: a.classId });
    });
    return out;
  }
  /* Veiklos suvestinė visiems dalyviams. */
  function actTotals(a, from, to) {
    const t = blank(); let n = 0;
    const ppl = participants(a);
    sessionsOf(a.id).forEach((s) => {
      if ((from && s.d < from) || (to && s.d > to)) return;
      n++;
      const m = rec.get(s.id);
      if (m) ppl.forEach((p) => { const r = m.get(p.id); if (r && r.s) t[r.s]++; });
    });
    fin(t); t.sessions = n;
    return t;
  }

  /* ---------- žymėjimas ---------- */
  function send(body) {
    pending++;
    Sync.setStatus('saving', 'Saugoma…');
    chain = chain.then(() => api('/api/activities', body)).then(() => {
      pending--;
      if (!pending) Sync.setStatus('saved', 'Išsaugota ✓');
    }, (e) => {
      pending--;
      toast(e.message); Sync.setStatus('error', 'Pakeitimas atmestas');
      sig = '';
      if (!pending) return refresh().then(() => render());
    });
  }
  function setMarks(ssid, items) {
    let m = rec.get(ssid);
    if (!m) { m = new Map(); rec.set(ssid, m); }
    items.forEach((it) => { if (!it.s && !it.n) m.delete(it.sid); else m.set(it.sid, { s: it.s, n: it.n }); });
    send({ action: 'mark', sessionId: ssid, marks: items });
  }
  function mark(ssid, sid, s) { const cur = get(ssid, sid); setMarks(ssid, [{ sid, s: cur.s === s ? '' : s, n: cur.n }]); }
  function note(ssid, sid, n) { const cur = get(ssid, sid); if (cur.n !== n) setMarks(ssid, [{ sid, s: cur.s, n }]); }
  function allPresent(ssid) {
    const s = D.sessions.find((x) => x.id === ssid), a = s && actById.get(s.aid);
    if (!a) return;
    const items = participants(a).filter((p) => !get(ssid, p.id).s).map((p) => ({ sid: p.id, s: 'P', n: get(ssid, p.id).n }));
    if (items.length) setMarks(ssid, items);
  }
  function clearSession(ssid) {
    const m = rec.get(ssid);
    if (!m || !m.size) return;
    setMarks(ssid, [...m.keys()].map((sid) => ({ sid, s: '', n: '' })));
  }

  /* ---------- tekstai ---------- */
  function sessionLabel(ssid) {
    const s = D.sessions.find((x) => x.id === ssid), a = s && actById.get(s.aid);
    return a ? a.name + (s.from ? ' ' + hhmm(s) : '') : '';
  }
  function infoHtml(s) {
    const a = s.act, bits = [];
    if (a.teacherName) bits.push('Atsakingas: <b>' + esc(a.teacherName) + '</b>');
    if (a.place) bits.push('Vieta: <b>' + esc(a.place) + '</b>');
    if (hhmm(s)) bits.push('Laikas: <b>' + esc(hhmm(s)) + '</b>');
    return (bits.length ? `<p class="act-info">${bits.join(' · ')}</p>` : '') + (s.note ? `<p class="act-info">${esc(s.note)}</p>` : '') + (a.description ? `<p class="act-info">${esc(a.description)}</p>` : '');
  }
  const title = () => { const a = actById.get(repId); return a ? 'Veikla ' + a.name + (rFrom || rTo ? ` ${rFrom || '…'}–${rTo || '…'}` : '') : ''; };

  /* ---------- veiklų puslapis ---------- */
  function card(a) {
    const t = today();
    const sess = sessionsOf(a.id).slice().sort((x, y) => y.d.localeCompare(x.d) || (y.from || '').localeCompare(x.from || ''));
    const ppl = participants(a);
    const shown = more.has(a.id) ? sess : sess.slice(0, 8);
    const rows = shown.map((s) => {
      const m = rec.get(s.id);
      let marked = 0;
      if (m) ppl.forEach((p) => { const r = m.get(p.id); if (r && r.s) marked++; });
      const tag = s.d === t ? ' <span class="rate good">šiandien</span>' : s.d > t ? ' <span class="rate na">būsimas</span>' : '';
      return `<tr><td class="nowrap"><b>${esc(s.d)}</b>${tag}</td><td class="nowrap">${esc(hhmm(s) || '–')}</td><td>${esc(s.note || '')}</td><td class="num">${marked}/${ppl.length}</td>
        <td class="row-actions"><button class="btn small primary" data-act="sess-mark" data-ssid="${s.id}">Žymėti</button> <button class="btn small" data-act="sess-edit" data-aid="${a.id}" data-ssid="${s.id}">Redaguoti</button> <button class="btn small danger" data-act="sess-del" data-ssid="${s.id}">Ištrinti</button></td></tr>`;
    }).join('');
    return `<div class="card act-card">
      <div class="act-head"><div><h2>${esc(a.name)}</h2><p class="sub" style="margin:0">${[a.teacherName ? 'Atsakingas: ' + esc(a.teacherName) : '', a.place ? 'Vieta: ' + esc(a.place) : ''].filter(Boolean).join(' · ') || '&nbsp;'}</p></div>
        <div class="actions"><button class="btn small" data-act="act-report" data-aid="${a.id}">${ICON.chart} Ataskaita</button><button class="btn small" data-act="act-edit" data-aid="${a.id}">Redaguoti</button><button class="btn small" data-act="sess-new" data-aid="${a.id}">${ICON.plus} Užsiėmimas</button><button class="btn small danger" data-act="act-del" data-aid="${a.id}">Ištrinti</button></div></div>
      ${a.description ? `<p class="act-desc">${esc(a.description)}</p>` : ''}
      <div class="act-meta"><span class="chip">${a.studentIds.length ? 'Dalyviai: ' + ppl.length : 'Visi komiteto mokiniai: ' + ppl.length}</span><span class="chip">Užsiėmimų: ${sess.length}</span></div>
      ${sess.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Laikas</th><th>Aprašymas</th><th class="num">Pažymėta</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        ${sess.length > 8 ? `<div style="text-align:center;margin-top:10px"><button class="btn small" data-act="act-more" data-aid="${a.id}">${more.has(a.id) ? 'Rodyti mažiau' : 'Rodyti visus (' + sess.length + ')'}</button></div>` : ''}`
        : '<p class="muted">Užsiėmimų dar nėra. Pridėkite pirmą datą.</p>'}
    </div>`;
  }
  function renderPage() {
    if (repId) { renderReport(); return; }
    const cid = state.currentClassId, com = curClass();
    const list = D.activities.filter((a) => a.classId === cid);
    const canNew = Auth.can('activities.create');
    app.innerHTML = head('Veiklos', `${esc(com.name)} · veiklų: ${list.length}`, canNew ? `<button class="btn primary" data-act="act-new">${ICON.plus} Nauja veikla</button>` : '') +
      (list.length ? UI.filterBox({ fk: 'acts', scope: '#actList', rows: '.act-card', placeholder: 'Ieškoti veiklos (pavadinimas, mokytojas, vieta)…' }) + '<div id="actList">' + list.map(card).join('') + '</div>' : `<div class="card empty"><div class="big">${ICON.cal}</div><h2>Veiklų dar nėra</h2>
        <p>Veikla – tai komiteto renginys ar pasikartojantys užsiėmimai (su datomis, laiku ir aprašymu), kuriuose žymimas lankomumas.</p>
        ${canNew ? `<button class="btn primary" data-act="act-new">${ICON.plus} Sukurti veiklą</button>` : ''}</div>`);
  }

  /* ---------- veiklos ataskaita ---------- */
  function reportRows(a) {
    const inR = (d) => (!rFrom || d >= rFrom) && (!rTo || d <= rTo);
    const sess = sessionsOf(a.id).filter((s) => inR(s.d)).sort((x, y) => x.d.localeCompare(y.d) || (x.from || '').localeCompare(y.from || ''));
    const ppl = participants(a);
    return { sess, ppl };
  }
  function renderReport() {
    const a = actById.get(repId);
    if (!a) { repId = null; renderPage(); return; }
    const { sess, ppl } = reportRows(a);
    const stRows = ppl.map((p) => {
      const t = totals(p.id, { aid: a.id, from: rFrom, to: rTo });
      return `<tr><td><div class="who">${avatar(p)}<div><b>${esc(displayName(p))}</b>${p.grade ? `<small>${esc(p.grade)} kl.</small>` : ''}</div></div></td><td class="num">${t.P}</td><td class="num">${t.A}</td><td class="num">${t.L}</td><td class="num">${t.E}</td><td class="num">${rateBadge(t.rate)}</td></tr>`;
    }).join('');
    const seRows = sess.slice().reverse().map((s) => {
      const c = { P: 0, A: 0, L: 0, E: 0, none: 0 };
      ppl.forEach((p) => { const r = get(s.id, p.id); if (r.s) c[r.s]++; else c.none++; });
      return `<tr><td class="nowrap">${esc(s.d)}</td><td class="nowrap">${esc(hhmm(s) || '–')}</td><td>${esc(s.note || '')}</td><td class="num">${c.P}</td><td class="num">${c.A}</td><td class="num">${c.L}</td><td class="num">${c.E}</td><td class="num">${c.none}</td></tr>`;
    }).join('');
    const per = rFrom || rTo ? `${rFrom || '…'} – ${rTo || '…'}` : 'visas laikotarpis';
    const com = (state.classes.find((c) => c.id === a.classId) || {}).name || '';
    app.innerHTML = head('Veiklos ataskaita', esc(a.name),
      `<button class="btn" data-act="act-back">&larr; Atgal</button><button class="btn" data-act="act-print">${ICON.print} Spausdinti</button><button class="btn primary" data-act="act-export">Eksportuoti CSV</button>`) +
      `<div class="print-only print-title"><h2>Veiklos ataskaita – ${esc(a.name)}</h2><p>Komitetas: ${esc(com)}${a.teacherName ? ' · Atsakingas: ' + esc(a.teacherName) : ''}${a.place ? ' · Vieta: ' + esc(a.place) : ''} · ${esc(per)}</p></div>
      <div class="card"><div class="actions"><label class="muted">Nuo <input type="date" id="actRepFrom" value="${esc(rFrom)}"></label><label class="muted">Iki <input type="date" id="actRepTo" value="${esc(rTo)}"></label>
        <button class="btn small" data-act="act-range-clear">Visas laikotarpis</button></div>
        ${a.description ? `<p class="act-desc" style="margin-bottom:0">${esc(a.description)}</p>` : ''}</div>
      <div class="card"><h2>Pagal dalyvį</h2><p class="sub">Užsiėmimų pasirinktame laikotarpyje: ${sess.length}. Rodiklis = (dalyvavo + vėlavo) ÷ (dalyvavo + vėlavo + nedalyvavo).</p>
        ${ppl.length ? `${UI.filterBox({ fk: 'actrep', scope: '#actRepTbl', placeholder: 'Ieškoti dalyvio…' })}<div class="table-wrap"><table id="actRepTbl"><thead><tr><th>Mokinys</th><th class="num">Dalyvavo</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Pateisinta</th><th class="num">Rodiklis</th></tr></thead><tbody>${stRows}</tbody></table></div>` : '<p class="muted">Dalyvių nėra.</p>'}</div>
      <div class="card"><h2>Pagal užsiėmimą</h2><p class="sub">&nbsp;</p>
        ${sess.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Laikas</th><th>Aprašymas</th><th class="num">Dalyvavo</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Pateisinta</th><th class="num">Nepažymėta</th></tr></thead><tbody>${seRows}</tbody></table></div>` : '<p class="muted">Šiuo laikotarpiu užsiėmimų nėra.</p>'}</div>`;
  }
  function exportCsv() {
    const a = actById.get(repId);
    if (!a) return;
    const { sess, ppl } = reportRows(a);
    const lines = [['Mokinys', 'Klasė', ...sess.map((s) => s.d + (s.from ? ' ' + s.from : '')), 'Dalyvavo', 'Nedalyvavo', 'Vėlavo', 'Pateisinta', 'Rodiklis %'].map(csvCell).join(',')];
    ppl.forEach((p) => {
      const t = totals(p.id, { aid: a.id, from: rFrom, to: rTo });
      lines.push([displayName(p), p.grade || '', ...sess.map((s) => get(s.id, p.id).s), t.P, t.A, t.L, t.E, t.rate == null ? '' : t.rate].map(csvCell).join(','));
    });
    logClient('export-activity', a.name);
    download(`veikla-${a.name.replace(/[^\p{L}\p{N}]+/gu, '_')}-${today()}.csv`, lines.join('\n'));
  }

  /* Kortelė skiltyje „Ataskaitos“ (pagal komitetą). */
  function reportCard(cid, from, to) {
    const list = D.activities.filter((a) => a.classId === cid);
    const rows = list.map((a) => { const t = actTotals(a, from, to); return `<tr><td><b>${esc(a.name)}</b></td><td class="num">${t.sessions}</td><td class="num">${t.P}</td><td class="num">${t.A}</td><td class="num">${t.L}</td><td class="num">${t.E}</td><td class="num">${rateBadge(t.rate)}</td></tr>`; }).join('');
    return `<div class="card"><h2>Veiklos · ${esc((state.classes.find((c) => c.id === cid) || {}).name || '')}</h2><p class="sub">Atskira suvestinė pagal veiklas pasirinktu laikotarpiu (sumuojamos visų dalyvių žymos). Detali ataskaita – skiltyje „Veiklos“.</p>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Veikla</th><th class="num">Užsiėmimų</th><th class="num">Dalyvavo</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Pateisinta</th><th class="num">Rodiklis</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Šiame komitete veiklų nėra.</p>'}</div>`;
  }
  /* Skyrius mokinio kortelėje. */
  function cardSection(s) {
    const rows = D.activities.filter((a) => participants(a).some((p) => p.id === s.id) && sessionsOf(a.id).length).map((a) => {
      const t = totals(s.id, { aid: a.id }), com = (state.classes.find((c) => c.id === a.classId) || {}).name || '';
      return `<tr><td>${esc(a.name)} <small class="muted">${esc(com)}</small></td><td class="num">${sessionsOf(a.id).length}</td><td class="num">${t.P}</td><td class="num">${t.A}</td><td class="num">${t.L}</td><td class="num">${t.E}</td><td class="num">${rateBadge(t.rate)}</td></tr>`;
    }).join('');
    return rows ? `<h4 class="card-sec">Veiklos</h4><div class="table-wrap"><table><thead><tr><th>Veikla</th><th class="num">Užsiėmimų</th><th class="num">Dalyvavo</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Pateisinta</th><th class="num">Rodiklis</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  }

  /* ---------- formos ---------- */
  function partList(cid, sel) {
    const l = studentsOf(cid);
    return l.length ? l.map((s) => `<label class="check"><input type="checkbox" name="stu" value="${s.id}" ${sel.includes(s.id) ? 'checked' : ''}> ${esc(displayName(s))}${s.grade ? ' <small class="muted">' + esc(s.grade) + '</small>' : ''}</label>`).join('') : '<small class="muted">Komitete mokinių nėra.</small>';
  }
  function openActForm(a, dateHint) {
    const edit = !!a;
    const coms = state.classes.slice().sort(byClassName);
    const cid = edit ? a.classId : state.currentClassId;
    const sel = a && a.teacherId ? 'u:' + a.teacherId : a && a.teacherName ? 'manual' : '';
    const ppl = D.people.slice();
    if (a && a.teacherId && !ppl.some((p) => p.id === a.teacherId)) ppl.push({ id: a.teacherId, name: a.teacherName });
    const some = edit && a.studentIds.length > 0;
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>${edit ? 'Redaguoti veiklą' : 'Nauja veikla'}</h3><button type="button" class="icon-btn" data-act="act-close" aria-label="Uždaryti">&times;</button></div>
      <form data-aform="activity"><input type="hidden" name="id" value="${edit ? a.id : ''}">
        <label>Pavadinimas<input name="name" required maxlength="150" value="${esc(edit ? a.name : '')}" placeholder="pvz. Choro repeticija, Išvyka į muziejų"></label>
        <label>Komitetas<select name="classId" ${edit ? 'disabled' : ''}>${coms.map((c) => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Aprašymas (neprivaloma)<textarea name="description" rows="3" maxlength="2000">${esc(edit ? a.description : '')}</textarea></label>
        <label>Vieta (neprivaloma)<input name="place" maxlength="150" value="${esc(edit ? a.place : '')}"></label>
        <label>Atsakingas mokytojas<select name="teacher"><option value="">– nenurodytas –</option>${ppl.map((p) => `<option value="u:${p.id}" ${sel === 'u:' + p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="manual" ${sel === 'manual' ? 'selected' : ''}>Kitas (įrašyti ranka)…</option></select></label>
        <label id="actTeacherManual" style="${sel === 'manual' ? '' : 'display:none'}">Mokytojo vardas ir pavardė<input name="teacherName" maxlength="100" value="${esc(sel === 'manual' ? a.teacherName : '')}"></label>
        <label class="check"><input type="radio" name="pm" value="all" ${some ? '' : 'checked'}> Visi komiteto mokiniai</label>
        <label class="check"><input type="radio" name="pm" value="some" ${some ? 'checked' : ''}> Tik pasirinkti dalyviai</label>
        <fieldset class="classpick" id="actPartPick" style="${some ? '' : 'display:none'}"><legend>Dalyviai</legend>${UI.filterBox({ scope: '#actPartPick', rows: 'label.check', placeholder: 'Ieškoti mokinio…' })}${partList(cid, edit ? a.studentIds : [])}</fieldset>
        ${edit ? '' : `<fieldset class="classpick" style="max-height:none"><legend>Pirmas užsiėmimas (neprivaloma)</legend>
          <div class="grid2"><label>Data<input type="date" name="d" value="${esc(dateHint || attDate)}"></label><label>Kartoti kas savaitę iki<input type="date" name="repeatUntil"></label></div>
          <div class="grid2"><label>Nuo<input type="time" name="from"></label><label>Iki<input type="time" name="to"></label></div>
          <label>Užsiėmimo aprašymas<input name="note" maxlength="500" placeholder="pvz. Repetuojame koncertui"></label>
        </fieldset>`}
        <div class="form-err" role="alert"></div>
        <div class="dlg-actions"><button type="button" class="btn" data-act="act-close">Atšaukti</button><button type="submit" class="btn primary">Išsaugoti</button></div>
      </form></div>`;
    dlg.showModal();
  }
  function openSessForm(aid, s) {
    const a = actById.get(aid);
    if (!a) return;
    const edit = !!s;
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>${edit ? 'Redaguoti užsiėmimą' : 'Naujas užsiėmimas'}</h3><button type="button" class="icon-btn" data-act="act-close" aria-label="Uždaryti">&times;</button></div>
      <p class="muted" style="margin-top:0">${esc(a.name)}</p>
      <form data-aform="session"><input type="hidden" name="activityId" value="${a.id}"><input type="hidden" name="id" value="${edit ? s.id : ''}">
        <label>Data<input type="date" name="d" required value="${esc(edit ? s.d : today())}"></label>
        <div class="grid2"><label>Nuo<input type="time" name="from" value="${esc(edit ? s.from : '')}"></label><label>Iki<input type="time" name="to" value="${esc(edit ? s.to : '')}"></label></div>
        <label>Aprašymas (neprivaloma)<textarea name="note" rows="3" maxlength="500">${esc(edit ? s.note : '')}</textarea></label>
        ${edit ? '' : '<label>Kartoti kas savaitę iki (neprivaloma)<input type="date" name="repeatUntil"></label>'}
        <div class="form-err" role="alert"></div>
        <div class="dlg-actions"><button type="button" class="btn" data-act="act-close">Atšaukti</button><button type="submit" class="btn primary">Išsaugoti</button></div>
      </form></div>`;
    dlg.showModal();
  }

  document.addEventListener('submit', async (e) => {
    const f = e.target, kind = f.dataset && f.dataset.aform;
    if (!kind) return;
    e.preventDefault();
    const v = (n) => (f.elements[n] ? f.elements[n].value : '');
    const err = (m) => { const b = f.querySelector('.form-err'); if (b) b.textContent = m; };
    const btn = f.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try {
      let body, ok;
      if (kind === 'activity') {
        const t = v('teacher'), some = f.querySelector('input[name=pm]:checked').value === 'some';
        const studentIds = some ? [...f.querySelectorAll('input[name=stu]:checked')].map((x) => x.value) : [];
        if (some && !studentIds.length) { err('Pasirinkite bent vieną dalyvį arba pasirinkite „Visi komiteto mokiniai“.'); return; }
        if (t === 'manual' && !v('teacherName').trim()) { err('Įrašykite mokytojo vardą arba pasirinkite iš sąrašo.'); return; }
        body = { action: 'activity-save', id: v('id'), name: v('name'), classId: v('classId'), description: v('description'), place: v('place'),
          teacherId: t.startsWith('u:') ? t.slice(2) : '', teacherName: t === 'manual' ? v('teacherName') : '', studentIds };
        if (!v('id') && v('d')) body.session = { d: v('d'), from: v('from'), to: v('to'), note: v('note'), repeatUntil: v('repeatUntil') };
        ok = v('id') ? 'Veikla atnaujinta' : 'Veikla sukurta';
      } else {
        body = { action: 'session-save', activityId: v('activityId'), id: v('id'), d: v('d'), from: v('from'), to: v('to'), note: v('note'), repeatUntil: v('repeatUntil') };
        ok = 'Užsiėmimas išsaugotas';
      }
      apply(await api('/api/activities', body));
      dlg.close(); render(); toast(ok);
    } catch (ex) { err(ex.message); }
    finally { if (btn) btn.disabled = false; }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'actRepFrom') { rFrom = t.value; render(); return; }
    if (t.id === 'actRepTo') { rTo = t.value; render(); return; }
    if (t.dataset && t.dataset.snote !== undefined) { if (Auth.can('activities.mark')) note(t.dataset.ssid, t.dataset.snote, t.value.trim()); return; }
    const f = t.closest && t.closest('[data-aform=activity]');
    if (!f) return;
    if (t.name === 'teacher') document.getElementById('actTeacherManual').style.display = t.value === 'manual' ? '' : 'none';
    else if (t.name === 'pm') document.getElementById('actPartPick').style.display = t.value === 'some' ? '' : 'none';
    else if (t.name === 'classId') document.getElementById('actPartPick').innerHTML = '<legend>Dalyviai</legend>' + UI.filterBox({ scope: '#actPartPick', rows: 'label.check', placeholder: 'Ieškoti mokinio…' }) + partList(t.value, []);
  });

  /* ---------- veiksmai ---------- */
  async function remove(body, okMsg) {
    try { apply(await api('/api/activities', body)); toast(okMsg); } catch (e) { toast(e.message); try { apply(await api('/api/activities')); } catch (e2) { /* ignore */ } }
    render();
  }
  function act(a, el) {
    const aid = el && el.dataset.aid, ssid = el && el.dataset.ssid;
    switch (a) {
      case 'act-new': openActForm(null); return true;
      case 'act-new-here': view = 'activities'; render(); openActForm(null, attDate); return true;
      case 'act-edit': openActForm(actById.get(aid)); return true;
      case 'act-close': dlg.close(); return true;
      case 'act-del': {
        const x = actById.get(aid);
        if (!x) return true;
        const marks = sessionsOf(aid).reduce((n, s) => n + (rec.get(s.id) ? rec.get(s.id).size : 0), 0);
        UI.confirm(`Ištrinti veiklą „${x.name}“?\n\nBus pašalinta užsiėmimų: ${sessionsOf(aid).length} ir lankomumo žymų: ${marks}.`).then((ok) => { if (ok) remove({ action: 'activity-delete', id: aid }, 'Veikla ištrinta'); });
        return true;
      }
      case 'act-more': if (more.has(aid)) more.delete(aid); else more.add(aid); render(); return true;
      case 'sess-new': openSessForm(aid, null); return true;
      case 'sess-edit': openSessForm(aid, sessionsOf(aid).find((s) => s.id === ssid)); return true;
      case 'sess-del': {
        const s = D.sessions.find((x) => x.id === ssid);
        if (s) UI.confirm(`Ištrinti užsiėmimą ${s.d}? Šio užsiėmimo lankomumo žymos (${rec.get(ssid) ? rec.get(ssid).size : 0}) bus pašalintos.`).then((ok) => { if (ok) remove({ action: 'session-delete', id: ssid }, 'Užsiėmimas ištrintas'); });
        return true;
      }
      case 'sess-mark': {
        const s = D.sessions.find((x) => x.id === ssid), x = s && actById.get(s.aid);
        if (!x) return true;
        state.currentClassId = x.classId; attDate = s.d; attSession = s.id; view = 'attendance'; render(); window.scrollTo(0, 0);
        return true;
      }
      case 'act-report': repId = aid; rFrom = ''; rTo = ''; render(); window.scrollTo(0, 0); return true;
      case 'act-back': repId = null; render(); return true;
      case 'act-range-clear': rFrom = ''; rTo = ''; render(); return true;
      case 'act-export': exportCsv(); return true;
      case 'act-print': printPage('print-activity', title()); return true;
      case 'pick-session': attSession = el.dataset.ssid; render(); return true;
      case 'smark': mark(ssid, el.dataset.sid, el.dataset.s); render(); return true;
      case 'sall-present': allPresent(ssid); render(); return true;
      case 'sclear': UI.confirm('Išvalyti visas šio užsiėmimo žymas?').then((ok) => { if (ok) { clearSession(ssid); render(); } }); return true;
    }
    return false;
  }

  const activitiesOf = (cid) => D.activities.filter((a) => a.classId === cid);
  return { render: renderPage, act, refresh, activitiesOf, reset, dump, sessionsOn, participants, get, totals, marks, infoHtml, sessionLabel, reportCard, cardSection, closeReport: () => { repId = null; }, hhmm };
})();