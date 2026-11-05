/* Prisijungimas, vartotojai, rolės ir leidimai (kalbasi su serveriu per /api/*).
   Interfeisas tik slepia mygtukus – tikrasis leidimų tikrinimas vyksta serveryje. */
const PERMS = [
  { g: 'Apžvalga', items: [['dashboard.view', 'Matyti apžvalgą'], ['calendar.all', 'Matyti bendrą visų komitetų kalendorių apžvalgoje']] },
  { g: 'Lankomumas', items: [['attendance.view', 'Matyti lankomumą'], ['attendance.mark', 'Žymėti lankomumą'], ['attendance.free', 'Žymėti dienos lankomumą be veiklos (kitaip – tik dienomis, kai komitetas turi veiklą)']] },
  { g: 'Veiklos', items: [['activities.view', 'Matyti veiklas'], ['activities.create', 'Kurti veiklas (tik matomiems komitetams)'], ['activities.edit', 'Redaguoti veiklas ir jų užsiėmimus (datas)'], ['activities.delete', 'Ištrinti veiklas'], ['activities.mark', 'Žymėti lankomumą veiklų užsiėmimuose'], ['activities.report', 'Veiklų ataskaitos, eksportas ir spausdinimas'], ['activities.past', 'Keisti jau įvykusias veiklas (praėjusių datų užsiėmimus): žymėti, redaguoti, trinti. Be šio leidimo galima tik šiandienos ir būsimų']] },
  { g: 'Mokiniai', items: [['students.view', 'Matyti mokinius'], ['students.edit', 'Pridėti ir redaguoti mokinius'], ['students.delete', 'Ištrinti mokinius'], ['students.import', 'Importuoti mokinius'], ['students.access', 'Išduoti mokiniams prisijungimo kodus (jie matys savo lankomumą puslapyje /mano)'], ['students.photo', 'Keisti mokinių profilio nuotraukas']] },
  { g: 'Komitetai', items: [['classes.all', 'Matyti visus komitetus (kitaip – tik vartotojui priskirtus)'], ['classes.manage', 'Kurti, pervadinti ir ištrinti komitetus']] },
  { g: 'Ataskaitos', items: [['reports.view', 'Matyti ataskaitas'], ['reports.export', 'Eksportuoti ataskaitas (CSV)']] },
  { g: 'Duomenys', items: [['data.view', 'Atidaryti skiltį „Duomenys“'], ['data.backup', 'Atsisiųsti atsarginę kopiją'], ['data.restore', 'Atkurti iš kopijos'], ['data.wipe', 'Ištrinti visus duomenis']] },
  { g: 'Įrankiai', items: [['tools.view', 'Naudoti įrankius (grupės, traukimas, sąrašai, rizikos sąrašas, dublikatai)'], ['tools.save', 'Išsaugoti ir ištrinti sugrupavimus']] },
  { g: 'LOG (pakeitimų istorija)', items: [['logs.view', 'Matyti LOG'], ['logs.undo', 'Atšaukti pakeitimus (Undo)'], ['logs.clear', 'Valyti LOG']] },
  { g: 'Administravimas', items: [['users.manage', 'Valdyti vartotojus'], ['roles.manage', 'Valdyti roles ir leidimus']] },
];

