/* Prisijungimas, vartotojai, rolės ir leidimai (kalbasi su serveriu per /api/*).
   Interfeisas tik slepia mygtukus – tikrasis leidimų tikrinimas vyksta serveryje. */
const PERMS = [
  { g: 'Apžvalga', items: [['dashboard.view', 'Matyti apžvalgą'], ['calendar.all', 'Matyti bendrą visų komitetų kalendorių apžvalgoje']] },
  { g: 'Lankomumas', items: [['attendance.view', 'Matyti lankomumą'], ['attendance.mark', 'Žymėti lankomumą'], ['attendance.free', 'Žymėti dienos lankomumą be veiklos (kitaip – tik dienomis, kai komitetas turi veiklą)']] },
  { g: 'Veiklos', items: [['activities.view', 'Matyti veiklas'], ['activities.create', 'Kurti veiklas (tik matomiems komitetams)'], ['activities.edit', 'Redaguoti veiklas ir jų užsiėmimus (datas)'], ['activities.delete', 'Ištrinti veiklas'], ['activities.mark', 'Žymėti lankomumą veiklų užsiėmimuose'], ['activities.report', 'Veiklų ataskaitos, eksportas ir spausdinimas']] },
  { g: 'Mokiniai', items: [['students.view', 'Matyti mokinius'], ['students.edit', 'Pridėti ir redaguoti mokinius'], ['students.delete', 'Ištrinti mokinius'], ['students.import', 'Importuoti mokinius']] },
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
    throw err;
  }
  return j;
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
      if (me) { await Sync.pull(); await Sync.migrateLegacy(); }
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
      </form><p class="muted" style="font-size:.75rem;text-align:center;margin:14px 0 0">v. ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}</p></div></div>`;
    loginMsg = '';
    const f = app.querySelector('input'); if (f) f.focus();
  }

  /* ---------- šoninė juosta: vartotojas ---------- */
  function userChip() {
    if (!me) return '';
    const out = svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>');
    const pen = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 15);
    return `<div class="userchip"><button class="userchip-btn" data-act="my-account" title="Keisti vardą ir slaptažodį">${avatar({ first: me.name })}<span class="hide-sm"><b>${esc(me.name)}</b><small class="muted">${esc(me.roleName || '')}</small></span><span class="chip-edit" aria-hidden="true">${pen}</span></button>
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
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(e.message);
      try { admin = await api('/api/admin'); } catch (e2) { /* ignore */ }
    }
    render();
  }

  /* ---------- vartotojų puslapis ---------- */
  function renderUsers() {
    if (!ensureAdmin()) return;
    const rows = admin.users.map((u) => {
      const off = !u.active;
      return `<tr><td><div class="who">${avatar({ first: u.name })}<div><b>${esc(u.name)}</b><small>${esc(u.username)}</small></div></div></td>
        <td>${esc(roleName(u.roleId))}</td>
        <td class="hide-sm"><span class="rate ${off ? 'low' : 'good'}">${off ? 'Išjungtas' : 'Aktyvus'}</span></td>
        <td class="row-actions"><button class="btn small" data-act="edit-user" data-uid="${u.id}">Redaguoti</button> <button class="btn small danger" data-act="delete-user" data-uid="${u.id}">Ištrinti</button></td></tr>`;
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
        <label>${edit ? 'Naujas slaptažodis (palikite tuščią, jei nekeičiate)' : 'Slaptažodis (bent 8 simboliai)'}<input name="password" type="password" autocomplete="new-password" ${edit ? '' : 'required minlength="8"'}></label>
        <label class="check"><input type="checkbox" name="active" ${!edit || u.active ? 'checked' : ''}> Paskyra aktyvi</label>
        ${me.classIds === null ? `<fieldset class="classpick"><legend>Priskirti komitetai</legend>
          <small class="muted">Taikoma, jei vartotojo rolė neturi leidimo „Matyti visus komitetus“.</small>
          ${admin.classes.length ? admin.classes.map((c) => `<label class="check"><input type="checkbox" name="cls" value="${c.id}" ${edit && (u.classIds || []).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') : '<small class="muted">Komitetų dar nėra.</small>'}
        </fieldset>` : ''}
        <div class="form-err" role="alert"></div>
        <div class="dlg-actions"><button type="button" class="btn" data-act="close-auth">Atšaukti</button><button type="submit" class="btn primary">Išsaugoti</button></div>
      </form></div>`;
    dlg.showModal();
  }
  function openAccountDialog() {
    dlg.innerHTML = `<div class="dlg"><div class="dlg-head"><h3>Mano paskyra</h3><button type="button" class="icon-btn" data-act="close-auth" aria-label="Uždaryti">&times;</button></div>
      <form data-form="account">
        <label>Vardas ir pavardė<input name="name" required value="${esc(me.name)}"></label>
        <label>Vartotojo vardas (prisijungimui)<input name="username" required autocapitalize="none" spellcheck="false" value="${esc(me.username)}"></label>
        <label>Dabartinis slaptažodis (jei keičiate)<input name="current" type="password" autocomplete="current-password"></label>
        <label>Naujas slaptažodis (bent 8 simboliai)<input name="password" type="password" autocomplete="new-password"></label>
        <div class="form-err" role="alert"></div>
        <div class="dlg-actions"><button type="button" class="btn" data-act="close-auth">Atšaukti</button><button type="submit" class="btn primary">Išsaugoti</button></div>
      </form></div>`;
    dlg.showModal();
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
      case 'close-auth': dlg.close(); break;
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
        me = r.user; await Sync.pull(); await Sync.migrateLegacy(); render();
      } else if (kind === 'setup') {
        if (v('password').length < 8) return err('Slaptažodis per trumpas (bent 8 simboliai).');
        if (v('password') !== v('password2')) return err('Slaptažodžiai nesutampa.');
        const r = await api('/api/auth', { action: 'setup', name: v('name'), username: v('username'), password: v('password') });
        me = r.user; needsSetup = false; await Sync.pull(); await Sync.migrateLegacy(); render();
      } else if (kind === 'user') {
        admin = await api('/api/admin', { action: 'user-save', id: v('id'), name: v('name'), username: v('username'), roleId: v('roleId'), password: v('password'), active: f.elements.active.checked, classIds: f.querySelector('.classpick') ? [...f.querySelectorAll('input[name=cls]:checked')].map((x) => x.value) : undefined });
        await refreshMe(); dlg.close(); render(); toast('Vartotojas išsaugotas');
      } else if (kind === 'account') {
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

  return { user, can, init, refreshMe, expire, invalidate, renderAuth, renderUsers, renderRoles, userChip, act };
})();