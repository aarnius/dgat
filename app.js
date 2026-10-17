/* Attendance Tracker - single-page app, data stored in this browser (localStorage). */
const KEY = 'attendance-tracker-v1';
const THEME_KEY = 'attendance-theme';
const STATUS = {
  P: { label: 'Present', short: 'P', cls: 'p' },
  A: { label: 'Absent', short: 'A', cls: 'a' },
  L: { label: 'Late', short: 'L', cls: 'l' },
  E: { label: 'Excused', short: 'E', cls: 'e' },
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
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
};

let state = load();
let view = 'dashboard';
let attDate = today();
let search = '';
let repFrom = today().slice(0, 8) + '01';
let repTo = today();

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
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { alert('Could not save data in this browser. Download a backup from the Data tab.'); }
}
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
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fullName = (s) => [s.last, s.first].filter(Boolean).join(', ');
const displayName = (s) => [s.first, s.last].filter(Boolean).join(' ');
function avatar(s) {
  const name = displayName(s) || '?';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const ini = ((s.first || '?')[0] + (s.last || '')[0] || '').toUpperCase();
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

function curClass() { return state.classes.find((c) => c.id === state.currentClassId) || null; }
function classStudents() {
  return state.students
    .filter((s) => s.classId === state.currentClassId)
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
function parseImport(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  if (!firstLine) return [];
  const rows = parseCSV(text, detectDelim(firstLine));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const hasHead = head.some((h) => !h.includes('@') && /first|given|forename|last|surname|family|name|e-?mail|parent|guardian/.test(h));
  let items;
  if (hasHead) {
    const find = (re) => head.findIndex((h) => re.test(h));
    const iFirst = find(/first|given|forename/);
    const iLast = find(/last|surname|family/);
    const iFull = find(/^(full\s*)?name$|^student/);
    const iParent = find(/parent|guardian/);
    const iEmail = head.findIndex((h) => /mail/.test(h) && !/parent|guardian/.test(h));
    items = rows.slice(1).map((r) => {
      const cell = (i) => (i >= 0 ? (r[i] || '').trim() : '');
      let first = cell(iFirst), last = cell(iLast);
      if (!first && !last && iFull >= 0) {
        const n = parseName(cell(iFull)) || { first: '', last: '' };
        first = n.first; last = n.last;
      }
      return { first, last, email: cell(iEmail), parentEmail: cell(iParent) };
    });
  } else if (rows[0].length === 1) {
    // one name per line: use the raw lines so "Last, First" isn't split into columns
    items = text.split(/\r?\n/).map(parseName).filter(Boolean).map((n) => Object.assign({ email: '', parentEmail: '' }, n));
  } else {
    items = rows.map((r) => ({ first: (r[0] || '').trim(), last: (r[1] || '').trim(), email: (r[2] || '').trim(), parentEmail: (r[3] || '').trim() }));
  }
  return items.filter((x) => x.first || x.last);
}
const keyOf = (s) => (s.first + '|' + s.last).toLowerCase().trim();

/* ---------- rendering ---------- */
const NAV = [['dashboard', 'Dashboard', ICON.dash], ['attendance', 'Attendance', ICON.check], ['students', 'Students', ICON.users], ['reports', 'Reports', ICON.chart], ['data', 'Data', ICON.db]];

function renderSide() {
  const has = state.classes.length > 0;
  const dark = currentTheme() === 'dark';
  side.innerHTML = `
    <div class="brand"><span class="logo">${ICON.check}</span>Attendance</div>
    ${has ? `<div class="class-box"><div class="lbl">Class</div>
      <select id="classSelect" aria-label="Class">${state.classes.map((c) => `<option value="${c.id}" ${c.id === state.currentClassId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="class-links"><button class="link-btn" data-act="new-class">+ New</button><button class="link-btn" data-act="rename-class">Rename</button><button class="link-btn danger" data-act="delete-class">Delete</button></div></div>` : ''}
    <nav class="nav">${NAV.map(([k, l, ic]) => `<button class="${view === k ? 'active' : ''}" data-act="tab" data-view="${k}">${ic}<span>${l}</span></button>`).join('')}</nav>
    <div class="side-foot"><button class="btn small" data-act="theme" aria-label="Toggle theme">${dark ? ICON.sun : ICON.moon}<span class="hide-sm">${dark ? 'Light' : 'Dark'} mode</span></button></div>`;
}

function head(title, sub, actions) {
  return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions || ''}</div></div>`;
}

function render() {
  const y = window.scrollY;
  renderSide();
  if (!state.classes.length && view !== 'data') {
    app.innerHTML = `<div class="card empty"><div class="big">${svg('<path d="M20 6 9 17l-5-5"/>', 30)}</div><h2>Welcome to Attendance</h2>
      <p>Create your first class, then add students one by one or import a whole class list in seconds.</p>
      <button class="btn primary" data-act="new-class">${ICON.plus} Create a class</button></div>`;
    return;
  }
  ({ dashboard: renderDashboard, students: renderStudents, attendance: renderAttendance, reports: renderReports, data: renderData })[view]();
  window.scrollTo(0, y);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function renderDashboard() {
  const cid = state.currentClassId;
  const list = classStudents();
  const t = today();
  const c = countDay(cid, t, list);
  const monthFrom = t.slice(0, 8) + '01';
  let abs = 0;
  list.forEach((s) => { abs += stats(cid, s.id, monthFrom, t).A; });
  const risk = list.map((s) => ({ s, st: stats(cid, s.id) }))
    .filter((x) => x.st.rate != null && x.st.rate < 80 && x.st.P + x.st.L + x.st.A >= 3)
    .sort((a, b) => a.st.rate - b.st.rate);
  const marked = list.length - c.none;
  const todayRate = c.P + c.L + c.A ? Math.round(((c.P + c.L) / (c.P + c.L + c.A)) * 100) : null;

  const days = [];
  for (let i = 13; i >= 0; i--) days.push(shiftDate(t, -i));
  const bars = days.map((d) => {
    const k = countDay(cid, d, list);
    const den = k.P + k.L + k.A;
    const r = den ? Math.round(((k.P + k.L) / den) * 100) : null;
    return `<div class="bar" title="${d}: ${r == null ? 'no data' : r + '% present'}"><b>${r == null ? '' : r}</b><div class="col ${r == null ? 'none' : ''}" style="height:${r == null ? 4 : Math.max(r, 4)}%"></div><span>${d.slice(8)}</span></div>`;
  }).join('');
  const anyData = days.some((d) => state.records[cid] && state.records[cid][d]);

  app.innerHTML = head(`${greeting()} 👋`, `${esc(curClass().name)} · ${prettyDate(t)}`,
    `<button class="btn" data-act="open-import">${ICON.upload} Import students</button><button class="btn primary" data-act="go-attendance">${ICON.check} Take attendance</button>`) +
    `<div class="stats">
      <div class="stat" style="--c:var(--brand)"><div class="k">Students</div><div class="v">${list.length}</div><div class="h">in this class</div></div>
      <div class="stat" style="--c:var(--p)"><div class="k">Present today</div><div class="v">${todayRate == null ? '–' : todayRate + '%'}</div><div class="h">${marked} of ${list.length} marked</div></div>
      <div class="stat" style="--c:var(--a)"><div class="k">Absences this month</div><div class="v">${abs}</div><div class="h">across the class</div></div>
      <div class="stat" style="--c:var(--l)"><div class="k">Needs attention</div><div class="v">${risk.length}</div><div class="h">below 80% attendance</div></div>
    </div>
    <div class="two-col">
      <div class="card"><h2>Last 14 days</h2><p class="sub">Percent of marked students present or late.</p>
        ${anyData ? `<div class="bars">${bars}</div>` : '<p class="muted">No attendance recorded yet. Take attendance to see your trend here.</p>'}</div>
      <div class="card"><h2>Needs attention</h2><p class="sub">Students under 80% (at least 3 marked days).</p>
        ${risk.length ? `<div class="risk">${risk.slice(0, 6).map((x) => `<div class="risk-item">${avatar(x.s)}<div class="grow"><b>${esc(displayName(x.s))}</b><br><small class="muted">${x.st.A} absent · ${x.st.L} late</small></div>${rateBadge(x.st.rate)}</div>`).join('')}</div>`
          : '<p class="muted">Nobody is below 80%. Nice work!</p>'}</div>
    </div>`;
}

function renderAttendance() {
  const cid = state.currentClassId;
  const list = classStudents();
  const c = countDay(cid, attDate, list);
  const rows = list.map((s) => {
    const r = getRec(cid, attDate, s.id);
    const btns = Object.keys(STATUS).map((k) =>
      `<button class="${STATUS[k].cls} ${r.s === k ? 'on' : ''}" title="${STATUS[k].label}" data-act="mark" data-sid="${s.id}" data-s="${k}"><span class="lg">${STATUS[k].label}</span><span class="sm">${STATUS[k].short}</span></button>`).join('');
    return `<tr><td><div class="who">${avatar(s)}<div><b>${esc(displayName(s))}</b></div></div></td><td><div class="seg">${btns}</div></td>` +
      `<td class="hide-sm"><input class="note-input" data-note="${s.id}" placeholder="Add a note" value="${esc(r.n)}"></td></tr>`;
  }).join('');
  app.innerHTML = head('Attendance', prettyDate(attDate),
    `<button class="btn" data-act="clear-day">Clear day</button><button class="btn primary" data-act="all-present">${ICON.check} Mark all present</button>`) +
    `<div class="card">
      <div class="date-bar">
        <button class="icon-btn" data-act="prev-day" aria-label="Previous day">&larr;</button>
        <input type="date" id="attDate" value="${attDate}">
        <button class="icon-btn" data-act="next-day" aria-label="Next day">&rarr;</button>
        <button class="btn small" data-act="today">Today</button>
      </div>
      <div class="pills">
        <span class="pill p"><i></i>Present ${c.P}</span><span class="pill a"><i></i>Absent ${c.A}</span>
        <span class="pill l"><i></i>Late ${c.L}</span><span class="pill e"><i></i>Excused ${c.E}</span><span class="pill n"><i></i>Not marked ${c.none}</span>
      </div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Status</th><th class="hide-sm">Note</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty"><p>No students in this class yet.</p><button class="btn primary" data-act="open-import">${ICON.upload} Import students</button></div>`}
    </div>`;
}

function renderStudents() {
  const cid = state.currentClassId;
  const q = search.trim().toLowerCase();
  const all = classStudents();
  const list = all.filter((s) => !q || (displayName(s) + ' ' + (s.email || '') + ' ' + (s.parentEmail || '')).toLowerCase().includes(q));
  const rows = list.map((s) => {
    const st = stats(cid, s.id);
    return `<tr><td><div class="who">${avatar(s)}<div><b>${esc(displayName(s))}</b><small>${esc(s.email || '')}</small></div></div></td>` +
      `<td class="hide-sm">${esc(s.parentEmail || '')}</td>` +
      `<td class="num">${st.A}</td><td class="num">${st.L}</td><td class="num">${rateBadge(st.rate)}</td>` +
      `<td class="row-actions"><button class="btn small" data-act="edit-student" data-sid="${s.id}">Edit</button> ` +
      `<button class="btn small danger" data-act="delete-student" data-sid="${s.id}">Delete</button></td></tr>`;
  }).join('');
  app.innerHTML = head('Students', `${all.length} in ${esc(curClass().name)}`,
    `<button class="btn" data-act="open-import">${ICON.upload} Import</button><button class="btn primary" data-act="add-student">${ICON.plus} Add student</button>`) +
    `<div class="card">
      <div class="actions" style="margin-bottom:12px"><input type="search" class="search" id="search" placeholder="Search students" value="${esc(search)}"></div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th class="hide-sm">Parent email</th><th class="num">Absent</th><th class="num">Late</th><th class="num">Rate</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : q ? '<p class="muted">No matches.</p>'
          : `<div class="empty"><div class="big">${ICON.users}</div><h2>No students yet</h2><p>Import a class list from a spreadsheet, or add students one at a time.</p><button class="btn primary" data-act="open-import">${ICON.upload} Import students</button></div>`}
    </div>`;
}

function renderReports() {
  const cid = state.currentClassId;
  const list = classStudents();
  const rows = list.map((s) => {
    const t = stats(cid, s.id, repFrom, repTo);
    return `<tr><td><div class="who">${avatar(s)}<div><b>${esc(displayName(s))}</b></div></div></td><td class="num">${t.P}</td><td class="num">${t.A}</td><td class="num">${t.L}</td><td class="num">${t.E}</td><td class="num">${rateBadge(t.rate)}</td></tr>`;
  }).join('');
  const days = Object.keys(state.records[cid] || {}).filter((d) => d >= repFrom && d <= repTo).sort().reverse();
  const dayRows = days.map((d) => {
    const k = countDay(cid, d, list);
    return `<tr><td>${prettyDate(d)}</td><td class="num">${k.P}</td><td class="num">${k.A}</td><td class="num">${k.L}</td><td class="num">${k.E}</td></tr>`;
  }).join('');
  app.innerHTML = head('Reports', 'Attendance totals for any date range',
    `<button class="btn primary" data-act="export-report">Export CSV</button>`) +
    `<div class="card"><div class="actions"><label class="muted">From <input type="date" id="repFrom" value="${repFrom}"></label><label class="muted">To <input type="date" id="repTo" value="${repTo}"></label></div></div>
    <div class="card"><h2>By student</h2><p class="sub">Rate = (present + late) ÷ (present + late + absent). Excused days are left out.</p>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Late</th><th class="num">Excused</th><th class="num">Rate</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No students.</p>'}</div>
    <div class="card"><h2>By day</h2><p class="sub">&nbsp;</p>
      ${days.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Late</th><th class="num">Excused</th></tr></thead><tbody>${dayRows}</tbody></table></div>` : '<p class="muted">No attendance recorded in this range.</p>'}</div>`;
}

function renderData() {
  app.innerHTML = head('Data', 'Backups and exports') +
    `<div class="card"><h2>Your data</h2>
      <p class="sub">Everything is stored in this browser on this device. Download a backup regularly, and use it to move your data to another device.</p>
      <div class="actions">
        <button class="btn primary" data-act="export-json">Download backup (JSON)</button>
        <button class="btn" data-act="export-all-csv">Export all attendance (CSV)</button>
        <label class="btn">Restore backup<input type="file" id="jsonFile" accept=".json,application/json" hidden></label>
        <span class="spacer"></span>
        <button class="btn danger" data-act="wipe">Delete all data</button>
      </div></div>`;
}

/* ---------- student dialog ---------- */
const dialog = document.getElementById('studentDialog');
const form = document.getElementById('studentForm');
function openStudentDialog(s) {
  document.getElementById('studentDialogTitle').textContent = s ? 'Edit student' : 'Add student';
  form.id.value = s ? s.id : '';
  form.first.value = s ? s.first : '';
  form.last.value = s ? s.last : '';
  form.email.value = s ? s.email || '' : '';
  form.parentEmail.value = s ? s.parentEmail || '' : '';
  form.notes.value = s ? s.notes || '' : '';
  dialog.showModal();
}
form.addEventListener('submit', () => {
  const data = {
    first: form.first.value.trim(), last: form.last.value.trim(), email: form.email.value.trim(),
    parentEmail: form.parentEmail.value.trim(), notes: form.notes.value.trim(),
  };
  if (!data.first) return;
  if (form.id.value) Object.assign(state.students.find((s) => s.id === form.id.value), data);
  else state.students.push(Object.assign({ id: uid(), classId: state.currentClassId }, data));
  save(); render();
});

function addStudents(items) {
  items.forEach((it) => state.students.push(Object.assign({ id: uid(), classId: state.currentClassId, first: '', last: '', email: '', parentEmail: '', notes: '' }, it)));
  save(); render();
}

/* ---------- import dialog ---------- */
const importDlg = document.getElementById('importDialog');
function openImport() {
  importDlg.innerHTML = `<div class="dlg">
    <div class="dlg-head"><h3>Import students</h3><button type="button" class="icon-btn" data-act="close-import" aria-label="Close">&times;</button></div>
    <p class="muted" style="margin-top:0">Adding to <b>${esc(curClass().name)}</b>. Works with files from Excel, Google Sheets, or any class list export.</p>
    <label class="drop" data-drop>
      <input type="file" id="importFile" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" hidden>
      ${ICON.upload}<b>Drop a file here, or click to browse</b><span>.csv, .tsv or .txt</span>
    </label>
    <div class="divider">or paste</div>
    <textarea id="importText" rows="5" placeholder="Paste rows copied from a spreadsheet, or one name per line:&#10;Ada Lovelace&#10;Alan Turing&#10;&#10;Or with columns:&#10;First name, Last name, Email, Parent email"></textarea>
    <div id="importPreview"></div>
    <label class="check"><input type="checkbox" id="importSkip" checked> Skip students already in this class</label>
    <p class="muted" style="font-size:.8rem;margin:0">Tip: a header row (First name, Last name, Email, Parent email) is detected automatically. A single column of names also works.</p>
    <div class="dlg-actions">
      <button type="button" class="btn small" data-act="template">Download template</button><span class="spacer"></span>
      <button type="button" class="btn" data-act="close-import">Cancel</button>
      <button type="button" class="btn primary" id="importGo" data-act="do-import" disabled>Import</button>
    </div></div>`;
  importDlg.showModal();
}
function updateImportPreview() {
  const text = document.getElementById('importText').value;
  const skip = document.getElementById('importSkip').checked;
  const items = parseImport(text);
  const have = new Set(classStudents().map(keyOf));
  const fresh = skip ? items.filter((x) => !have.has(keyOf(x))) : items;
  const dupes = items.length - fresh.length;
  const box = document.getElementById('importPreview');
  const go = document.getElementById('importGo');
  go.disabled = !fresh.length;
  go.textContent = fresh.length ? `Import ${fresh.length} student${fresh.length === 1 ? '' : 's'}` : 'Import';
  if (!text.trim()) { box.innerHTML = ''; return; }
  if (!items.length) { box.innerHTML = '<div class="preview"><div class="ph">No students found in this text.</div></div>'; return; }
  box.innerHTML = `<div class="preview"><div class="ph">${items.length} row${items.length === 1 ? '' : 's'} found${dupes ? ` · ${dupes} already in class (skipped)` : ''}</div>
    <table><thead><tr><th>First</th><th>Last</th><th>Email</th><th class="hide-sm">Parent email</th></tr></thead><tbody>
    ${items.slice(0, 5).map((x) => `<tr><td>${esc(x.first)}</td><td>${esc(x.last)}</td><td>${esc(x.email)}</td><td class="hide-sm">${esc(x.parentEmail)}</td></tr>`).join('')}
    ${items.length > 5 ? `<tr><td colspan="4" class="muted">…and ${items.length - 5} more</td></tr>` : ''}</tbody></table></div>`;
}
function loadImportFile(file) {
  if (!file) return;
  file.text().then((text) => {
    document.getElementById('importText').value = text;
    updateImportPreview();
  });
}
function doImport() {
  const skip = document.getElementById('importSkip').checked;
  let items = parseImport(document.getElementById('importText').value);
  if (skip) {
    const have = new Set(classStudents().map(keyOf));
    items = items.filter((x) => {
      const k = keyOf(x);
      if (have.has(k)) return false;
      have.add(k); return true;
    });
  }
  if (!items.length) return;
  addStudents(items);
  importDlg.close();
  view = 'students';
  render();
  toast(`Imported ${items.length} student${items.length === 1 ? '' : 's'}`);
}

/* ---------- exports ---------- */
function allAttendanceCSV(cid, from, to) {
  const list = state.students.filter((s) => s.classId === cid).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const days = Object.keys(state.records[cid] || {}).filter((d) => (!from || d >= from) && (!to || d <= to)).sort();
  const lines = [['Student', ...days, 'Present', 'Absent', 'Late', 'Excused', 'Rate %'].map(csvCell).join(',')];
  list.forEach((s) => {
    const cells = days.map((d) => getRec(cid, d, s.id).s);
    const t = stats(cid, s.id, from, to);
    lines.push([displayName(s), ...cells, t.P, t.A, t.L, t.E, t.rate == null ? '' : t.rate].map(csvCell).join(','));
  });
  return lines.join('\n');
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  if (e.target === importDlg) { importDlg.close(); return; }
  if (e.target === dialog) { dialog.close(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const cid = state.currentClassId;
  switch (act) {
    case 'tab': view = el.dataset.view; render(); window.scrollTo(0, 0); break;
    case 'go-attendance': view = 'attendance'; render(); break;
    case 'theme':
      try { localStorage.setItem(THEME_KEY, currentTheme() === 'dark' ? 'light' : 'dark'); } catch (err) { /* ignore */ }
      applyTheme(); render(); break;
    case 'new-class': {
      const name = (prompt('Class name?') || '').trim();
      if (!name) break;
      const c = { id: uid(), name };
      state.classes.push(c); state.currentClassId = c.id; save(); render(); break;
    }
    case 'rename-class': {
      const c = curClass(); const name = (prompt('New name?', c.name) || '').trim();
      if (name) { c.name = name; save(); render(); } break;
    }
    case 'delete-class': {
      const c = curClass();
      if (!confirm(`Delete "${c.name}" with all its students and attendance?`)) break;
      state.classes = state.classes.filter((x) => x.id !== c.id);
      state.students = state.students.filter((s) => s.classId !== c.id);
      delete state.records[c.id];
      state.currentClassId = state.classes[0] ? state.classes[0].id : null;
      save(); render(); break;
    }
    case 'mark': {
      const cur = getRec(cid, attDate, el.dataset.sid).s;
      setRec(cid, attDate, el.dataset.sid, { s: cur === el.dataset.s ? '' : el.dataset.s });
      render(); break;
    }
    case 'all-present': classStudents().forEach((s) => { if (!getRec(cid, attDate, s.id).s) setRec(cid, attDate, s.id, { s: 'P' }); }); render(); break;
    case 'clear-day': if (confirm('Clear all marks for this day?')) { delete (state.records[cid] || {})[attDate]; save(); render(); } break;
    case 'prev-day': attDate = shiftDate(attDate, -1); render(); break;
    case 'next-day': attDate = shiftDate(attDate, 1); render(); break;
    case 'today': attDate = today(); render(); break;
    case 'add-student': openStudentDialog(null); break;
    case 'edit-student': openStudentDialog(state.students.find((s) => s.id === el.dataset.sid)); break;
    case 'close-dialog': dialog.close(); break;
    case 'open-import': openImport(); break;
    case 'close-import': importDlg.close(); break;
    case 'do-import': doImport(); break;
    case 'template': download('students-template.csv', 'First name,Last name,Email,Parent email\nAda,Lovelace,ada@example.com,parent@example.com\nAlan,Turing,,\n'); break;
    case 'delete-student': {
      const s = state.students.find((x) => x.id === el.dataset.sid);
      if (!confirm(`Delete ${displayName(s)}?`)) break;
      state.students = state.students.filter((x) => x.id !== s.id);
      for (const d in state.records[cid] || {}) delete state.records[cid][d][s.id];
      save(); render(); break;
    }
    case 'export-report': download(`attendance-${curClass().name.replace(/\W+/g, '_')}-${repFrom}_to_${repTo}.csv`, allAttendanceCSV(cid, repFrom, repTo)); break;
    case 'export-all-csv': {
      const out = [];
      state.classes.forEach((c) => { out.push('Class: ' + c.name, allAttendanceCSV(c.id), ''); });
      download('attendance-all.csv', out.join('\n')); break;
    }
    case 'export-json': download(`attendance-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'); break;
    case 'wipe':
      if (confirm('Delete ALL classes, students and attendance from this browser?') && confirm('This cannot be undone. Really delete everything?')) {
        state = { classes: [], students: [], records: {}, currentClassId: null }; save(); render();
      }
      break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'classSelect') { state.currentClassId = t.value; save(); render(); }
  else if (t.id === 'attDate') { if (t.value) { attDate = t.value; render(); } }
  else if (t.id === 'repFrom') { repFrom = t.value || repFrom; render(); }
  else if (t.id === 'repTo') { repTo = t.value || repTo; render(); }
  else if (t.id === 'importFile') loadImportFile(t.files && t.files[0]);
  else if (t.id === 'importSkip') updateImportPreview();
  else if (t.dataset && t.dataset.note) setRec(state.currentClassId, attDate, t.dataset.note, { n: t.value.trim() });
  else if (t.id === 'jsonFile' && t.files[0]) {
    t.files[0].text().then((text) => {
      try {
        const s = JSON.parse(text);
        if (!s || !Array.isArray(s.classes) || !Array.isArray(s.students) || typeof s.records !== 'object') throw new Error('bad');
        if (!confirm('Replace everything in this browser with the backup?')) return;
        state = s; if (!state.currentClassId && state.classes[0]) state.currentClassId = state.classes[0].id;
        save(); render();
      } catch (err) { alert('That file is not a valid backup.'); }
    });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.getElementById('search'); el.focus(); el.setSelectionRange(pos, pos);
  } else if (e.target.id === 'importText') updateImportPreview();
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
if (!state.currentClassId && state.classes[0]) state.currentClassId = state.classes[0].id;
render();