async function api(path, body) {
  let r;
  try {
    r = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { const err = new Error('Nėra ryšio su serveriu.'); err.status = 0; throw err; }
  let j = null;
  try { j = await r.json(); } catch (e) { /* ignore */ }
  if (!r.ok) {
    const err = new Error((j && j.error) || ('Serverio klaida (' + r.status + ')'));
    err.status = r.status;
    if (r.status === 401 && path !== '/api/auth') Auth.expire();
    if (r.status === 403 && j && j.mustChange) Auth.forceChange();
    throw err;
  }
  return j;
}

/* Slaptažodžių politika (BDAR 32 str. – „tinkamos saugumo priemonės“; taikoma pagal NIST SP 800-63B / VDAI rekomendacijas).
   Dubliuoja serverio lib/server.js passwordIssues – keiskite abi vietas kartu. Serveris visada tikrina iš naujo. */
const PW_COMMON = ['password', 'passw0rd', 'slaptazodis', 'qwertyuiop', 'qwerty123', 'iloveyou', 'letmein', 'welcome', 'admin123', 'administrator', 'lietuva', 'lankomumas', 'taryba', 'dgtaryba', 'gimnazija', 'mokinys', 'mokytojas', 'abc123', 'monkey', 'dragon', 'football', 'master', 'sunshine'];
const pwPlain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function pwRules(pw, ctx) {
  ctx = ctx || {};
  const low = pwPlain(pw);
  const bits = [ctx.username].concat(String(ctx.name || '').split(/\s+/), String(ctx.email || '').split('@')[0]).map(pwPlain).filter((x) => x.length >= 3);
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\d/, /[^\p{L}\p{N}]/u].filter((r) => r.test(pw)).length;
  return [
    ['Bent 12 simbolių', pw.length >= 12],
    ['Bent 3 iš 4: mažosios, didžiosios, skaičiai, ženklai (arba 16+ simbolių frazė)', pw.length >= 16 || kinds >= 3],
    ['Be vardo, pavardės, vartotojo vardo ar el. pašto pradžios', !bits.some((b) => low.includes(b))],
    ['Ne paplitęs žodis ar seka (qwerty, 1234, aaaaa…)', !(PW_COMMON.some((c) => low.includes(c)) || /(.)\1{4,}/.test(pw) || /(?:0123|1234|2345|3456|4567|5678|6789|qwert|asdfg|zxcvb)/.test(low))],
  ];
}
const pwIssues = (pw, ctx) => pwRules(pw, ctx).filter((r) => !r[1]).map((r) => r[0]);
function pwGenerate() {
  const sets = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%*-_+=?'], all = sets.join('');
  const rnd = (n) => { const u = new Uint32Array(1); const lim = 4294967296 - (4294967296 % n); do { crypto.getRandomValues(u); } while (u[0] >= lim); return u[0] % n; };
  const a = sets.map((s) => s[rnd(s.length)]);
  while (a.length < 16) a.push(all[rnd(all.length)]);
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join('');
}
const pwHint = () => '<ul class="pw-rules" data-pwrules></ul>';
function pwUpdate(form) {
  const box = form.querySelector('[data-pwrules]'), inp = form.elements.password;
  if (!box || !inp) return;
  const get = (n) => (form.elements[n] ? form.elements[n].value : '');
  const rules = pwRules(inp.value, { username: get('username') || (Auth.user() || {}).username, name: get('name') || (Auth.user() || {}).name, email: get('email') || (Auth.user() || {}).email });
  box.innerHTML = rules.map((r) => `<li class="${inp.value ? (r[1] ? 'ok' : 'bad') : ''}">${r[1] && inp.value ? '✓' : '○'} ${esc(r[0])}</li>`).join('');
}

