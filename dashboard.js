/* Apžvalga: kortelės (widgets), kurias kiekvienas vartotojas gali pridėti, išimti ir sukeisti vietomis.
   Išdėstymas saugomas šioje naršyklėje (atskirai kiekvienam vartotojui). Naudoja app.js / auth.js / activities.js / tools.js funkcijas. */
const Dash = (() => {
  const DEFAULT = ['students', 'today', 'absMonth', 'riskCount', 'calendar', 'trend', 'risk'];
  let ids = null, forUser = null, edit = false, dragId = null;
  const key = () => 'attendance-dash-v2:' + (Auth.user() ? Auth.user().id : '');
  const noteKey = () => 'attendance-dash-notes:' + (Auth.user() ? Auth.user().id : '');

  /* ---------- išdėstymo saugojimas ---------- */
  function load() {
    if (ids && forUser === (Auth.user() || {}).id) return;
    forUser = (Auth.user() || {}).id;
    ids = DEFAULT.slice();
    try {
      const a = JSON.parse(localStorage.getItem(key()));
      if (Array.isArray(a)) ids = a.filter((id, i) => W[id] && a.indexOf(id) === i);
    } catch (e) { /* ignore */ }
  }
  function save() { try { localStorage.setItem(key(), JSON.stringify(ids)); } catch (e) { /* ignore */ } }
  const allowed = (id) => W[id] && (!W[id].perm || Auth.can(W[id].perm));

  /* ---------- bendri skaičiavimai (vieną kartą per piešimą) ---------- */
  function ctx() {
    const cid = state.currentClassId, list = classStudents(), t = today(), monthFrom = t.slice(0, 8) + '01';
    const c = countDay(cid, t, list);
    const per = list.map((s) => ({ s, m: stats(cid, s.id, monthFrom, t), all: stats(cid, s.id) }));
    const risk = per.filter((x) => x.all.rate != null && x.all.rate < 80 && x.all.P + x.all.L + x.all.A >= 3).sort((a, b) => a.all.rate - b.all.rate);
    return { cid, list, t, monthFrom, c, per, risk };
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const stat = (col, k, v, h) => `<div class="stat" style="--c:var(${col})"><div class="k">${k}</div><div class="v">${v}</div><div class="h">${h}</div></div>`;
  const card = (title, sub, inner) => `<div class="card"><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${inner}</div>`;
  const person = (s, right, small) => `<div class="risk-item">${avatar(s)}<div class="grow"><b>${esc(displayName(s))}</b>${small ? `<br><small class="muted">${small}</small>` : ''}</div>${right}</div>`;
  const markedToday = (x, s) => !!getRec(x.cid, x.t, s.id).s || Acts.sessionsOn(x.cid, x.t).some((ss) => !!Acts.get(ss.id, s.id).s);
  const sessLine = (x, s) => {
    const ppl = Acts.participants(s.act);
    const n = ppl.filter((p) => Acts.get(s.id, p.id).s).length;
    return `<div class="risk-item"><div class="grow"><b>${esc(s.act.name)}</b><br><small class="muted">${esc(prettyDate(s.d))}${s.from ? ' · ' + esc(Acts.hhmm(s)) : ''}${s.act.place ? ' · ' + esc(s.act.place) : ''} · pažymėta ${n}/${ppl.length}</small></div>
      <button class="btn small primary" data-act="sess-mark" data-ssid="${s.id}">Žymėti</button></div>`;
  };
  const dayList = (x, from, n) => { const out = []; for (let i = 0; i < n; i++) out.push(...Acts.sessionsOn(x.cid, shiftDate(from, i)).map((s) => ({ ...s, d: shiftDate(from, i) }))); return out; };
  const hbar = (label, val, extra) => `<div class="hb"><span class="hb-l" title="${esc(label)}">${esc(label)}</span><div class="hb-t"><i style="width:${val == null ? 0 : Math.max(val, 2)}%"></i></div><b>${val == null ? '–' : val + '%'}</b>${extra ? `<small class="muted">${extra}</small>` : ''}</div>`;

  /* ---------- kortelių sąrašas ---------- */
  const W = {
    students: { t: 'Mokiniai', d: 'Mokinių skaičius komitete', w: 1, html: (x) => stat('--brand', 'Mokiniai', x.list.length, 'šiame komitete') },
    today: { t: 'Šiandien dalyvavo', d: 'Šiandienos lankomumo procentas', w: 1, html: (x) => {
      const r = pct(x.c.P + x.c.L, x.c.P + x.c.L + x.c.A);
      return stat('--p', 'Šiandien dalyvavo', r == null ? '–' : r + '%', `pažymėta ${x.list.length - x.c.none} iš ${x.list.length}`);
    } },
    absMonth: { t: 'Praleidimai šį mėnesį', d: 'Nedalyvavimų skaičius nuo mėnesio pradžios', w: 1, html: (x) => stat('--a', 'Praleidimai šį mėnesį', x.per.reduce((a, p) => a + p.m.A, 0), 'visame komitete') },
    riskCount: { t: 'Reikia dėmesio', d: 'Kiek mokinių žemiau 80%', w: 1, html: (x) => stat('--l', 'Reikia dėmesio', x.risk.length, 'lankomumas žemiau 80%') },
    rateMonth: { t: 'Mėnesio lankomumas', d: 'Komiteto lankomumo procentas šį mėnesį', w: 1, html: (x) => {
      const P = x.per.reduce((a, p) => a + p.m.P + p.m.L, 0), A = x.per.reduce((a, p) => a + p.m.A, 0), r = pct(P, P + A);
      return stat('--p', 'Lankomumas šį mėnesį', r == null ? '–' : r + '%', 'visas komitetas');
    } },
    lateMonth: { t: 'Vėlavimai šį mėnesį', d: 'Vėlavimų skaičius nuo mėnesio pradžios', w: 1, html: (x) => stat('--l', 'Vėlavimai šį mėnesį', x.per.reduce((a, p) => a + p.m.L, 0), 'visame komitete') },
    allStudents: { t: 'Visi mokiniai', d: 'Mokinių ir komitetų skaičius iš viso', w: 1, html: () => stat('--brand-2', 'Visi mokiniai', state.students.length, `komitetų: ${state.classes.length}`) },
    actsMonth: { t: 'Veiklos šį mėnesį', d: 'Užsiėmimų skaičius šį mėnesį', w: 1, perm: 'activities.view', html: (x) => {
      const [y, m] = x.t.split('-').map(Number), n = new Date(y, m, 0).getDate();
      const all = dayList(x, x.monthFrom, n);
      return stat('--e', 'Užsiėmimai šį mėnesį', all.length, `būsimų: ${all.filter((s) => s.d >= x.t).length}`);
    } },
    calendar: { t: 'Kalendorius', d: 'Mėnesio kalendorius su veiklomis', w: 4, html: () => (Tools.calendar ? Tools.calendar() : '') },
    trend: { t: 'Paskutinės 14 dienų', d: 'Lankomumo tendencija', w: 2, html: (x) => {
      const days = [];
      for (let i = 13; i >= 0; i--) days.push(shiftDate(x.t, -i));
      const bars = days.map((d) => {
        const k = countDay(x.cid, d, x.list), r = pct(k.P + k.L, k.P + k.L + k.A);
        return `<div class="bar" title="${d}: ${r == null ? 'nėra duomenų' : 'dalyvavo ' + r + '%'}"><b>${r == null ? '' : r}</b><div class="col ${r == null ? 'none' : ''}" style="height:${r == null ? 4 : Math.max(r, 4)}%"></div><span>${d.slice(8)}</span></div>`;
      }).join('');
      const any = days.some((d) => state.records[x.cid] && state.records[x.cid][d]);
      return card('Paskutinės 14 dienų', 'Dalyvavusių ar pavėlavusių pažymėtų mokinių dalis (%).', any ? `<div class="bars">${bars}</div>` : '<p class="muted">Lankomumas dar nepažymėtas. Pažymėkite lankomumą, kad pamatytumėte tendenciją.</p>');
    } },
    risk: { t: 'Reikia dėmesio (sąrašas)', d: 'Mokiniai su žemiausiu lankomumu', w: 2, html: (x) => card('Reikia dėmesio', 'Mokiniai, kurių lankomumas žemiau 80% (bent 3 pažymėtos dienos).',
      x.risk.length ? `<div class="risk">${x.risk.slice(0, 6).map((r) => person(r.s, rateBadge(r.all.rate), `nedalyvavo ${r.all.A} · vėlavo ${r.all.L}`)).join('')}</div>` : '<p class="muted">Niekas nėra žemiau 80%. Puiku!</p>') },
    status: { t: 'Šiandienos būsenos', d: 'Kiek dalyvavo, nedalyvavo, vėlavo', w: 2, html: (x) => {
      const c = x.c, tot = x.list.length || 1;
      const seg = (k, n) => (n ? `<i class="${k}" style="width:${(n / tot) * 100}%"></i>` : '');
      return card('Šiandienos būsenos', esc(prettyDate(x.t)), `<div class="stack">${seg('p', c.P)}${seg('l', c.L)}${seg('e', c.E)}${seg('a', c.A)}</div>
        <div class="pills"><span class="pill p"><i></i>Dalyvavo ${c.P}</span><span class="pill a"><i></i>Nedalyvavo ${c.A}</span><span class="pill l"><i></i>Vėlavo ${c.L}</span><span class="pill e"><i></i>Pateisinta ${c.E}</span><span class="pill n"><i></i>Nepažymėta ${c.none}</span></div>`);
    } },
    unmarked: { t: 'Nepažymėti šiandien', d: 'Kam dar nepažymėtas šiandienos lankomumas', w: 2, html: (x) => {
      const left = x.list.filter((s) => !markedToday(x, s));
      return card('Nepažymėti šiandien', left.length ? `Dar nepažymėta: ${left.length} iš ${x.list.length}` : '',
        left.length ? `<div class="chips">${left.slice(0, 14).map((s) => `<span class="chip">${esc(displayName(s))}</span>`).join('')}${left.length > 14 ? `<span class="chip">+${left.length - 14}</span>` : ''}</div>`
          : `<p class="muted">${x.list.length ? 'Visi šiandien pažymėti.' : 'Komitete mokinių nėra.'}</p>`);
    } },
    todayActs: { t: 'Šiandienos veiklos', d: 'Šiandien vykstantys užsiėmimai', w: 2, perm: 'activities.view', html: (x) => {
      const l = Acts.sessionsOn(x.cid, x.t).map((s) => ({ ...s, d: x.t }));
      return card('Šiandienos veiklos', esc(prettyDate(x.t)), l.length ? `<div class="risk">${l.map((s) => sessLine(x, s)).join('')}</div>` : '<p class="muted">Šiandien veiklų nėra.</p>');
    } },
    upcoming: { t: 'Artimiausios veiklos', d: 'Veiklos per artimiausias 14 dienų', w: 2, perm: 'activities.view', html: (x) => {
      const l = dayList(x, x.t, 14).slice(0, 6);
      return card('Artimiausios veiklos', 'Per artimiausias 14 dienų', l.length ? `<div class="risk">${l.map((s) => sessLine(x, s)).join('')}</div>` : '<p class="muted">Artimiausiu metu veiklų nėra.</p>');
    } },
    topAbs: { t: 'Daugiausiai praleidę', d: 'Top 5 pagal praleidimus šį mėnesį', w: 2, html: (x) => {
      const l = x.per.filter((p) => p.m.A > 0).sort((a, b) => b.m.A - a.m.A).slice(0, 5);
      return card('Daugiausiai praleidę', 'Šį mėnesį', l.length ? `<div class="risk">${l.map((p) => person(p.s, `<span class="rate low">${p.m.A}</span>`, p.s.grade ? esc(p.s.grade) + ' kl.' : '')).join('')}</div>` : '<p class="muted">Šį mėnesį praleidimų nėra.</p>');
    } },
    best: { t: 'Geriausias lankomumas', d: 'Top 5 pagal bendrą lankomumą', w: 2, html: (x) => {
      const l = x.per.filter((p) => p.all.rate != null && p.all.P + p.all.L + p.all.A >= 3).sort((a, b) => b.all.rate - a.all.rate || b.all.P - a.all.P).slice(0, 5);
      return card('Geriausias lankomumas', 'Bent 3 pažymėtos dienos', l.length ? `<div class="risk">${l.map((p) => person(p.s, rateBadge(p.all.rate), p.s.grade ? esc(p.s.grade) + ' kl.' : '')).join('')}</div>` : '<p class="muted">Dar nepakanka duomenų.</p>');
    } },
    byGrade: { t: 'Lankomumas pagal klasę', d: 'Komiteto mokinių lankomumas pagal klases', w: 2, html: (x) => {
      const g = new Map();
      x.per.forEach((p) => { const k = (p.s.grade || '').trim() || 'Be klasės'; const a = g.get(k) || { n: 0, P: 0, A: 0 }; a.n++; a.P += p.all.P + p.all.L; a.A += p.all.A; g.set(k, a); });
      const rows = [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], 'lt', { numeric: true })).map(([k, a]) => hbar(k, pct(a.P, a.P + a.A), a.n + ' mok.')).join('');
      return card('Lankomumas pagal klasę', 'Visas laikotarpis', rows || '<p class="muted">Nėra duomenų.</p>');
    } },
    weekday: { t: 'Lankomumas pagal savaitės dieną', d: 'Kuriomis dienomis lankomumas geriausias', w: 2, html: (x) => {
      const ok = new Set(x.list.map((s) => s.id)), a = Array.from({ length: 7 }, () => ({ P: 0, A: 0 }));
      const recs = state.records[x.cid] || {};
      for (const d in recs) {
        const [y, m, dd] = d.split('-').map(Number), wd = (new Date(y, m - 1, dd).getDay() + 6) % 7;
        for (const sid in recs[d]) { if (!ok.has(sid)) continue; const s = recs[d][sid].s; if (s === 'P' || s === 'L') a[wd].P++; else if (s === 'A') a[wd].A++; }
      }
      const names = ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'];
      const bars = a.map((v, i) => { const r = pct(v.P, v.P + v.A); return `<div class="bar" title="${r == null ? 'nėra duomenų' : r + '%'}"><b>${r == null ? '' : r}</b><div class="col ${r == null ? 'none' : ''}" style="height:${r == null ? 4 : Math.max(r, 4)}%"></div><span>${names[i]}</span></div>`; }).join('');
      return card('Lankomumas pagal savaitės dieną', 'Visas laikotarpis', a.some((v) => v.P + v.A) ? `<div class="bars">${bars}</div>` : '<p class="muted">Dar nepakanka duomenų.</p>');
    } },
    quick: { t: 'Greiti veiksmai', d: 'Dažniausiai naudojami mygtukai', w: 2, html: () => card('Greiti veiksmai', '',
      `<div class="quick"><button class="btn primary" data-act="go-attendance">${ICON.check} Žymėti lankomumą</button>${Auth.can('activities.view') ? `<button class="btn" data-act="tab" data-view="activities">${ICON.cal} Veiklos</button>` : ''}${Auth.can('tools.use') ? '<button class="btn" data-act="tab" data-view="tools">Įrankiai</button>' : ''}${Auth.can('reports.view') ? `<button class="btn" data-act="tab" data-view="reports">${ICON.chart} Ataskaitos</button>` : ''}<button class="btn" data-act="open-import">${ICON.upload} Importuoti mokinius</button><button class="btn" data-act="add-student">${ICON.plus} Pridėti mokinį</button></div>`) },
    notes: { t: 'Mano užrašai', d: 'Asmeninis užrašų laukas (saugomas šioje naršyklėje)', w: 2, html: () => {
      let v = '';
      try { v = localStorage.getItem(noteKey()) || ''; } catch (e) { /* ignore */ }
      return card('Mano užrašai', 'Matote tik jūs, šiame įrenginyje.', `<textarea class="dnote" data-dnote rows="6" placeholder="Pvz. ką reikia nepamiršti prieš susirinkimą…">${esc(v)}</textarea>`);
    } },
  };

  /* ---------- piešimas ---------- */
  function renderDash() {
    load();
    ids = ids.filter(allowed);
    const x = ctx();
    const sliders = svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>', 17);
    const shown = ids.map((id, i) => {
      const w = W[id];
      let inner = '';
      try { inner = w.html(x); } catch (e) { inner = card(esc(w.t), '', '<p class="muted">Kortelės nepavyko parodyti.</p>'); }
      const ctl = edit ? `<div class="dw-ctl"><button class="dw-b" data-act="dash-left" data-w="${id}" aria-label="Perkelti anksčiau" ${i === 0 ? 'disabled' : ''}>&larr;</button><button class="dw-b" data-act="dash-right" data-w="${id}" aria-label="Perkelti vėliau" ${i === ids.length - 1 ? 'disabled' : ''}>&rarr;</button><button class="dw-b danger" data-act="dash-rm" data-w="${id}" aria-label="Pašalinti kortelę">&times;</button></div>` : '';
      return `<div class="dw w-${w.w}${edit ? ' editing' : ''}" data-w="${id}" ${edit ? 'draggable="true"' : ''}>${ctl}${inner}</div>`;
    }).join('');
    const hidden = Object.keys(W).filter((id) => allowed(id) && !ids.includes(id));
    const bar = edit ? `<div class="card dash-edit"><div class="act-head"><div><h2>Apžvalgos pritaikymas</h2><p class="sub" style="margin:0">Vilkite korteles arba naudokite rodykles, spauskite × norėdami pašalinti. Pakeitimai išsaugomi automatiškai.</p></div>
        <div class="actions"><button class="btn small" data-act="dash-reset">Atkurti numatytąjį</button><button class="btn small primary" data-act="dash-edit">Baigti</button></div></div>
        <h4 class="card-sec">Pridėti kortelę</h4>
        ${hidden.length ? `<div class="dash-add">${hidden.map((id) => `<button class="dash-add-btn" data-act="dash-add" data-w="${id}">${ICON.plus}<span><b>${esc(W[id].t)}</b><small>${esc(W[id].d)}</small></span></button>`).join('')}</div>` : '<p class="muted">Visos kortelės jau pridėtos.</p>'}</div>` : '';
    app.innerHTML = head(`${greeting()}, ${esc(Auth.user().name.split(' ')[0])} 👋`, `${esc(curClass().name)} · ${prettyDate(x.t)}`,
      `<button class="btn ${edit ? 'primary' : ''}" data-act="dash-edit">${sliders} ${edit ? 'Baigti pritaikymą' : 'Pritaikyti'}</button><button class="btn" data-act="open-import">${ICON.upload} Importuoti mokinius</button><button class="btn primary" data-act="go-attendance">${ICON.check} Žymėti lankomumą</button>`) +
      bar + (shown ? `<div class="dash-grid">${shown}</div>` : '<div class="card empty"><p>Apžvalgoje nėra nė vienos kortelės.</p></div>');
  }

  /* ---------- veiksmai ---------- */
  function move(id, delta) {
    const i = ids.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save(); render();
  }
  function act(a, el) {
    const id = el && el.dataset.w;
    switch (a) {
      case 'dash-edit': edit = !edit; render(); return true;
      case 'dash-left': move(id, -1); return true;
      case 'dash-right': move(id, 1); return true;
      case 'dash-rm': ids = ids.filter((x) => x !== id); save(); render(); return true;
      case 'dash-add': if (W[id] && !ids.includes(id)) { ids.push(id); save(); render(); } return true;
      case 'dash-reset': ids = DEFAULT.slice(); save(); render(); toast('Atkurtas numatytasis išdėstymas'); return true;
    }
    return false;
  }

  /* vilkimas (kompiuteriu); telefone naudojamos rodyklės */
  document.addEventListener('dragstart', (e) => {
    const d = e.target.closest && e.target.closest('.dw.editing');
    if (!d) return;
    dragId = d.dataset.w;
    try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (er) { /* ignore */ }
  });
  document.addEventListener('dragover', (e) => {
    const d = dragId && e.target.closest && e.target.closest('.dw.editing');
    if (!d) return;
    e.preventDefault();
    document.querySelectorAll('.dw.over').forEach((n) => { if (n !== d) n.classList.remove('over'); });
    if (d.dataset.w !== dragId) d.classList.add('over');
  });
  document.addEventListener('drop', (e) => {
    const d = dragId && e.target.closest && e.target.closest('.dw.editing');
    if (!d) return;
    e.preventDefault();
    const from = ids.indexOf(dragId), to = ids.indexOf(d.dataset.w);
    dragId = null;
    if (from < 0 || to < 0 || from === to) { render(); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    save(); render();
  });
  document.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.dw.over').forEach((n) => n.classList.remove('over')); });

  document.addEventListener('input', (e) => {
    if (e.target.dataset && e.target.dataset.dnote !== undefined) { try { localStorage.setItem(noteKey(), e.target.value); } catch (er) { /* ignore */ } }
  });

  const reset = () => { ids = null; forUser = null; edit = false; };
  return { render: renderDash, act, reset };
})();
