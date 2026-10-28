/* Attendance Tracker - single-page app, data stored in this browser (localStorage). */
const APP_VERSION = '13 · Pritaikoma apžvalga'; // rodoma skiltyje „Duomenys“ ir prisijungimo lange
const KEY = 'attendance-tracker-v1';
const THEME_KEY = 'attendance-theme';
const STATUS = {
  P: { label: 'Dalyvavo', short: 'D', cls: 'p' },
  A: { label: 'Nedalyvavo', short: 'N', cls: 'a' },
  L: { label: 'Vėlavo', short: 'V', cls: 'l' },
  E: { label: 'Pateisinta', short: 'P', cls: 'e' },
};

const svg = (p, s) => `<svg viewBox="0 0 24 24" width="${s || 18}" height="${s || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  dash: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  chart: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  db: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  tools: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.4-.6-.6-2.4z"/>'),
  log: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  print: svg('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>'),
  cal: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  up: svg('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
};

let state = { classes: [], students: [], records: {}, currentClassId: null }; // užpildoma iš serverio (Sync.pull)
let view = 'dashboard';
let attDate = today();
let attSession = ''; // '' = automatiškai (pirma dienos veikla), '-' = visa diena, kitaip užsiėmimo id
let repAct = false; // ataskaitose įskaičiuoti veiklų lankomumą
let search = '';
let repFrom = today().slice(0, 8) + '01';
let repTo = today();
let repMode = 'com', repGrade = ''; // ataskaitos: pagal komitetą arba mokinio klasę
let sel = new Set(), visIds = []; // masinis mokinių žymėjimas

const app = document.getElementById('app');
const side = document.getElementById('side');

/* ---------- storage & theme ---------- */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.classes)) return s;
  } catch (e) { /* ignore */ }
  return { classes: [], students: [], records: {}, currentClassId: null };
}
function save() { Sync.queue(); } // po kiekvieno pakeitimo išsaugoma serveryje
function currentTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}
function applyTheme() {
  if (document.documentElement) document.documentElement.dataset.theme = currentTheme();
}

/* ---------- helpers ---------- */
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' });
}
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fullName = (s) => [s.last, s.first].filter(Boolean).join(', ');
const displayName = (s) => [s.first, s.last].filter(Boolean).join(' ');
function avatar(s) {
  const name = displayName(s) || '?';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const ini = ((s.first || '?')[0] + ((s.last || '')[0] || '')).toUpperCase();
  return `<span class="avatar" style="background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 40) % 360} 70% 48%))">${esc(ini)}</span>`;
}
function rateBadge(rate) {
  if (rate == null) return '<span class="rate na">–</span>';
  return `<span class="rate ${rate >= 90 ? 'good' : rate >= 80 ? 'mid' : 'low'}">${rate}%</span>`;
}
function toast(msg) {
  const box = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* Mokinys gali priklausyti keliems komitetams (classIds). Senuose duomenyse buvo vienas classId. */
const normStudent = (s) => Object.assign({}, s, { classIds: Array.isArray(s.classIds) ? s.classIds.slice() : (s.classId ? [s.classId] : []) });
/* Pakeičia mokinio komitetus; pašalintų komitetų lankomumo žymos tam mokiniui išmetamos (serveris daro tą patį). */
function setStudentClasses(s, ids) {
  (s.classIds || []).filter((c) => !ids.includes(c)).forEach((c) => {
    const days = state.records[c] || {};
    for (const d in days) { delete days[d][s.id]; if (!Object.keys(days[d]).length) delete days[d]; }
  });
  s.classIds = ids.slice();
}
function logClient(what, info) { api('/api/log', { action: 'event', what, info: info || '' }).catch(() => { /* ignore */ }); }
function printPage(what, info) {
  document.body.classList.add('print-page');
  logClient(what, info);
  setTimeout(() => window.print(), 50);
}
/* Kiekvieno spausdinto dokumento apačioje – kas jį sukūrė. */
window.addEventListener('beforeprint', () => {
  const f = document.getElementById('printFooter'), u = Auth.user();
  if (f && u) f.textContent = 'Dokumento sukūrėjas: ' + u.name + ' · ' + new Date().toLocaleString('lt-LT', { dateStyle: 'medium', timeStyle: 'short' });
});
window.addEventListener('afterprint', () => document.body.classList.remove('print-page', 'print-card'));
/* Atkuria visą būseną iš kopijos (failo arba serverio) ir išsaugo serveryje; LOG įraše matysis žyma. */
function restoreState(s, label) {
  state = { classes: s.classes, students: s.students.map(normStudent), records: Array.isArray(s.records) ? Sync.nest(s.records) : s.records, currentClassId: null };
  state.currentClassId = state.classes[0] ? state.classes[0].id : null;
  Sync.tag(label); save(); render(); toast('Duomenys atkurti');
}
function wipeStudentRecords(sid) {
  for (const c in state.records) { for (const d in state.records[c]) delete state.records[c][d][sid]; }
}
function removeCommittee(id) {
  state.students = state.students.filter((s) => {
    if (!(s.classIds || []).includes(id)) return true;
    s.classIds = s.classIds.filter((x) => x !== id);
    if (s.classIds.length) return true;
    wipeStudentRecords(s.id);
    return false;
  });
  state.classes = state.classes.filter((x) => x.id !== id);
  delete state.records[id];
  if (state.currentClassId === id) state.currentClassId = state.classes[0] ? state.classes[0].id : null;
}
function curClass() { return state.classes.find((c) => c.id === state.currentClassId) || null; }
function classStudents() {
  return state.students
    .filter((s) => (s.classIds || []).includes(state.currentClassId))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
}

function getRec(cid, date, sid) {
  const r = state.records[cid] && state.records[cid][date];
  return (r && r[sid]) || { s: '', n: '' };
}
function setRec(cid, date, sid, patch) {
  if (!state.records[cid]) state.records[cid] = {};
  if (!state.records[cid][date]) state.records[cid][date] = {};
  const day = state.records[cid][date];
  const next = Object.assign({ s: '', n: '' }, day[sid], patch);
  if (!next.s && !next.n) delete day[sid]; else day[sid] = next;
  if (!Object.keys(day).length) delete state.records[cid][date];
  save();
}
function countDay(cid, date, list) {
  const c = { P: 0, A: 0, L: 0, E: 0, none: 0 };
  list.forEach((s) => { const r = getRec(cid, date, s.id); if (r.s) c[r.s]++; else c.none++; });
  return c;
}
function stats(cid, sid, from, to) {
  const t = { P: 0, A: 0, L: 0, E: 0 };
  const recs = state.records[cid] || {};
  for (const d in recs) {
    if (from && d < from) continue;
    if (to && d > to) continue;
    const r = recs[d][sid];
    if (r && r.s) t[r.s]++;
  }
  const den = t.P + t.L + t.A; // excused days don't count against the student
  t.rate = den ? Math.round(((t.P + t.L) / den) * 100) : null;
  t.total = den + t.E;
  return t;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function parseCSV(text, delim) {
  delim = delim || ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function parseName(line) {
  line = String(line || '').trim();
  if (!line) return null;
  if (line.includes(',')) { const [last, first] = line.split(',').map((x) => x.trim()); return { first: first || '', last: last || '' }; }
  const i = line.lastIndexOf(' ');
  return i < 0 ? { first: line, last: '' } : { first: line.slice(0, i).trim(), last: line.slice(i + 1).trim() };
}

/* ---------- import parsing ---------- */
function detectDelim(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(';') && !line.includes(',')) return ';';
  return ',';
}
/* „vardas.pavarde@dgg.lt“ → { first: 'Vardas', last: 'Pavarde' } (Google Groups eksporte vardų stulpelių nėra) */
function nameFromEmail(email) {
  const parts = String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}
const EMAIL_HEAD = /^(el\.? ?pasto adresas|e-?mail( address)?)$/;
function parseImport(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const firstLine = lines.find((l) => l.trim()) || '';
  if (!firstLine) return [];
  const delimLine = lines.find((l) => /[,;\t]/.test(l)) || firstLine;
  let rows = parseCSV(text, detectDelim(delimLine));
  if (!rows.length) return [];
  /* Google Groups eksportas: pirma eilutė – grupės pavadinimas, antra – antraštė „El. pašto adresas…“ */
  const hi = rows.findIndex((r) => r.some((c) => EMAIL_HEAD.test(UI.norm(c).trim())));
  if (hi > 0) rows = rows.slice(hi);
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const hasHead = head.some((h) => !h.includes('@') && /first|given|forename|last|surname|family|name|e-?mail|parent|guardian|vardas|pavard|mokin|pašt|tėv|globėj/.test(h));
  let items;
  if (hasHead) {
    const find = (re) => head.findIndex((h) => re.test(h));
    const iFirst = find(/first|given|forename|vardas/);
    const iLast = find(/last|surname|family|pavard/);
    const iFull = find(/^(full\s*)?name$|^student|^mokin/);
    const iParent = find(/parent|guardian|tėv|globėj/);
    const iGrade = find(/klas|class|grade/);
    let iEmail = head.findIndex((h) => EMAIL_HEAD.test(UI.norm(h).trim()));
    if (iEmail < 0) iEmail = head.findIndex((h) => /mail|pašt/.test(h) && !/parent|guardian|tėv|globėj/.test(h));
    items = rows.slice(1).map((r) => {
      const cell = (i) => (i >= 0 ? (r[i] || '').trim() : '');
      let first = cell(iFirst), last = cell(iLast);
      if (!first && !last && iFull >= 0) {
        const n = parseName(cell(iFull)) || { first: '', last: '' };
        first = n.first; last = n.last;
      }
      let partial = false;
      if (!first && !last && cell(iEmail).includes('@')) {
        const n = nameFromEmail(cell(iEmail));
        first = n.first; last = n.last; partial = !last; // be pavardės (pvz. arnas@…) – automatiškai nesiejame
      }
      return { first, last, email: cell(iEmail), parentEmail: cell(iParent), grade: cell(iGrade), partial };
    });
  } else if (rows[0].length === 1) {
    // one name per line: use the raw lines so "Last, First" isn't split into columns
    items = text.split(/\r?\n/).map((line) => {
      line = line.trim().replace(/^["']|["']$/g, '');
      if (!line) return null;
      if (/^[^\s@,;]+@[^\s@,;]+$/.test(line)) { // tik el. paštas: vardas ir pavardė paimami iš adreso
        const n = nameFromEmail(line);
        return { first: n.first, last: n.last, email: line, parentEmail: '', grade: '', partial: !n.last };
      }
      const n = parseName(line);
      return n ? Object.assign({ email: '', parentEmail: '', grade: '' }, n) : null;
    }).filter(Boolean);
  } else {
    items = rows.map((r) => {
      const c0 = (r[0] || '').trim();
      if (/^[^\s@]+@[^\s@]+$/.test(c0)) { // pirmas stulpelis – el. paštas (be antraštės)
        const n = nameFromEmail(c0);
        return { first: n.first, last: n.last, email: c0, parentEmail: '', grade: (r[1] || '').trim(), partial: !n.last };
      }
      return { first: c0, last: (r[1] || '').trim(), email: (r[2] || '').trim(), parentEmail: (r[3] || '').trim(), grade: (r[4] || '').trim() };
    });
  }
  return items.filter((x) => x.first || x.last);
}
const keyOf = (s) => (s.first + '|' + s.last).toLowerCase().trim();
/* Vardo raktas be lietuviškų raidžių ir nepriklausomas nuo žodžių tvarkos: „Aistė Matyziūtė“ = „matyziute aiste“ */
const nameKey = (s) => UI.norm((s.first || '') + ' ' + (s.last || '')).split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
/* Kiekvienam importuojamam žmogui: 'link' (esamas mokinys, bus pridėtas prie šio komiteto), 'in' (jau šiame komitete),
   'new' (programoje nėra), 'amb' (keli mokiniai tuo pačiu vardu), 'partial' (nėra pavardės). Pirmiausia lyginama pagal el. paštą. */
function planImport(items) {
  const byEmail = new Map(), byName = new Map();
  state.students.forEach((s) => {
    const e = UI.norm(s.email || '').trim();
    if (e) byEmail.set(e, s);
    const k = nameKey(s);
    if (k) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(s); }
  });
  const seen = new Set(), out = [];
  items.forEach((it) => {
    const k = nameKey(it);
    if (seen.has(k)) return;
    seen.add(k);
    if (it.partial) { out.push({ it, st: 'partial' }); return; }
    const ek = UI.norm(it.email || '').trim();
    let m = ek ? byEmail.get(ek) : null;
    if (!m) {
      const c = byName.get(k) || [];
      if (c.length > 1) { out.push({ it, st: 'amb' }); return; }
      m = c[0];
    }
    if (m) out.push({ it, m, st: (m.classIds || []).includes(state.currentClassId) ? 'in' : 'link' });
    else out.push({ it, st: 'new' });
  });
  return out;
}

/* ---------- rendering ---------- */
const NAV = [['dashboard', 'Apžvalga', ICON.dash], ['attendance', 'Lankomumas', ICON.check], ['activities', 'Veiklos', ICON.cal], ['students', 'Mokiniai', ICON.users], ['allstudents', 'Visi mokiniai', ICON.users], ['classes', 'Komitetai', ICON.book], ['tools', 'Įrankiai', ICON.tools], ['reports', 'Ataskaitos', ICON.chart], ['data', 'Duomenys', ICON.db], ['logs', 'LOG', ICON.log], ['users', 'Vartotojai', ICON.users], ['roles', 'Rolės', ICON.shield]];
const VIEW_PERM = { dashboard: 'dashboard.view', attendance: 'attendance.view', activities: 'activities.view', students: 'students.view', allstudents: 'students.view', classes: 'classes.manage', reports: 'reports.view', tools: 'tools.view', data: 'data.view', logs: 'logs.view', users: 'users.manage', roles: 'roles.manage' };
const ACT_PERM = {
  'new-class': 'classes.manage', 'rename-class': 'classes.manage', 'delete-class': 'classes.manage',
  'act-new': 'activities.create', 'act-new-here': 'activities.create', 'act-edit': 'activities.edit', 'act-del': 'activities.delete', 'sess-new': 'activities.edit', 'sess-edit': 'activities.edit', 'sess-del': 'activities.edit',
  'act-report': 'activities.report', 'act-export': 'activities.report', 'act-print': 'activities.report', smark: 'activities.mark', 'sall-present': 'activities.mark', sclear: 'activities.mark',
  mark: 'attendance.mark', 'all-present': 'attendance.mark', 'clear-day': 'attendance.mark',
  'add-student': 'students.edit', 'edit-student': 'students.edit', 'delete-student': 'students.delete',
  'open-import': 'students.import', 'do-import': 'students.import', template: 'students.import',
  'export-report': 'reports.export', 'export-all-csv': 'data.backup', 'export-json': 'data.backup',
  'restore-label': 'data.restore', wipe: 'data.wipe',
  'rename-class-id': 'classes.manage', 'delete-class-id': 'classes.manage', 'open-promote': 'students.edit', 'do-promote': 'students.edit', 'open-bulk': 'students.edit', 'do-bulk': 'students.edit',
  'tool-gsave': 'tools.save', 'tool-gdel': 'tools.save', 'tool-merge': 'students.delete',
  'tool-tpl-new': 'tools.save', 'tool-tpl-update': 'tools.save', 'tool-tpl-rename': 'tools.save', 'tool-tpl-del': 'tools.save',
  'backup-create': 'data.backup', 'backup-download': 'data.backup', 'backup-restore': 'data.restore', 'log-undo': 'logs.undo', 'log-clear': 'logs.clear', 'log-clear-do': 'logs.clear',
};
function applyPerms() {
  document.querySelectorAll('[data-act]').forEach((el) => {
    const p = ACT_PERM[el.dataset.act];
    if (!p || Auth.can(p)) return;
    if (el.dataset.act === 'mark' || el.dataset.act === 'smark') el.disabled = true; else el.style.display = 'none';
  });
  if (!Auth.can('attendance.mark')) document.querySelectorAll('[data-note]').forEach((el) => { el.disabled = true; });
  if (!Auth.can('activities.mark')) document.querySelectorAll('[data-snote]').forEach((el) => { el.disabled = true; });
}

/* Greita paieška visuose komitetuose: įvedus vardą, pasirodo sąrašas, o paspaudus atsidaro mokinio kortelė. */
let gq = '';
function gsearchResults() {
  const box = document.getElementById('gres');
  if (!box) return;
  const q = UI.norm(gq.trim());
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  const comName = new Map(state.classes.map((c) => [c.id, c.name]));
  const hits = state.students.map((s) => {
    const n = UI.norm(displayName(s) + ' ' + fullName(s)), rest = UI.norm((s.grade || '') + ' ' + (s.email || '') + ' ' + (s.parentEmail || ''));
    const rank = n.startsWith(q) || UI.norm(s.last || '').startsWith(q) ? 0 : n.includes(q) ? 1 : rest.includes(q) ? 2 : 9;
    return { s, rank };
  }).filter((x) => x.rank < 9).sort((a, b) => a.rank - b.rank || fullName(a.s).localeCompare(fullName(b.s), 'lt')).slice(0, 10);
  box.hidden = false;
  box.innerHTML = hits.length ? hits.map(({ s }) => `<button class="gitem" data-act="gopen" data-sid="${s.id}">${avatar(s)}<span><b>${esc(displayName(s))}</b><small>${esc([s.grade, (s.classIds || []).map((id) => comName.get(id)).filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small></span></button>`).join('') : '<div class="gempty">Nieko nerasta</div>';
}
function renderSide() {
  const has = state.classes.length > 0;
  const dark = currentTheme() === 'dark';
  side.innerHTML = `
    <div class="brand"><span class="logo">${ICON.check}</span>Lankomumas</div>
    ${state.students.length ? `<div class="gsearch"><input id="gsearch" type="search" placeholder="Ieškoti mokinio…" autocomplete="off" aria-label="Ieškoti mokinio visuose komitetuose" value="${esc(gq)}"><div id="gres" class="gres" hidden></div></div>` : ''}
    ${has ? `<div class="class-box"><div class="lbl">Komitetas</div>
      <select id="classSelect" aria-label="Komitetas">${state.classes.map((c) => `<option value="${c.id}" ${c.id === state.currentClassId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="class-links"><button class="link-btn" data-act="new-class">+ Nauja</button><button class="link-btn" data-act="rename-class">Pervadinti</button><button class="link-btn danger" data-act="delete-class">Ištrinti</button></div></div>` : ''}
    <nav class="nav">${NAV.filter(([k]) => Auth.can(VIEW_PERM[k])).map(([k, l, ic]) => `<button class="${view === k ? 'active' : ''}" data-act="tab" data-view="${k}">${ic}<span>${l}</span></button>`).join('')}</nav>
    <div class="side-foot">${Auth.userChip()}<button class="btn small" data-act="theme" aria-label="Keisti temą">${dark ? ICON.sun : ICON.moon}<span class="hide-sm">${dark ? 'Šviesi' : 'Tamsi'} tema</span></button></div>`;
  gsearchResults();
}

function head(title, sub, actions) {
  return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions || ''}</div></div>`;
}

function render() {
  if (!Auth.user()) { Auth.renderAuth(); return; }
  document.body.classList.remove('auth-mode');
  if (!Auth.can(VIEW_PERM[view])) {
    const ok = Object.keys(VIEW_PERM).find((k) => Auth.can(VIEW_PERM[k]));
    if (!ok) {
      renderSide();
      app.innerHTML = '<div class="card empty"><h2>Nėra prieigos</h2><p>Jūsų rolė neturi jokių leidimų. Kreipkitės į administratorių.</p></div>';
      return;
    }
    view = ok;
  }
  renderInner();
  applyPerms();
  UI.restoreFilters();
}
function renderInner() {
  const y = window.scrollY;
  renderSide();
  if (!state.classes.length && !['data', 'logs', 'users', 'roles', 'classes'].includes(view)) {
    app.innerHTML = `<div class="card empty"><div class="big">${svg('<path d="M20 6 9 17l-5-5"/>', 30)}</div><h2>Sveiki atvykę į Lankomumo žurnalą</h2>
      <p>${Auth.can('classes.manage') ? 'Sukurkite pirmą komitetą, tada pridėkite mokinius po vieną arba importuokite visą sąrašą per kelias sekundes.' : 'Jums dar nepriskirtas nė vienas komitetas. Kreipkitės į administratorių.'}</p>
      <button class="btn primary" data-act="new-class">${ICON.plus} Sukurti komitetą</button></div>`;
    return;
  }
  ({ dashboard: renderDashboard, students: renderStudents, allstudents: renderAllStudents, attendance: renderAttendance, activities: Acts.render, tools: Tools.render, reports: renderReports, data: renderData, logs: Logs.render, classes: renderClasses, users: Auth.renderUsers, roles: Auth.renderRoles })[view]();
  window.scrollTo(0, y);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Dirbate vėlai' : h < 12 ? 'Labas rytas' : h < 18 ? 'Laba diena' : 'Labas vakaras';
}

function renderDashboard() { Dash.render(); } /* kortelės ir jų pritaikymas – dashboard.js */

function renderAttendance() {
  const cid = state.currentClassId;
  /* Žymėjimas vyksta pagal veiklos užsiėmimą; „Visa diena“ – senasis būdas (leidžiamas, jei tą dieną yra veikla arba yra leidimas „attendance.free“). */
  const sess = Acts.sessionsOn(cid, attDate);
  let ssid = attSession;
  if (ssid !== '-' && !sess.some((x) => x.id === ssid)) ssid = sess.length ? sess[0].id : '-';
  const cur = ssid === '-' ? null : sess.find((x) => x.id === ssid);
  const dayOk = Auth.can('attendance.free') || sess.length > 0;
  const canMark = cur ? Auth.can('activities.mark') : Auth.can('attendance.mark') && dayOk;
  const list = cur ? Acts.participants(cur.act) : classStudents();
  const getR = (sid) => (cur ? Acts.get(cur.id, sid) : getRec(cid, attDate, sid));
  const c = { P: 0, A: 0, L: 0, E: 0, none: 0 };
  list.forEach((s) => { const r = getR(s.id); if (r.s) c[r.s]++; else c.none++; });
  const ssAttr = cur ? ` data-ssid="${cur.id}"` : '';
  const rows = list.map((s) => {
    const r = getR(s.id);
    const btns = Object.keys(STATUS).map((k) =>
      `<button class="${STATUS[k].cls} ${r.s === k ? 'on' : ''}" title="${STATUS[k].label}" data-act="${cur ? 'smark' : 'mark'}"${ssAttr} data-sid="${s.id}" data-s="${k}" ${canMark ? '' : 'disabled'}><span class="lg">${STATUS[k].label}</span><span class="sm">${STATUS[k].short}</span></button>`).join('');
    const noteAttr = cur ? `data-snote="${s.id}" data-ssid="${cur.id}"` : `data-note="${s.id}"`;
    return `<tr><td><div class="who">${avatar(s)}<div><b class="name-link" data-act="student-card" data-sid="${s.id}" role="button" tabindex="0">${esc(displayName(s))}</b>${s.grade ? `<small>${esc(s.grade)} kl.</small>` : ''}</div></div></td><td><div class="seg">${btns}</div></td>` +
      `<td class="hide-sm"><input class="note-input" ${noteAttr} placeholder="Pridėti pastabą" value="${esc(r.n)}" ${canMark ? '' : 'disabled'}></td></tr>`;
  }).join('');
  const tabs = sess.length
    ? `<div class="sess-tabs no-print">${sess.map((x) => `<button class="btn small ${x.id === ssid ? 'primary' : ''}" data-act="pick-session" data-ssid="${x.id}">${esc(x.act.name)}${x.from ? ' · ' + esc(x.from) : ''}</button>`).join('')}<button class="btn small ${ssid === '-' ? 'primary' : ''}" data-act="pick-session" data-ssid="-">Visa diena</button></div>` : '';
  const notice = !cur && !dayOk
    ? `<div class="notice no-print"><span>Šią dieną šiame komitete veiklos nėra, todėl lankomumo žymėti negalima.</span>${Auth.can('activities.create') && Auth.can('activities.view') ? '<button class="btn small primary" data-act="act-new-here">Sukurti veiklą</button>' : '<span class="muted">Kreipkitės į administratorių.</span>'}</div>` : '';
  const actions = `<button class="btn" data-act="print-page" data-what="print-day">${ICON.print} Spausdinti</button>` +
    (canMark ? `<button class="btn" data-act="${cur ? 'sclear' : 'clear-day'}"${ssAttr}>Išvalyti ${cur ? 'užsiėmimą' : 'dieną'}</button><button class="btn primary" data-act="${cur ? 'sall-present' : 'all-present'}"${ssAttr}>${ICON.check} Visi dalyvavo</button>` : '');
  app.innerHTML = head('Lankomumas', prettyDate(attDate), actions) +
    `<div class="card"><div class="print-only print-title"><h2>Lankomumas – ${esc(curClass().name)}${cur ? ' · ' + esc(cur.act.name) : ''}</h2><p>${prettyDate(attDate)}${cur && cur.from ? ' · ' + esc(Acts.hhmm(cur)) : ''}${cur && cur.act.teacherName ? ' · Atsakingas: ' + esc(cur.act.teacherName) : ''}${cur && cur.act.place ? ' · Vieta: ' + esc(cur.act.place) : ''}</p></div>
      <div class="date-bar">
        <button class="icon-btn" data-act="prev-day" aria-label="Ankstesnė diena">&larr;</button>
        <input type="date" id="attDate" value="${attDate}">
        <button class="icon-btn" data-act="next-day" aria-label="Kita diena">&rarr;</button>
        <button class="btn small" data-act="today">Šiandien</button>
      </div>
      ${tabs}${cur ? Acts.infoHtml(cur) : ''}${notice}
      <div class="pills">
        <span class="pill p"><i></i>Dalyvavo ${c.P}</span><span class="pill a"><i></i>Nedalyvavo ${c.A}</span>
        <span class="pill l"><i></i>Vėlavo ${c.L}</span><span class="pill e"><i></i>Pateisinta ${c.E}</span><span class="pill n"><i></i>Nepažymėta ${c.none}</span>
      </div>
      ${list.length ? `${list.length > 5 ? UI.filterBox({ fk: 'att', scope: '#attTbl', placeholder: 'Ieškoti mokinio…' }) : ''}<div class="table-wrap"><table id="attTbl"><thead><tr><th>Mokinys</th><th>Būsena</th><th class="hide-sm">Pastaba</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : cur ? '<div class="empty"><p>Šioje veikloje dalyvių nėra.</p></div>'
          : `<div class="empty"><p>Šiame komitete mokinių dar nėra.</p><button class="btn primary" data-act="open-import">${ICON.upload} Importuoti mokinius</button></div>`}
    </div>`;
}

const canSel = () => Auth.can('students.edit');
const selTh = () => (canSel() ? `<th class="selcol"><input type="checkbox" data-selall aria-label="Pažymėti visus" ${visIds.length && visIds.every((id) => sel.has(id)) ? 'checked' : ''}></th>` : '');
const selTd = (s) => (canSel() ? `<td class="selcol"><input type="checkbox" data-sel="${s.id}" aria-label="Pažymėti" ${sel.has(s.id) ? 'checked' : ''}></td>` : '');
function bulkBar() {
  if (!canSel()) return '';
  const ids = new Set(state.students.map((x) => x.id));
  sel = new Set([...sel].filter((id) => ids.has(id)));
  return `<div class="bulkbar" ${sel.size ? '' : 'hidden'}><span>Pažymėta: <b>${sel.size}</b></span><button class="btn small primary" data-act="open-bulk">Masinis perkėlimas…</button><button class="btn small" data-act="sel-clear">Atžymėti</button></div>`;
}

function renderStudents() {
  const cid = state.currentClassId;
  const q = search.trim().toLowerCase();
  const all = classStudents();
  const list = all.filter((s) => !q || (displayName(s) + ' ' + (s.email || '') + ' ' + (s.parentEmail || '')).toLowerCase().includes(q));
  visIds = list.map((x) => x.id);
  const rows = list.map((s) => {
    const st = stats(cid, s.id);
    return `<tr>${selTd(s)}<td><div class="who">${avatar(s)}<div><b class="name-link" data-act="student-card" data-sid="${s.id}" role="button" tabindex="0">${esc(displayName(s))}</b><small>${esc(s.email || '')}</small></div></div></td>` +
      `<td>${esc(s.grade || '')}</td><td class="hide-sm">${esc(s.parentEmail || '')}</td>` +
      `<td class="num">${st.A}</td><td class="num">${st.L}</td><td class="num">${rateBadge(st.rate)}</td>` +
      `<td class="row-actions"><button class="btn small" data-act="edit-student" data-sid="${s.id}">Redaguoti</button> ` +
      `<button class="btn small danger" data-act="delete-student" data-sid="${s.id}">${(s.classIds || []).length > 1 ? 'Pašalinti' : 'Ištrinti'}</button></td></tr>`;
  }).join('');
  app.innerHTML = head('Mokiniai', `${all.length} komitete ${esc(curClass().name)}`,
    `<button class="btn" data-act="open-import">${ICON.upload} Importuoti</button><button class="btn primary" data-act="add-student">${ICON.plus} Pridėti mokinį</button>`) +
    `<div class="card">
      <div class="actions" style="margin-bottom:12px"><input type="search" class="search" id="search" placeholder="Ieškoti mokinių" value="${esc(search)}"></div>
      ${bulkBar()}
      ${list.length ? `<div class="table-wrap"><table><thead><tr>${selTh()}<th>Mokinys</th><th>Klasė</th><th class="hide-sm">Tėvų el. paštas</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Rodiklis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : q ? '<p class="muted">Nieko nerasta.</p>'
          : `<div class="empty"><div class="big">${ICON.users}</div><h2>Mokinių dar nėra</h2><p>Importuokite komiteto sąrašą iš skaičiuoklės arba pridėkite mokinius po vieną.</p><button class="btn primary" data-act="open-import">${ICON.upload} Importuoti mokinius</button></div>`}
    </div>`;
}

/* ---------- visi mokiniai iš visų komitetų ---------- */
let allQ = '', allCom = '', allGrade = '';
const gradeList = () => [...new Set(state.students.map((s) => (s.grade || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'lt', { numeric: true }));
function statsAll(s, from, to) {
  const t = { P: 0, A: 0, L: 0, E: 0 };
  (s.classIds || []).forEach((c) => { const x = stats(c, s.id, from, to); t.P += x.P; t.A += x.A; t.L += x.L; t.E += x.E; });
  const den = t.P + t.L + t.A;
  t.rate = den ? Math.round(((t.P + t.L) / den) * 100) : null;
  return t;
}
function renderAllStudents() {
  const q = allQ.trim().toLowerCase();
  const comName = new Map(state.classes.map((c) => [c.id, c.name]));
  const comNames = (s) => (s.classIds || []).map((id) => comName.get(id)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'lt', { numeric: true })).join(', ');
  const grades = gradeList();
  if (allCom && !comName.has(allCom)) allCom = '';
  if (allGrade && allGrade !== '-' && !grades.includes(allGrade)) allGrade = '';
  const list = state.students
    .filter((s) => (!allCom || (s.classIds || []).includes(allCom))
      && (!allGrade || (allGrade === '-' ? !s.grade : s.grade === allGrade))
      && (!q || (displayName(s) + ' ' + (s.grade || '') + ' ' + comNames(s) + ' ' + (s.email || '') + ' ' + (s.parentEmail || '')).toLowerCase().includes(q)))
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'lt'));
  visIds = list.map((x) => x.id);
  const rows = list.map((s) => {
    const st = statsAll(s);
    return `<tr>${selTd(s)}<td><div class="who">${avatar(s)}<div><b class="name-link" data-act="student-card" data-sid="${s.id}" role="button" tabindex="0">${esc(displayName(s))}</b><small>${esc(s.email || '')}</small></div></div></td>` +
      `<td>${esc(s.grade || '–')}</td><td>${esc(comNames(s) || '–')}</td>` +
      `<td class="hide-sm">${esc(s.parentEmail || '')}</td><td class="num">${st.A}</td><td class="num">${rateBadge(st.rate)}</td>` +
      `<td class="row-actions"><button class="btn small" data-act="edit-student" data-sid="${s.id}">Redaguoti</button></td></tr>`;
  }).join('');
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  app.innerHTML = head('Visi mokiniai', `${list.length} iš ${state.students.length} mokinių visuose komitetuose`,
    `<button class="btn" data-act="open-promote">${ICON.up} Perkelti klases į kitus metus</button>`) +
    `<div class="card">
      <div class="actions" style="margin-bottom:12px">
        <input type="search" class="search" id="allSearch" placeholder="Ieškoti mokinių" value="${esc(allQ)}">
        <select id="allCom" aria-label="Komitetas">${opt('', 'Visi komitetai', allCom)}${state.classes.slice().sort(byClassName).map((c) => opt(c.id, c.name, allCom)).join('')}</select>
        <select id="allGrade" aria-label="Klasė">${opt('', 'Visos klasės', allGrade)}${grades.map((g) => opt(g, g, allGrade)).join('')}${opt('-', 'Be klasės', allGrade)}</select>
      </div>
      ${bulkBar()}
      ${list.length ? `<div class="table-wrap"><table><thead><tr>${selTh()}<th>Mokinys</th><th>Klasė</th><th>Komitetai</th><th class="hide-sm">Tėvų el. paštas</th><th class="num">Nedalyvavo</th><th class="num">Rodiklis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="muted">Mokinių nerasta.</p>'}
    </div>`;
}

/* Prideda veiklų žymas prie dienos lankomumo sumos (ataskaitoms su pažymėta parinktimi). */
function plusAct(t, x) {
  const r = { P: t.P + x.P, A: t.A + x.A, L: t.L + x.L, E: t.E + x.E };
  const den = r.P + r.L + r.A;
  r.rate = den ? Math.round(((r.P + r.L) / den) * 100) : null;
  r.total = den + r.E;
  return r;
}
function reportData() {
  const inR = (d) => d >= repFrom && d <= repTo;
  const dayMap = new Map();
  let list, getStats, title;
  if (repMode === 'grade') {
    const grades = gradeList();
    if (!repGrade || (repGrade !== '-' && !grades.includes(repGrade))) repGrade = grades[0] || '-';
    list = state.students.filter((s) => (repGrade === '-' ? !s.grade : s.grade === repGrade)).sort((a, b) => fullName(a).localeCompare(fullName(b), 'lt'));
    getStats = (s) => (repAct ? plusAct(statsAll(s, repFrom, repTo), Acts.totals(s.id, { from: repFrom, to: repTo })) : statsAll(s, repFrom, repTo));
    list.forEach((s) => (s.classIds || []).forEach((cid) => {
      const recs = state.records[cid] || {};
      for (const d in recs) {
        if (!inR(d)) continue;
        const r = recs[d][s.id];
        if (r && r.s) { const k = dayMap.get(d) || { P: 0, A: 0, L: 0, E: 0 }; k[r.s]++; dayMap.set(d, k); }
      }
    }));
    title = repGrade === '-' ? 'Mokiniai be klasės' : repGrade + ' klasė';
  } else {
    const cid = state.currentClassId;
    list = classStudents();
    getStats = (s) => (repAct ? plusAct(stats(cid, s.id, repFrom, repTo), Acts.totals(s.id, { cid, from: repFrom, to: repTo })) : stats(cid, s.id, repFrom, repTo));
    Object.keys(state.records[cid] || {}).filter(inR).forEach((d) => { const k = countDay(cid, d, list); dayMap.set(d, { P: k.P, A: k.A, L: k.L, E: k.E }); });
    title = 'Komitetas ' + curClass().name;
  }
  return { list, getStats, dayMap, title };
}
function renderReports() {
  const { list, getStats, dayMap, title } = reportData();
  const comName = new Map(state.classes.map((c) => [c.id, c.name]));
  const comNames = (s) => (s.classIds || []).map((id) => comName.get(id)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'lt', { numeric: true })).join(', ');
  const grade = repMode === 'grade';
  const rows = list.map((s) => {
    const t = getStats(s);
    return `<tr><td><div class="who">${avatar(s)}<div><b class="name-link" data-act="student-card" data-sid="${s.id}" role="button" tabindex="0">${esc(displayName(s))}</b></div></div></td>${grade ? `<td class="hide-sm">${esc(comNames(s) || '–')}</td>` : ''}<td class="num">${t.P}</td><td class="num">${t.A}</td><td class="num">${t.L}</td><td class="num">${t.E}</td><td class="num">${rateBadge(t.rate)}</td></tr>`;
  }).join('');
  const dayRows = [...dayMap.keys()].sort().reverse().map((d) => {
    const k = dayMap.get(d);
    return `<tr><td>${prettyDate(d)}</td><td class="num">${k.P}</td><td class="num">${k.A}</td><td class="num">${k.L}</td><td class="num">${k.E}</td></tr>`;
  }).join('');
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  app.innerHTML = head('Ataskaitos', 'Lankomumo suvestinės pasirinktam laikotarpiui',
    `<button class="btn" data-act="print-page" data-what="print-report">${ICON.print} Spausdinti</button><button class="btn primary" data-act="export-report">Eksportuoti CSV</button>`) +
    `<div class="print-only print-title"><h2>Lankomumo ataskaita – ${esc(title)}</h2><p>${repFrom} – ${repTo}</p></div>
    <div class="card"><div class="actions">
      <select id="repMode" aria-label="Ataskaitos tipas">${opt('com', 'Pagal komitetą (šoninėje juostoje pasirinktą)', repMode)}${opt('grade', 'Pagal mokinio klasę', repMode)}</select>
      ${grade ? `<select id="repGrade" aria-label="Klasė">${gradeList().map((g) => opt(g, g + ' klasė', repGrade)).join('')}${opt('-', 'Be klasės', repGrade)}</select>` : ''}
      <label class="muted">Nuo <input type="date" id="repFrom" value="${repFrom}"></label><label class="muted">Iki <input type="date" id="repTo" value="${repTo}"></label>${Auth.can('activities.view') ? `<label class="check" style="margin:0"><input type="checkbox" id="repAct" ${repAct ? 'checked' : ''}> Įskaičiuoti veiklų lankomumą į rodiklį</label>` : ''}</div></div>
    <div class="card"><h2>Pagal mokinį · ${esc(title)}</h2><p class="sub">Rodiklis = (dalyvavo + vėlavo) ÷ (dalyvavo + vėlavo + nedalyvavo). Pateisintos dienos neįskaičiuojamos.${grade ? ' Klasės ataskaitoje sumuojami visi mokinio komitetai.' : ''}</p>
      ${list.length ? `${list.length > 5 ? UI.filterBox({ fk: 'rep', scope: '#repTbl', placeholder: 'Ieškoti mokinio…' }) : ''}<div class="table-wrap"><table id="repTbl"><thead><tr><th>Mokinys</th>${grade ? '<th class="hide-sm">Komitetai</th>' : ''}<th class="num">Dalyvavo</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Pateisinta</th><th class="num">Rodiklis</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Nėra mokinių.</p>'}</div>
    <div class="card"><h2>Pagal dieną</h2><p class="sub">Tik dienos lankomumas (veiklų užsiėmimai – atskiroje kortelėje žemiau).</p>
      ${dayRows ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th class="num">Dalyvavo</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Pateisinta</th></tr></thead><tbody>${dayRows}</tbody></table></div>` : '<p class="muted">Šiuo laikotarpiu lankomumo įrašų nėra.</p>'}</div>
    ${!grade && Auth.can('activities.view') ? Acts.reportCard(state.currentClassId, repFrom, repTo) : ''}`;
}
function gradeReportCSV() {
  const { list, getStats } = reportData();
  const comName = new Map(state.classes.map((c) => [c.id, c.name]));
  const lines = [['Mokinys', 'Klasė', 'Komitetai', 'Dalyvavo', 'Nedalyvavo', 'Vėlavo', 'Pateisinta', 'Rodiklis %'].map(csvCell).join(',')];
  list.forEach((s) => {
    const t = getStats(s);
    lines.push([displayName(s), s.grade || '', (s.classIds || []).map((id) => comName.get(id)).filter(Boolean).join('; '), t.P, t.A, t.L, t.E, t.rate == null ? '' : t.rate].map(csvCell).join(','));
  });
  return lines.join('\n');
}

function renderData() {
  app.innerHTML = head('Duomenys', 'Atsarginės kopijos ir eksportas') +
    `<div class="card"><h2>Jūsų duomenys</h2>
      <p class="sub">Duomenys automatiškai saugomi serveryje po kiekvieno pakeitimo ir matomi visiems turintiems prieigą.</p>
      <div class="actions">
        <button class="btn primary" data-act="export-json">Atsisiųsti atsarginę kopiją (JSON)</button>
        <button class="btn" data-act="export-all-csv">Eksportuoti visą lankomumą (CSV)</button>
        <label class="btn" data-act="restore-label">Atkurti iš failo<input type="file" id="jsonFile" accept=".json,application/json" hidden></label>
        <span class="spacer"></span>
        <button class="btn danger" data-act="wipe">Ištrinti visus duomenis</button>
      </div></div>
    <div class="card"><h2>Atsarginės kopijos serveryje</h2>
      <p class="sub">Kopija sukuriama automatiškai kiekvieną dieną ir saugoma 30 dienų. Atkūrimą (kaip ir kitus pakeitimus) paprastai galima atšaukti skiltyje LOG.</p>
      <div class="actions" style="margin-bottom:12px"><button class="btn" data-act="backup-create">Sukurti kopiją dabar</button></div>
      ${Backups.html()}</div>
    <p class="muted" style="font-size:.8rem">Programos versija: ${APP_VERSION}</p>`;
}

/* ---------- klasės: valdymas ir perkėlimas į kitus metus ---------- */
const byClassName = (a, b) => a.name.localeCompare(b.name, 'lt', { numeric: true });
/* 1A -> 2A, 9B -> 10B. Nuo 12 klasės ir pavadinimai be skaičiaus nekeičiami. */
function nextClassName(name) {
  const m = /^(\D*)(\d+)(.*)$/.exec(String(name).trim());
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return n >= 12 ? null : m[1] + (n + 1) + m[3];
}
function renderClasses() {
  const list = state.classes.slice().sort(byClassName);
  const rows = list.map((c) => {
    const n = state.students.filter((s) => (s.classIds || []).includes(c.id)).length;
    return `<tr><td><b>${esc(c.name)}</b></td><td class="num">${n}</td><td class="row-actions"><button class="btn small" data-act="rename-class-id" data-cid="${c.id}">Pervadinti</button> <button class="btn small danger" data-act="delete-class-id" data-cid="${c.id}">Ištrinti</button></td></tr>`;
  }).join('');
  app.innerHTML = head('Komitetai', `Iš viso komitetų: ${list.length}`,
    `<button class="btn primary" data-act="new-class">${ICON.plus} Naujas komitetas</button>`) +
    `<div class="card">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Komitetas</th><th class="num">Mokinių</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="muted">Komitetų dar nėra. Spauskite „Naujas komitetas“.</p>'}</div>`;
}
function openPromote() {
  const grades = gradeList();
  const rows = grades.map((g) => {
    const nx = nextClassName(g);
    const n = state.students.filter((s) => s.grade === g).length;
    return `<tr data-grade="${esc(g)}"><td><input type="checkbox" class="pr-on" aria-label="Perkelti ${esc(g)}" ${nx ? 'checked' : ''}></td><td><b>${esc(g)}</b> <small class="muted">(${n})</small></td><td class="muted">&rarr;</td><td><input class="pr-name" value="${esc(nx || g)}"></td></tr>`;
  }).join('');
  importDlg.innerHTML = `<div class="dlg">
    <div class="dlg-head"><h3>Perkelti klases į kitus metus</h3><button type="button" class="icon-btn" data-act="close-import" aria-label="Uždaryti">&times;</button></div>
    ${grades.length ? `<p class="muted" style="margin-top:0">Pakeičiama mokinių <b>klasė</b> (pvz. 7A &rarr; 8A); komitetai ir lankomumas nesikeičia. Pakoreguokite pavadinimus arba atžymėkite klases, kurių perkelti nereikia (12 klasės ir pavadinimai be skaičiaus nekeičiami automatiškai).</p>
    <table class="promote"><thead><tr><th></th><th>Dabar</th><th></th><th>Bus</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="font-size:.8rem;margin:0">Pakeitimą galima atšaukti skiltyje LOG.</p>` : '<p class="muted">Mokiniams dar nepriskirtos klasės.</p>'}
    <div class="dlg-actions"><button type="button" class="btn" data-act="close-import">Atšaukti</button>${grades.length ? '<button type="button" class="btn primary" data-act="do-promote">Perkelti</button>' : ''}</div></div>`;
  importDlg.showModal();
}
function doPromote() {
  const map = new Map();
  importDlg.querySelectorAll('tr[data-grade]').forEach((tr) => {
    const g = tr.dataset.grade, nm = tr.querySelector('.pr-name').value.trim();
    if (tr.querySelector('.pr-on').checked && nm && nm !== g) map.set(g, nm);
  });
  if (!map.size) { toast('Nėra ką perkelti'); return; }
  let n = 0;
  state.students.forEach((s) => { if (map.has(s.grade)) { s.grade = map.get(s.grade); n++; } });
  Sync.tag('Klasių perkėlimas į kitus metus'); save(); importDlg.close(); render(); toast(`Perkelta mokinių: ${n}`);
}

/* ---------- masinis perkėlimas ---------- */
function openBulk() {
  const n = sel.size;
  if (!n) return;
  const opts = state.classes.slice().sort(byClassName).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  importDlg.innerHTML = `<div class="dlg">
    <div class="dlg-head"><h3>Masinis perkėlimas</h3><button type="button" class="icon-btn" data-act="close-import" aria-label="Uždaryti">&times;</button></div>
    <p class="muted" style="margin-top:0">Pažymėta mokinių: <b>${n}</b></p>
    <label class="check"><input type="radio" name="bm" value="move" checked> Perkelti į komitetą (pakeičia visus dabartinius komitetus)</label>
    <label class="check"><input type="radio" name="bm" value="add"> Pridėti prie komiteto</label>
    <label class="check"><input type="radio" name="bm" value="remove"> Pašalinti iš komiteto</label>
    <select id="bmCom" aria-label="Komitetas">${opts}</select>
    <label class="check"><input type="radio" name="bm" value="grade"> Nustatyti klasę (pvz. 8A)</label>
    <input id="bmGrade" list="gradeList" placeholder="Klasė" autocomplete="off" style="width:100%">
    <p class="muted" style="font-size:.8rem">Perkeliant ar šalinant iš komiteto, tų mokinių to komiteto lankomumo žymos pašalinamos. Pakeitimą galima atšaukti skiltyje LOG.</p>
    <div class="dlg-actions"><button type="button" class="btn" data-act="close-import">Atšaukti</button><button type="button" class="btn primary" data-act="do-bulk">Taikyti</button></div></div>`;
  document.getElementById('gradeList').innerHTML = gradeList().map((g) => `<option value="${esc(g)}"></option>`).join('');
  importDlg.showModal();
}
async function doBulk() {
  const mode = importDlg.querySelector('input[name=bm]:checked').value;
  const com = importDlg.querySelector('#bmCom').value;
  const grade = importDlg.querySelector('#bmGrade').value.trim();
  const list = state.students.filter((s) => sel.has(s.id));
  if (!list.length) return;
  if (mode !== 'grade' && !com) { toast('Pasirinkite komitetą'); return; }
  if (mode === 'grade' && !grade && !await UI.confirm('Klasė bus išvalyta pažymėtiems mokiniams. Tęsti?')) return;
  const cname = (state.classes.find((c) => c.id === com) || {}).name || '';
  let n = 0, skipped = 0;
  list.forEach((s) => {
    const cur = s.classIds || [];
    if (mode === 'move') { if (cur.length !== 1 || cur[0] !== com) { setStudentClasses(s, [com]); n++; } }
    else if (mode === 'add') { if (!cur.includes(com)) { s.classIds = cur.concat(com); n++; } }
    else if (mode === 'remove') {
      if (!cur.includes(com)) return;
      if (cur.length <= 1) { skipped++; return; }
      setStudentClasses(s, cur.filter((x) => x !== com)); n++;
    } else if ((s.grade || '') !== grade) { s.grade = grade; n++; }
  });
  const label = { move: `Masinis perkėlimas į „${cname}“`, add: `Masiškai pridėta prie „${cname}“`, remove: `Masiškai pašalinta iš „${cname}“`, grade: `Masiškai nustatyta klasė „${grade || '–'}“` }[mode];
  Sync.tag(label); save(); sel.clear(); importDlg.close(); render();
  toast(`Pakeista mokinių: ${n}${skipped ? ` · praleista ${skipped} (turi likti bent viename komitete)` : ''}`);
}

/* ---------- student dialog ---------- */
const dialog = document.getElementById('studentDialog');
const form = document.getElementById('studentForm');
function openStudentDialog(s) {
  document.getElementById('studentDialogTitle').textContent = s ? 'Redaguoti mokinį' : 'Pridėti mokinį';
  form.id.value = s ? s.id : '';
  form.first.value = s ? s.first : '';
  form.last.value = s ? s.last : '';
  form.email.value = s ? s.email || '' : '';
  form.parentEmail.value = s ? s.parentEmail || '' : '';
  form.notes.value = s ? s.notes || '' : '';
  form.grade.value = s ? s.grade || '' : '';
  const sel = s ? (s.classIds || []) : [state.currentClassId];
  document.getElementById('comPick').innerHTML = '<legend>Komitetai (galima pasirinkti kelis)</legend>' + state.classes.slice().sort(byClassName).map((c) => `<label class="check"><input type="checkbox" name="com" value="${c.id}" ${sel.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('');
  document.getElementById('gradeList').innerHTML = gradeList().map((g) => `<option value="${esc(g)}"></option>`).join('');
  dialog.showModal();
}
form.addEventListener('submit', (e) => {
  const data = {
    first: form.first.value.trim(), last: form.last.value.trim(), email: form.email.value.trim(),
    parentEmail: form.parentEmail.value.trim(), notes: form.notes.value.trim(), grade: form.grade.value.trim(),
  };
  if (!data.first || !Auth.can('students.edit')) return;
  data.classIds = [...form.querySelectorAll('input[name="com"]:checked')].map((x) => x.value);
  if (!data.classIds.length) { e.preventDefault(); UI.alert('Pasirinkite bent vieną komitetą.'); return; }
  if (form.id.value) {
    const st = state.students.find((s) => s.id === form.id.value), ids = data.classIds;
    delete data.classIds; Object.assign(st, data); setStudentClasses(st, ids);
  } else state.students.push(Object.assign({ id: uid() }, data));
  save(); render();
});

function addStudents(items) {
  items.forEach((it) => state.students.push(Object.assign({ id: uid(), classIds: [state.currentClassId], first: '', last: '', email: '', parentEmail: '', notes: '', grade: '' }, it)));
  save(); render();
}

/* ---------- import dialog ---------- */
const importDlg = document.getElementById('importDialog');
function openImport() {
  importDlg.innerHTML = `<div class="dlg">
    <div class="dlg-head"><h3>Importuoti mokinius</h3><button type="button" class="icon-btn" data-act="close-import" aria-label="Uždaryti">&times;</button></div>
    <p class="muted" style="margin-top:0">Pridedama į <b>${esc(curClass().name)}</b>. Veikia su „Excel“, „Google Sheets“, „Google Groups“ narių eksportu (vardai paimami iš vardas.pavarde@… el. pašto) ar bet kokiu mokinių sąrašu. Esami mokiniai nedubliuojami – jie tiesiog pridedami prie šio komiteto.</p>
    <label class="drop" data-drop>
      <input type="file" id="importFile" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" hidden>
      ${ICON.upload}<b>Nuvilkite failą čia arba spustelėkite ir pasirinkite</b><span>.csv, .tsv arba .txt</span>
    </label>
    <div class="divider">arba įklijuokite</div>
    <textarea id="importText" rows="5" placeholder="Įklijuokite eilutes iš skaičiuoklės, po vieną vardą arba el. paštą eilutėje:&#10;Ada Lovelace&#10;alan.turing@dgg.lt&#10;&#10;Arba su stulpeliais:&#10;Vardas, Pavardė, El. paštas, Tėvų el. paštas, Klasė"></textarea>
    <div id="importPreview"></div>
    <label class="check"><input type="checkbox" id="importCreate" checked> Sukurti naujus mokinius, kurių dar nėra programoje (esami tik pridedami prie komiteto)</label>
    <p class="muted" style="font-size:.8rem;margin:0">Patarimas: antraštės eilutė (Vardas, Pavardė, El. paštas, Tėvų el. paštas, Klasė) aptinkama automatiškai. Tinka ir vienas vardų stulpelis.</p>
    <div class="dlg-actions">
      <button type="button" class="btn small" data-act="template">Atsisiųsti šabloną</button><span class="spacer"></span>
      <button type="button" class="btn" data-act="close-import">Atšaukti</button>
      <button type="button" class="btn primary" id="importGo" data-act="do-import" disabled>Importuoti</button>
    </div></div>`;
  importDlg.showModal();
}
const IMP_LABEL = {
  link: ['Esamas – bus pridėtas į komitetą', 'ok'],
  new: ['Naujas mokinys', 'ok'],
  in: ['Jau šiame komitete', 'muted'],
  amb: ['Keli mokiniai tuo pačiu vardu – praleista', 'warn'],
  partial: ['Nėra pavardės – praleista', 'warn'],
  skipnew: ['Programoje nerastas – praleista', 'muted'],
};
function updateImportPreview() {
  const text = document.getElementById('importText').value;
  const create = document.getElementById('importCreate').checked;
  const items = parseImport(text);
  const plan = planImport(items);
  const cnt = (st) => plan.filter((p) => p.st === st).length;
  const link = cnt('link'), fresh = create ? cnt('new') : 0, todo = link + fresh;
  const box = document.getElementById('importPreview');
  const go = document.getElementById('importGo');
  go.disabled = !todo;
  go.textContent = todo ? `Importuoti: ${todo}` : 'Importuoti';
  if (!text.trim()) { box.innerHTML = ''; return; }
  if (!plan.length) { box.innerHTML = '<div class="preview"><div class="ph">Tekste mokinių nerasta.</div></div>'; return; }
  const bits = [`Rasta: ${plan.length}`, `esamų, bus pridėta: ${link}`, `naujų: ${fresh}`];
  if (cnt('in')) bits.push(`jau komitete: ${cnt('in')}`);
  if (!create && cnt('new')) bits.push(`nerasta (praleista): ${cnt('new')}`);
  if (cnt('amb')) bits.push(`dviprasmiška: ${cnt('amb')}`);
  if (cnt('partial')) bits.push(`be pavardės: ${cnt('partial')}`);
  const rows = plan.map((p) => {
    const key = p.st === 'new' && !create ? 'skipnew' : p.st;
    const [lbl, cls] = IMP_LABEL[key];
    const nm = p.m ? displayName(p.m) : ((p.it.first || '') + ' ' + (p.it.last || '')).trim();
    return `<tr><td>${esc(nm)}</td><td class="hide-sm">${esc(p.it.email)}</td><td class="${cls === 'warn' ? '' : 'muted'}">${cls === 'warn' ? '⚠ ' : ''}${esc(lbl)}</td></tr>`;
  }).join('');
  const note = fresh && plan.some((p) => p.st === 'new' && p.it.email && !p.it.grade)
    ? '<div class="ph muted" style="font-weight:400">Naujų mokinių vardai paimti iš el. pašto, todėl be lietuviškų raidžių – prireikus pataisykite kortelėje.</div>' : '';
  box.innerHTML = `<div class="preview"><div class="ph">${bits.join(' · ')}</div>
    <div style="max-height:260px;overflow:auto"><table><thead><tr><th>Mokinys</th><th class="hide-sm">El. paštas</th><th>Veiksmas</th></tr></thead><tbody>${rows}</tbody></table></div>${note}</div>`;
}
function loadImportFile(file) {
  if (!file) return;
  file.text().then((text) => {
    document.getElementById('importText').value = text;
    updateImportPreview();
  });
}
function doImport() {
  const create = document.getElementById('importCreate').checked;
  const plan = planImport(parseImport(document.getElementById('importText').value));
  const cid = state.currentClassId;
  let linked = 0;
  const fresh = [];
  plan.forEach((p) => {
    if (p.st === 'link') {
      p.m.classIds = (p.m.classIds || []).concat(cid);
      if (!p.m.email && p.it.email) p.m.email = p.it.email;
      linked++;
    } else if (p.st === 'new' && create) {
      fresh.push({ first: p.it.first, last: p.it.last, email: p.it.email, parentEmail: p.it.parentEmail, grade: p.it.grade });
    }
  });
  if (!linked && !fresh.length) return;
  fresh.forEach((it) => state.students.push(Object.assign({ id: uid(), classIds: [cid], first: '', last: '', email: '', parentEmail: '', notes: '', grade: '' }, it)));
  Sync.tag(`Importas į komitetą „${curClass().name}“`);
  save();
  importDlg.close();
  view = 'students';
  render();
  toast(`Pridėta esamų: ${linked} · sukurta naujų: ${fresh.length}`);
}

/* ---------- mokinio kortelė ---------- */
const cardDlg = document.getElementById('cardDialog');
function openCard(id) {
  const s = state.students.find((x) => x.id === id);
  if (!s) return;
  const coms = (s.classIds || []).map((cid) => state.classes.find((c) => c.id === cid)).filter(Boolean).sort(byClassName);
  const tot = statsAll(s);
  const comRows = coms.map((c) => { const t = stats(c.id, s.id); return `<tr><td>${esc(c.name)}</td><td class="num">${t.P}</td><td class="num">${t.A}</td><td class="num">${t.L}</td><td class="num">${t.E}</td><td class="num">${rateBadge(t.rate)}</td></tr>`; }).join('');
  const ev = [];
  coms.forEach((c) => { const recs = state.records[c.id] || {}; for (const d in recs) { const r = recs[d][s.id]; if (r && (r.s === 'A' || r.s === 'L' || r.s === 'E' || r.n)) ev.push({ d, c: c.name, s: r.s, n: r.n }); } });
  const cn = new Map(coms.map((c) => [c.id, c.name]));
  Acts.marks(s.id).forEach((m) => { if (m.s === 'A' || m.s === 'L' || m.s === 'E' || m.n) ev.push({ d: m.d, c: (cn.get(m.classId) || '') + ' · ' + m.act, s: m.s, n: m.n }); });
  ev.sort((a, b) => b.d.localeCompare(a.d));
  const evRows = ev.slice(0, 40).map((x) => `<tr><td class="nowrap">${x.d}</td><td>${esc(x.c)}</td><td>${x.s ? `<span class="pill ${STATUS[x.s].cls}"><i></i>${STATUS[x.s].label}</span>` : '–'}</td><td>${esc(x.n || '')}</td></tr>`).join('');
  cardDlg.innerHTML = `<div class="dlg">
    <div class="dlg-head"><span></span><button type="button" class="icon-btn" data-act="close-card" aria-label="Uždaryti">&times;</button></div>
    <div class="card-head">${avatar(s)}<div><h3>${esc(displayName(s))}</h3><span class="muted">Mokinio kortelė${s.grade ? ' · ' + esc(s.grade) + ' klasė' : ''} · ${prettyDate(today())}</span></div><span class="spacer"></span>${rateBadge(tot.rate)}</div>
    <div class="info-grid">
      <div><small>El. paštas</small>${esc(s.email || '–')}</div><div><small>Klasė</small>${esc(s.grade || '–')}</div>
      <div><small>Komitetai</small>${esc(coms.map((c) => c.name).join(', ') || '–')}</div><div><small>Pastabos</small>${esc(s.notes || '–')}</div>
    </div>
    <h4 class="card-sec">Lankomumas</h4>
    ${coms.length ? `<div class="table-wrap"><table><thead><tr><th>Komitetas</th><th class="num">Dalyvavo</th><th class="num">Nedalyvavo</th><th class="num">Vėlavo</th><th class="num">Pateisinta</th><th class="num">Rodiklis</th></tr></thead><tbody>${comRows}
      ${coms.length > 1 ? `<tr><td><b>Iš viso</b></td><td class="num">${tot.P}</td><td class="num">${tot.A}</td><td class="num">${tot.L}</td><td class="num">${tot.E}</td><td class="num">${rateBadge(tot.rate)}</td></tr>` : ''}</tbody></table></div>` : '<p class="muted">Komitetų nėra.</p>'}
    ${Acts.cardSection(s)}
    <h4 class="card-sec">Praleidimai, vėlavimai ir pastabos</h4>
    ${evRows ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Komitetas</th><th>Būsena</th><th>Pastaba</th></tr></thead><tbody>${evRows}</tbody></table></div>${ev.length > 40 ? `<p class="muted" style="font-size:.8rem">Rodoma 40 naujausių iš ${ev.length}.</p>` : ''}` : '<p class="muted">Įrašų nėra.</p>'}
    <div class="dlg-actions"><button type="button" class="btn" data-act="edit-student" data-sid="${s.id}">Redaguoti</button><button type="button" class="btn primary" data-act="print-card" data-sid="${s.id}">${ICON.print} Spausdinti</button></div></div>`;
  applyPerms();
  cardDlg.showModal();
}

/* ---------- exports ---------- */
function allAttendanceCSV(cid, from, to) {
  const list = state.students.filter((s) => (s.classIds || []).includes(cid)).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const days = Object.keys(state.records[cid] || {}).filter((d) => (!from || d >= from) && (!to || d <= to)).sort();
  const lines = [['Mokinys', 'Klasė', ...days, 'Dalyvavo', 'Nedalyvavo', 'Vėlavo', 'Pateisinta', 'Rodiklis %'].map(csvCell).join(',')];
  list.forEach((s) => {
    const cells = days.map((d) => getRec(cid, d, s.id).s);
    const t = stats(cid, s.id, from, to);
    lines.push([displayName(s), s.grade || '', ...cells, t.P, t.A, t.L, t.E, t.rate == null ? '' : t.rate].map(csvCell).join(','));
  });
  return lines.join('\n');
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  if (!e.target.closest('.gsearch')) { const gr = document.getElementById('gres'); if (gr) gr.hidden = true; }
  if (e.target === importDlg) { importDlg.close(); return; }
  if (e.target === dialog) { dialog.close(); return; }
  if (e.target === cardDlg) { cardDlg.close(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const cid = state.currentClassId;
  if (ACT_PERM[act] && !Auth.can(ACT_PERM[act])) { toast('Neturite teisės atlikti šio veiksmo'); return; }
  switch (act) {
    case 'tab': view = el.dataset.view; sel.clear(); UI.clearFilters(); Logs.reset(); Backups.reset(); Auth.invalidate(); Acts.closeReport(); render(); window.scrollTo(0, 0); Acts.refresh().then((ch) => { if (ch) render(); }); break;
    case 'go-attendance': view = 'attendance'; render(); break;
    case 'theme':
      try { localStorage.setItem(THEME_KEY, currentTheme() === 'dark' ? 'light' : 'dark'); } catch (err) { /* ignore */ }
      applyTheme(); render(); break;
    case 'new-class': {
      const name = ((await UI.prompt('Naujas komitetas', '', { label: 'Komiteto pavadinimas', okText: 'Sukurti' })) || '').trim();
      if (!name) break;
      const c = { id: uid(), name };
      state.classes.push(c); state.currentClassId = c.id; save(); render(); break;
    }
    case 'rename-class': {
      const c = curClass(); const name = ((await UI.prompt('Pervadinti komitetą', c.name, { label: 'Naujas pavadinimas' })) || '').trim();
      if (name) { c.name = name; save(); render(); } break;
    }
    case 'delete-class': {
      const c = curClass();
      if (!await UI.confirm(`Ištrinti komitetą „${c.name}“ ir jo lankomumo įrašus? Mokiniai, kurie yra tik šiame komitete, bus ištrinti; kituose komitetuose esantys liks.`)) break;
      removeCommittee(c.id);
      save(); render(); break;
    }
    case 'mark': {
      const cur = getRec(cid, attDate, el.dataset.sid).s;
      setRec(cid, attDate, el.dataset.sid, { s: cur === el.dataset.s ? '' : el.dataset.s });
      render(); break;
    }
    case 'all-present': classStudents().forEach((s) => { if (!getRec(cid, attDate, s.id).s) setRec(cid, attDate, s.id, { s: 'P' }); }); render(); break;
    case 'clear-day': if (await UI.confirm('Išvalyti visas šios dienos žymas?')) { delete (state.records[cid] || {})[attDate]; save(); render(); } break;
    case 'prev-day': attDate = shiftDate(attDate, -1); attSession = ''; render(); break;
    case 'next-day': attDate = shiftDate(attDate, 1); attSession = ''; render(); break;
    case 'today': attDate = today(); attSession = ''; render(); break;
    case 'add-student': openStudentDialog(null); break;
    case 'student-card': openCard(el.dataset.sid); break;
    case 'gopen': { gq = ''; const gi = document.getElementById('gsearch'); if (gi) gi.value = ''; gsearchResults(); openCard(el.dataset.sid); break; }
    case 'close-card': cardDlg.close(); break;
    case 'print-card': { const st = state.students.find((x) => x.id === el.dataset.sid); document.body.classList.add('print-card'); logClient('print-card', st ? displayName(st) : ''); setTimeout(() => window.print(), 50); break; }
    case 'print-page': printPage(el.dataset.what, el.dataset.what === 'print-day' ? curClass().name + ' ' + attDate + (attSession && attSession !== '-' ? ' · ' + Acts.sessionLabel(attSession) : '') : reportData().title + ' ' + repFrom + '–' + repTo); break;
    case 'open-bulk': openBulk(); break;
    case 'do-bulk': doBulk(); break;
    case 'sel-clear': sel.clear(); render(); break;
    case 'edit-student': if (cardDlg.open) cardDlg.close(); openStudentDialog(state.students.find((s) => s.id === el.dataset.sid)); break;
    case 'close-dialog': dialog.close(); break;
    case 'open-import': openImport(); break;
    case 'open-promote': openPromote(); break;
    case 'do-promote': doPromote(); break;
    case 'rename-class-id': {
      const c = state.classes.find((x) => x.id === el.dataset.cid);
      const name = c ? ((await UI.prompt('Pervadinti komitetą', c.name, { label: 'Naujas pavadinimas' })) || '').trim() : '';
      if (name) { c.name = name; save(); render(); } break;
    }
    case 'delete-class-id': {
      const c = state.classes.find((x) => x.id === el.dataset.cid);
      if (!c || !await UI.confirm(`Ištrinti komitetą „${c.name}“ ir jo lankomumo įrašus? Mokiniai, kurie yra tik šiame komitete, bus ištrinti; kituose komitetuose esantys liks.`)) break;
      removeCommittee(c.id);
      save(); render(); break;
    }
    case 'close-import': importDlg.close(); break;
    case 'do-import': doImport(); break;
    case 'template': download('students-template.csv', 'Vardas,Pavardė,El. paštas,Tėvų el. paštas,Klasė\nAda,Lovelace,ada@example.com,tevai@example.com,7A\nAlan,Turing,,,7B\n'); break;
    case 'delete-student': {
      const s = state.students.find((x) => x.id === el.dataset.sid);
      if ((s.classIds || []).length > 1) {
        if (!await UI.confirm(`Pašalinti ${displayName(s)} iš komiteto „${curClass().name}“? Mokinys liks kituose komitetuose.`)) break;
        setStudentClasses(s, s.classIds.filter((x) => x !== cid));
      } else {
        if (!await UI.confirm(`Ištrinti ${displayName(s)}?`)) break;
        state.students = state.students.filter((x) => x.id !== s.id);
        wipeStudentRecords(s.id);
      }
      save(); render(); break;
    }
    case 'export-report': {
      const rd = reportData();
      logClient('export-report', rd.title + ' ' + repFrom + '–' + repTo);
      download(`attendance-${rd.title.replace(/\W+/g, '_')}-${repFrom}_to_${repTo}.csv`, repMode === 'grade' ? gradeReportCSV() : allAttendanceCSV(cid, repFrom, repTo)); break;
    }
    case 'export-all-csv': {
      const out = [];
      state.classes.forEach((c) => { out.push('Komitetas: ' + c.name, allAttendanceCSV(c.id), ''); });
      logClient('export-csv'); download('attendance-all.csv', out.join('\n')); break;
    }
    case 'export-json': logClient('export-json'); download(`attendance-backup-${today()}.json`, JSON.stringify(Object.assign({}, state, { activities: Acts.dump() }), null, 2), 'application/json'); break;
    case 'wipe':
      if (await UI.confirm('Ištrinti VISUS komitetus, mokinius ir lankomumą iš serverio (visiems vartotojams)?') && await UI.confirm('Šio veiksmo atšaukti negalima. Tikrai viską ištrinti?', { danger: true, okText: 'Ištrinti viską' })) {
        state = { classes: [], students: [], records: {}, currentClassId: null }; Sync.tag('Ištrinti visi duomenys'); save(); render();
      }
      break;
    default: if (!Dash.act(act, el) && !Tools.act(act, el) && !Acts.act(act, el) && !Logs.act(act, el) && !Backups.act(act, el)) Auth.act(act, el);
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.sel !== undefined) { if (t.checked) sel.add(t.dataset.sel); else sel.delete(t.dataset.sel); render(); }
  else if (t.dataset && t.dataset.selall !== undefined) { visIds.forEach((id) => { if (t.checked) sel.add(id); else sel.delete(id); }); render(); }
  else if (t.id === 'repMode') { repMode = t.value; render(); }
  else if (t.id === 'repGrade') { repGrade = t.value; render(); }
  else if (t.id === 'repAct') { repAct = t.checked; render(); }
  else if (t.id === 'allCom') { allCom = t.value; render(); }
  else if (t.id === 'allGrade') { allGrade = t.value; render(); }
  else if (t.id === 'classSelect') { state.currentClassId = t.value; save(); render(); }
  else if (t.id === 'attDate') { if (t.value) { attDate = t.value; attSession = ''; render(); } }
  else if (t.id === 'repFrom') { repFrom = t.value || repFrom; render(); }
  else if (t.id === 'repTo') { repTo = t.value || repTo; render(); }
  else if (t.id === 'importFile') loadImportFile(t.files && t.files[0]);
  else if (t.id === 'importCreate') updateImportPreview();
  else if (t.dataset && t.dataset.note) { if (Auth.can('attendance.mark')) setRec(state.currentClassId, attDate, t.dataset.note, { n: t.value.trim() }); }
  else if (t.id === 'jsonFile' && t.files[0] && Auth.can('data.restore')) {
    t.files[0].text().then(async (text) => {
      try {
        const s = JSON.parse(text);
        if (!s || !Array.isArray(s.classes) || !Array.isArray(s.students) || typeof s.records !== 'object') throw new Error('bad');
        if (!await UI.confirm('Pakeisti VISUS serverio duomenis kopijos duomenimis?')) return;
        restoreState(s, 'Atkurta iš failo');
      } catch (err) { UI.alert('Tai nėra tinkama atsarginė kopija.'); }
    });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'gsearch') { gq = e.target.value; gsearchResults(); return; }
  if (e.target.id === 'search') {
    search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.getElementById('search'); el.focus(); el.setSelectionRange(pos, pos);
  } else if (e.target.id === 'allSearch') {
    allQ = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.getElementById('allSearch'); el.focus(); el.setSelectionRange(pos, pos);
  } else if (e.target.id === 'importText') updateImportPreview();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('name-link')) e.target.click();
});

document.addEventListener('dragover', (e) => {
  const z = e.target.closest && e.target.closest('[data-drop]');
  if (z) { e.preventDefault(); z.classList.add('over'); }
});
document.addEventListener('dragleave', (e) => {
  const z = e.target.closest && e.target.closest('[data-drop]');
  if (z) z.classList.remove('over');
});
document.addEventListener('drop', (e) => {
  const z = e.target.closest && e.target.closest('[data-drop]');
  if (z) {
    e.preventDefault(); z.classList.remove('over');
    loadImportFile(e.dataTransfer && e.dataTransfer.files[0]);
  }
});

applyTheme();
Auth.init().then((ok) => { if (ok) render(); });