const Auth = (() => {
  let me = null, needsSetup = false, admin = null, loginMsg = '';
  const dlg = document.createElement('dialog');
  dlg.id = 'authDialog';
  document.body.appendChild(dlg);

  const loading = () => { app.innerHTML = '<p class="muted" style="padding:24px">Kraunama…</p>'; };
  const user = () => me;
  const isSuper = () => !!me && me.roleId === 'superadmin';
  function can(p) {
    if (!me) return false;
    if (!p) return true;
    return me.perms === '*' || me.perms.includes(p);
  }

  /* ---------- paleidimas ---------- */
  async function init() {
    loading();
    try {
      const r = await api('/api/auth');
      me = r.user; needsSetup = r.needsSetup;
      if (me && !me.mustChange) { await Sync.pull(); await Sync.migrateLegacy(); }
      return true;
    } catch (e) {
      side.innerHTML = '';
      app.innerHTML = `<div class="card empty"><h2>Nepavyko prisijungti prie serverio</h2><p>${esc(e.message)}</p><button class="btn primary" data-act="retry">Bandyti dar kartą</button></div>`;
      return false;
    }
  }
  async function refreshMe() {
    const r = await api('/api/auth');
    if (!r.user) { if (me) expire(); return false; }
    const before = JSON.stringify(me);
    me = r.user;
    return JSON.stringify(me) !== before;
  }
  function expire(msg) {
    me = null; admin = null; Sync.reset();
    loginMsg = msg || 'Sesija baigėsi. Prisijunkite iš naujo.';
    render();
  }

  /* ---------- prisijungimo / pirmos paleisties ekranas ---------- */
  function renderAuth() {
    document.body.classList.add('auth-mode');
    side.innerHTML = '';
    const first = needsSetup;
    app.innerHTML = `<div class="login-wrap"><div class="login-card">
      <span class="logo">${ICON.check}</span>
      <h1>${first ? 'Sveiki atvykę' : 'Prisijungimas'}</h1>
      <p class="muted">${first ? 'Sukurkite pagrindinę superadministratoriaus paskyrą. Ji galės kurti vartotojus ir roles.' : 'Prisijunkite prie lankomumo žurnalo.'}</p>
      <form data-form="${first ? 'setup' : 'login'}" class="dlg" style="padding:0">
        ${first ? '<label>Vardas ir pavardė<input name="name" required autocomplete="name"></label>' : ''}
        <label>Vartotojo vardas<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label>Slaptažodis<input name="password" type="password" required ${first ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"'}></label>
        ${first ? '<label>Pakartokite slaptažodį<input name="password2" type="password" required minlength="8" autocomplete="new-password"></label>' : '<label class="check"><input type="checkbox" name="remember"> Likti prisijungus šiame įrenginyje</label>'}
        <div class="form-err" role="alert">${esc(loginMsg)}</div>
        <button type="submit" class="btn primary block">${first ? 'Sukurti paskyrą' : 'Prisijungti'}</button>
      </form><p class="muted" style="font-size:.75rem;text-align:center;margin:14px 0 0">v. ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''} · <a href="/privatumas" style="color:inherit">Privatumo politika</a></p></div></div>`;
    loginMsg = '';
    const f = app.querySelector('input'); if (f) f.focus();
  }

  /* ---------- privalomas slaptažodžio keitimas ---------- */
  function renderForceChange() {
    document.body.classList.add('auth-mode');
    side.innerHTML = '';
    app.innerHTML = `<div class="login-wrap"><div class="login-card">
      <span class="logo">${ICON.check}</span>
      <h1>Susikurkite slaptažodį</h1>
      <p class="muted">${esc(me.name)}, prisijungėte su laikinu slaptažodžiu. Prieš tęsdami susikurkite savo slaptažodį.</p>
      <form data-form="forcepw" class="dlg" style="padding:0">
        <label>Laikinas (dabartinis) slaptažodis<input name="current" type="password" required autocomplete="current-password"></label>
        <label>Naujas slaptažodis<input name="password" type="password" required autocomplete="new-password"></label>
        <label>Pakartokite naują slaptažodį<input name="password2" type="password" required autocomplete="new-password"></label>
        <input type="hidden" name="username" value="${esc(me.username)}"><input type="hidden" name="name" value="${esc(me.name)}"><input type="hidden" name="email" value="${esc(me.email || '')}">
        ${pwHint()}
        <div class="form-err" role="alert"></div>
        <button type="submit" class="btn primary block">Išsaugoti ir tęsti</button>
        <button type="button" class="btn block" data-act="logout" style="margin-top:8px">Atsijungti</button>
      </form></div></div>`;
    pwUpdate(app.querySelector('form'));
    const f = app.querySelector('input'); if (f) f.focus();
  }
  /* Serveris pasakė, kad reikia keisti slaptažodį (pvz. administratorius pareikalavo, kol buvote prisijungę). */
  function forceChange() {
    if (!me || me.mustChange) return;
    me = Object.assign({}, me, { mustChange: true });
    if (dlg.open) dlg.close();
    render();
  }

  /* ---------- šoninė juosta: vartotojas ---------- */
  function userChip() {
    if (!me) return '';
    const out = svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>');
    const pen = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 15);
    return `<div class="userchip"><button class="userchip-btn" data-act="my-account" title="Keisti vardą ir slaptažodį">${avatar({ first: me.name, uid: me.id, photo: me.photo })}<span class="hide-sm"><b>${esc(me.name)}</b><small class="muted">${esc(me.roleName || '')}</small></span><span class="chip-edit" aria-hidden="true">${pen}</span></button>
      <button class="icon-btn" data-act="logout" title="Atsijungti" aria-label="Atsijungti">${out}</button></div>`;
  }

  /* ---------- administravimo duomenys ---------- */
  function ensureAdmin() {
    if (admin) return true;
    loading();
    api('/api/admin').then((r) => { admin = r; render(); })
      .catch((e) => { app.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; });
    return false;
  }
  const invalidate = () => { admin = null; };
  const roleName = (id) => { const r = admin.roles.find((x) => x.id === id); return r ? r.name : '–'; };
  async function adminCall(body, okMsg) {
    try {
      admin = await api('/api/admin', body);
      if (await refreshMe()) { /* mano leidimai pasikeitė */ }
      if (admin.invite) { toast(admin.invite.sent ? 'Laiškas išsiųstas: ' + admin.invite.sent : 'Laiško išsiųsti nepavyko: ' + admin.invite.error); }
      else if (okMsg) toast(okMsg);
      if (admin.temp) showTemp(admin.temp);
    } catch (e) {
      toast(e.message);
      try { admin = await api('/api/admin'); } catch (e2) { /* ignore */ }
    }
    render();
  }

  function showTemp(t) {
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>Laikinas slaptažodis</h3><button type="button" class="icon-btn" data-act="close-auth" aria-label="Uždaryti">&times;</button></div>
      <p>Vartotojui <b>${esc(t.username)}</b> sugeneruotas laikinas slaptažodis. Jis rodomas tik dabar – perduokite saugiai (ne viešame kanale). Prisijungęs vartotojas privalės iškart susikurti savo slaptažodį.</p>
      <div class="temp-pw"><code>${esc(t.password)}</code></div>
      <div class="dlg-actions"><button type="button" class="btn" data-act="copy-temp" data-pw="${esc(t.password)}">Kopijuoti</button><button type="button" class="btn primary" data-act="close-auth">Uždaryti</button></div></div>`;
    if (!dlg.open) dlg.showModal();
  }

  /* ---------- vartotojų puslapis ---------- */
  function renderUsers() {
    if (!ensureAdmin()) return;
    const rows = admin.users.map((u) => {
      const off = !u.active;
      return `<tr><td><div class="who">${avatar({ first: u.name, uid: u.id, photo: u.photo })}<div><b>${esc(u.name)}</b><small>${esc(u.username)}</small></div></div></td>
        <td>${esc(roleName(u.roleId))}</td>
        <td class="hide-sm"><span class="rate ${off ? 'low' : 'good'}">${off ? 'Išjungtas' : 'Aktyvus'}</span>${u.mustChange ? ' <span class="rate mid" title="Prisijungęs privalės pakeisti slaptažodį">Turi pakeisti slaptažodį</span>' : ''}</td>
        <td class="row-actions"><button class="btn small" data-act="edit-user" data-uid="${u.id}">Redaguoti</button> ${u.id === me.id ? '' : `<button class="btn small" data-act="force-pw" data-uid="${u.id}" title="${u.mustChange ? 'Atšaukti reikalavimą pakeisti slaptažodį' : 'Vartotojas privalės pakeisti slaptažodį kitą kartą jam atidarius sistemą'}">${u.mustChange ? 'Atšaukti keitimą' : 'Priversti keisti'}</button> <button class="btn small" data-act="temp-pw" data-uid="${u.id}" title="Sugeneruoti naują laikiną slaptažodį${u.email ? ' ir išsiųsti laišku' : ''}">Naujas laikinas</button> `}<button class="btn small danger" data-act="delete-user" data-uid="${u.id}">Ištrinti</button></td></tr>`;
    }).join('');
    app.innerHTML = head('Vartotojai', 'Kas gali prisijungti ir kokia jų rolė',
      `<button class="btn primary" data-act="add-user">${ICON.plus} Pridėti vartotoją</button>`) +
      `<div class="card"><div class="table-wrap"><table><thead><tr><th>Vartotojas</th><th>Rolė</th><th class="hide-sm">Būsena</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  function openUserDialog(u) {
    const edit = !!u;
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>${edit ? 'Redaguoti vartotoją' : 'Naujas vartotojas'}</h3><button type="button" class="icon-btn" data-act="close-auth" aria-label="Uždaryti">&times;</button></div>
      <form data-form="user"><input type="hidden" name="id" value="${edit ? u.id : ''}">
        <label>Vardas ir pavardė<input name="name" required value="${esc(edit ? u.name : '')}"></label>
        <label>Vartotojo vardas (prisijungimui)<input name="username" required autocapitalize="none" spellcheck="false" value="${esc(edit ? u.username : '')}"></label>
        <label>Rolė<select name="roleId">${admin.roles.map((r) => `<option value="${r.id}" ${edit && u.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <label>El. paštas (nebūtina – prisijungimo duomenims išsiųsti)<input name="email" type="email" autocapitalize="none" spellcheck="false" autocomplete="off" value="${esc(edit ? u.email || '' : '')}"></label>
        <label>${edit ? 'Naujas slaptažodis (palikite tuščią, jei nekeičiate)' : 'Laikinas slaptažodis'}<span class="pw-row"><input name="password" type="password" autocomplete="new-password" ${edit ? '' : 'required'}><button type="button" class="btn small" data-act="gen-pw">Sugeneruoti</button></span></label>
        ${pwHint()}
        <label class="check"><input type="checkbox" name="mustChange" checked> Priversti pakeisti slaptažodį pirmą kartą prisijungus</label>
        <label class="check"><input type="checkbox" name="sendInvite" ${edit ? '' : 'checked'}> Išsiųsti prisijungimo duomenis laišku (reikia el. pašto ir slaptažodžio)</label>
        <label class="check"><input type="checkbox" name="active" ${!edit || u.active ? 'checked' : ''}> Paskyra aktyvi</label>
        ${me.classIds === null ? `<fieldset class="classpick"><legend>Priskirti komitetai</legend>
          <small class="muted">Taikoma, jei vartotojo rolė neturi leidimo „Matyti visus komitetus“.</small>
          ${admin.classes.length ? admin.classes.map((c) => `<label class="check"><input type="checkbox" name="cls" value="${c.id}" ${edit && (u.classIds || []).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') : '<small class="muted">Komitetų dar nėra.</small>'}
        </fieldset>` : ''}
        <div class="form-err" role="alert"></div>
        <div class="dlg-actions"><button type="button" class="btn" data-act="close-auth">Atšaukti</button><button type="submit" class="btn primary">Išsaugoti</button></div>
      </form></div>`;
    dlg.showModal();
    pwUpdate(dlg.querySelector('form'));
  }
  function openAccountDialog() {
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>Mano paskyra</h3><button type="button" class="icon-btn" data-act="close-auth" aria-label="Uždaryti">&times;</button></div>
      <form data-form="account">
        <div class="who" style="margin-bottom:14px;gap:14px">${avatar({ first: me.name, uid: me.id, photo: me.photo })}<div><b>Mano nuotrauka</b><small class="muted" style="display:block">Ją mato mokiniai, kuriems pažymite lankomumą</small>
          <button type="button" class="btn small" data-act="my-photo-pick" style="margin-top:6px">Pasirinkti</button>${me.photo ? ' <button type="button" class="btn small danger" data-act="my-photo-del" style="margin-top:6px">Pašalinti</button>' : ''}</div></div>
        <label>Vardas ir pavardė<input name="name" required value="${esc(me.name)}"></label>
        <label>Vartotojo vardas (prisijungimui)<input name="username" required autocapitalize="none" spellcheck="false" value="${esc(me.username)}"></label>
        <label>Dabartinis slaptažodis (jei keičiate)<input name="current" type="password" autocomplete="current-password"></label>
        <label>Naujas slaptažodis<input name="password" type="password" autocomplete="new-password"></label>
        ${pwHint()}
        <div class="form-err" role="alert"></div>
        <div class="dlg-actions"><button type="button" class="btn" data-act="close-auth">Atšaukti</button><button type="submit" class="btn primary">Išsaugoti</button></div>
      </form></div>`;
    dlg.showModal();
    pwUpdate(dlg.querySelector('form'));
  }

  /* ---------- rolių ir leidimų puslapis ---------- */
  function renderRoles() {
    if (!ensureAdmin()) return;
    const groups = PERMS.concat(admin.customPerms.length ? [{ g: 'Papildomi leidimai', items: admin.customPerms.map((p) => [p.key, p.label, true]) }] : []);
    const cols = admin.roles.length + 1;
    const th = admin.roles.map((r) => {
      const n = admin.users.filter((u) => u.roleId === r.id).length;
      return `<th class="num role-col"><div class="role-h"><b>${esc(r.name)}</b><small class="muted">vartotojų: ${n}</small>${r.system ? '<small class="muted">teisės užrakintos</small>' : ''}<span><button class="link-btn mini" data-act="rename-role" data-rid="${r.id}" title="Pervadinti">&#9998;</button>${r.system ? '' : `<button class="link-btn mini danger" data-act="delete-role" data-rid="${r.id}" title="Ištrinti">&times;</button>`}</span></div></th>`;
    }).join('');
    const body = groups.map((g) => `<tr class="grp"><td colspan="${cols}">${esc(g.g)}</td></tr>` + g.items.map(([k, l, custom]) =>
      `<tr><td>${esc(l)} <code>${esc(k)}</code>${custom ? ` <button class="link-btn mini danger" data-act="delete-perm" data-key="${esc(k)}" title="Pašalinti leidimą">&times;</button>` : ''}</td>` +
      admin.roles.map((r) => `<td class="num"><input type="checkbox" data-role="${r.id}" data-perm="${esc(k)}" aria-label="${esc(r.name)}: ${esc(l)}" ${r.system || r.perms.includes(k) ? 'checked' : ''} ${r.system ? 'disabled' : ''}></td>`).join('') + '</tr>').join('')).join('');
    app.innerHTML = head('Rolės ir leidimai', 'Pažymėkite, ką gali daryti kiekviena rolė',
      `<button class="btn" data-act="add-perm">${ICON.plus} Naujas leidimas</button><button class="btn primary" data-act="add-role">${ICON.plus} Nauja rolė</button>`) +
      `<div class="card"><div class="table-wrap"><table class="matrix"><thead><tr><th>Leidimas</th>${th}</tr></thead><tbody>${body}</tbody></table></div></div>
      <p class="muted" style="font-size:.85rem">Superadministratorius turi visus leidimus ir jo pakeisti negalima. Papildomi leidimai veikia, kai programos kode patikrinate <code>Auth.can('raktas')</code>.</p>`;
  }

  /* ---------- veiksmai ---------- */
  function act(a, el) {
    const uid2 = el && el.dataset.uid, rid = el && el.dataset.rid;
    switch (a) {
      case 'retry': location.reload(); break;
      case 'logout':
        api('/api/auth', { action: 'logout' }).catch(() => { /* ignore */ }).then(() => { me = null; admin = null; Sync.reset(); view = 'dashboard'; render(); });
        break;
      case 'my-account': openAccountDialog(); break;
      case 'my-photo-pick':
        photoFromFile().then(async (image) => {
          if (!image) return;
          me = (await api('/api/auth', { action: 'photo', image })).user; toast('Nuotrauka išsaugota'); openAccountDialog(); render();
        }).catch((e) => toast(e.message));
        break;
      case 'my-photo-del':
        api('/api/auth', { action: 'photo-delete' }).then((r) => { me = r.user; toast('Nuotrauka pašalinta'); openAccountDialog(); render(); }).catch((e) => toast(e.message));
        break;
      case 'close-auth': dlg.close(); break;
      case 'gen-pw': {
        const f = el.closest('form'), p = f && f.elements.password;
        if (p) { p.value = pwGenerate(); p.type = 'text'; pwUpdate(f); }
        break;
      }
      case 'copy-temp': navigator.clipboard && navigator.clipboard.writeText(el.dataset.pw).then(() => toast('Nukopijuota')).catch(() => {}); break;
      case 'force-pw': {
        const u = admin && admin.users.find((x) => x.id === uid2);
        if (u) UI.confirm(u.mustChange ? `Atšaukti reikalavimą pakeisti slaptažodį (${u.name})?` : `${u.name} privalės pakeisti slaptažodį. Jei šiuo metu prisijungęs – jam iškart bus parodytas keitimo ekranas. Tęsti?`).then((ok) => { if (ok) adminCall({ action: 'user-force-change', id: u.id, on: !u.mustChange }, u.mustChange ? 'Reikalavimas atšauktas' : 'Vartotojas privalės pakeisti slaptažodį'); });
        break;
      }
      case 'temp-pw': {
        const u = admin && admin.users.find((x) => x.id === uid2);
        if (u) UI.confirm(`Sugeneruoti naują laikiną slaptažodį vartotojui ${u.name}? Senasis nustos veikti. ${u.email ? 'Naujas bus išsiųstas į ' + u.email + '.' : 'Jis bus parodytas jums vieną kartą.'}`).then((ok) => { if (ok) adminCall({ action: 'user-temp-password', id: u.id }, 'Laikinas slaptažodis sukurtas'); });
        break;
      }
      case 'add-user': if (admin) openUserDialog(null); break;
      case 'edit-user': { const u = admin && admin.users.find((x) => x.id === uid2); if (u) openUserDialog(u); break; }
      case 'delete-user': {
        const u = admin && admin.users.find((x) => x.id === uid2);
        if (u) UI.confirm(`Ištrinti vartotoją ${u.name}?`).then((ok) => { if (ok) adminCall({ action: 'user-delete', id: u.id }, 'Vartotojas ištrintas'); });
        break;
      }
      case 'add-role': {
        UI.prompt('Nauja rolė', '', { label: 'Rolės pavadinimas', okText: 'Sukurti' }).then((name) => { if (name) adminCall({ action: 'role-add', name }); }); break;
      }
      case 'rename-role': {
        const r = admin && admin.roles.find((x) => x.id === rid);
        if (r) UI.prompt('Pervadinti rolę', r.name, { label: 'Naujas pavadinimas' }).then((name) => { if (name) adminCall({ action: 'role-rename', id: r.id, name }); }); break;
      }
      case 'delete-role': {
        const r = admin && admin.roles.find((x) => x.id === rid);
        if (r) UI.confirm(`Ištrinti rolę „${r.name}“?`).then((ok) => { if (ok) adminCall({ action: 'role-delete', id: r.id }); }); break;
      }
      case 'add-perm': {
        UI.prompt('Naujas leidimas', '', { label: 'Leidimo pavadinimas', placeholder: 'pvz. Siųsti pranešimus tėvams', okText: 'Pridėti' }).then((label) => { if (label) adminCall({ action: 'perm-add', label }, 'Leidimas pridėtas'); }); break;
      }
      case 'delete-perm':
        UI.confirm('Pašalinti šį leidimą iš visų rolių?').then((ok) => { if (ok) adminCall({ action: 'perm-delete', key: el.dataset.key }); }); break;
    }
  }

  /* ---------- formos ---------- */
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    const kind = f.dataset && f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const v = (n) => (f.elements[n] ? f.elements[n].value : '');
    const err = (m) => { const b = f.querySelector('.form-err'); if (b) b.textContent = m; };
    const btn = f.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try {
      if (kind === 'login') {
        const r = await api('/api/auth', { action: 'login', username: v('username'), password: v('password'), remember: f.elements.remember.checked });
        me = r.user; if (!me.mustChange) { await Sync.pull(); await Sync.migrateLegacy(); } render();
      } else if (kind === 'setup') {
        { const bad = pwIssues(v('password'), { username: v('username'), name: v('name') }); if (bad.length) return err('Slaptažodis per silpnas: ' + bad.join('; ') + '.'); }
        if (v('password') !== v('password2')) return err('Slaptažodžiai nesutampa.');
        const r = await api('/api/auth', { action: 'setup', name: v('name'), username: v('username'), password: v('password') });
        me = r.user; needsSetup = false; await Sync.pull(); await Sync.migrateLegacy(); render();
      } else if (kind === 'forcepw') {
        if (v('password') !== v('password2')) return err('Slaptažodžiai nesutampa.');
        { const bad = pwIssues(v('password'), { username: v('username'), name: v('name'), email: v('email') }); if (bad.length) return err('Slaptažodis per silpnas: ' + bad.join('; ') + '.'); }
        const r = await api('/api/auth', { action: 'change-password', current: v('current'), password: v('password') });
        me = r.user; await Sync.pull(); await Sync.migrateLegacy(); render(); toast('Slaptažodis pakeistas');
      } else if (kind === 'user') {
        { const pw = v('password'); if (pw) { const bad = pwIssues(pw, { username: v('username').toLowerCase(), name: v('name'), email: v('email') }); if (bad.length) return err('Slaptažodis per silpnas: ' + bad.join('; ') + '.'); } }
        admin = await api('/api/admin', { action: 'user-save', id: v('id'), name: v('name'), username: v('username'), email: v('email'), roleId: v('roleId'), password: v('password'), mustChange: f.elements.mustChange.checked, sendInvite: f.elements.sendInvite.checked && !!v('password'), active: f.elements.active.checked, active: f.elements.active.checked, classIds: f.querySelector('.classpick') ? [...f.querySelectorAll('input[name=cls]:checked')].map((x) => x.value) : undefined });
        await refreshMe(); dlg.close(); render(); toast(admin.invite ? (admin.invite.sent ? 'Vartotojas išsaugotas, laiškas išsiųstas: ' + admin.invite.sent : 'Vartotojas išsaugotas, bet laiško išsiųsti nepavyko: ' + admin.invite.error) : 'Vartotojas išsaugotas');
      } else if (kind === 'account') {
        { const pw = v('password'); if (pw) { const bad = pwIssues(pw, { username: v('username').toLowerCase(), name: v('name'), email: me.email }); if (bad.length) return err('Slaptažodis per silpnas: ' + bad.join('; ') + '.'); } }
        const r = await api('/api/auth', { action: 'account', name: v('name'), username: v('username'), current: v('current'), password: v('password') });
        me = r.user; dlg.close(); render(); toast('Paskyra atnaujinta');
      }
    } catch (ex) { err(ex.message); }
    finally { if (btn) btn.disabled = false; }
  });

  /* leidimų lentelės žymimieji langeliai */
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.perm || !t.dataset.role || !admin) return;
    const r = admin.roles.find((x) => x.id === t.dataset.role);
    if (!r || r.system) return;
    try {
      admin = await api('/api/admin', { action: 'role-perm', id: r.id, perm: t.dataset.perm, on: t.checked });
      if (me && me.roleId === r.id && (await refreshMe())) render();
    } catch (ex) {
      toast(ex.message);
      try { admin = await api('/api/admin'); } catch (e2) { /* ignore */ }
      render();
    }
  });

  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.addEventListener('input', (e) => { const f = e.target.form; if (f && f.dataset && f.dataset.form && f.querySelector('[data-pwrules]')) pwUpdate(f); });

  return { user, can, init, refreshMe, expire, invalidate, renderAuth, renderForceChange, forceChange, renderUsers, renderRoles, userChip, act };
})();