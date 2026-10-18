/* Bendri sąsajos įrankiai: langai programos viduje (vietoj naršyklės confirm / prompt / alert) ir greita paieška sąrašuose. */
const UI = (() => {
  const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dlg = document.createElement('dialog');
  dlg.id = 'uiDialog';
  document.body.appendChild(dlg);
  let cur = null;

  /* o: title, message, input (true = teksto laukas), value, label, placeholder, okText, cancelText, danger, alert, required */
  function ask(o) {
    if (cur) cur.finish(null);
    return new Promise((resolve) => {
      let done = false;
      const empty = o.input ? null : false;
      const finish = (v) => { if (done) return; done = true; cur = null; if (dlg.open) dlg.close(); resolve(v); };
      cur = { finish };
      const msg = e(o.message || '').replace(/\n/g, '<br>');
      dlg.innerHTML = `<form class="dlg ui-card" novalidate>
        ${o.title ? `<h3>${e(o.title)}</h3>` : ''}
        ${msg ? `<p class="ui-msg">${msg}</p>` : ''}
        ${o.input ? `<label class="ui-lbl">${e(o.label || '')}<input class="ui-input" maxlength="${o.max || 200}" placeholder="${e(o.placeholder || '')}" value="${e(o.value || '')}" autocomplete="off"></label>` : ''}
        <div class="dlg-actions">${o.alert ? '' : `<button type="button" class="btn" data-ui="cancel">${e(o.cancelText || 'Atšaukti')}</button>`}<button type="submit" class="btn ${o.danger ? 'danger' : 'primary'}" data-ui="ok">${e(o.okText || 'Gerai')}</button></div></form>`;
      const form = dlg.firstElementChild, input = form.querySelector('.ui-input');
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (o.input) { const v = input.value.trim(); if (o.required !== false && !v) { input.focus(); return; } finish(v); } else finish(true);
      });
      const cancel = form.querySelector('[data-ui=cancel]');
      if (cancel) cancel.addEventListener('click', () => finish(empty));
      dlg.oncancel = (ev) => { ev.preventDefault(); finish(o.alert ? true : empty); };
      dlg.onclick = (ev) => { if (ev.target === dlg && !o.alert) finish(empty); };
      dlg.showModal();
      if (input) { input.focus(); input.select(); } else form.querySelector('[data-ui=ok]').focus();
    });
  }
  /* Mygtuko tekstas ir raudona spalva parenkami pagal pirmą žodį (Ištrinti, Išvalyti, Pašalinti...). */
  const confirm = (message, o) => {
    const m = /^(Ištrinti|Išvalyti|Pašalinti|Pakeisti|Atšaukti|Sujungti|Tikrai)/.exec(String(message));
    const danger = !!m && m[1] !== 'Atšaukti';
    return ask(Object.assign({ message, title: 'Patvirtinkite', okText: m && m[1] !== 'Tikrai' ? m[1] : 'Taip', danger }, o));
  };
  const prompt = (title, value, o) => ask(Object.assign({ title, input: true, value: value || '', okText: 'Išsaugoti' }, o));
  const alert = (message, title) => ask({ message, title: title || 'Dėmesio', alert: true });

  /* ---------- greita paieška sąrašuose (be perpiešimo) ---------- */
  const FILTERS = {};
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function applyFilter(input) {
    const scope = document.querySelector(input.dataset.scope);
    if (!scope) return;
    const q = norm(input.value.trim());
    const rows = scope.querySelectorAll(input.dataset.rows || 'tbody tr');
    let shown = 0;
    rows.forEach((r) => { const hit = !q || norm(r.textContent).includes(q); r.hidden = !hit; if (hit) shown++; });
    const cnt = input.parentElement && input.parentElement.querySelector('.fcount');
    if (cnt) cnt.textContent = q ? `Rodoma ${shown} iš ${rows.length}` : '';
  }
  /* HTML paieškos laukui: fk – raktas, kad reikšmė išliktų perpiešus puslapį (be rakto – neišlieka). */
  const filterBox = (o) => `<div class="fbox no-print"><input type="search" class="search rowfilter" ${o.fk ? `data-fk="${e(o.fk)}"` : ''} data-scope="${e(o.scope)}"${o.rows ? ` data-rows="${e(o.rows)}"` : ''} placeholder="${e(o.placeholder || 'Ieškoti mokinio…')}" aria-label="Paieška" autocomplete="off"><span class="fcount muted"></span></div>`;
  function restoreFilters() {
    document.querySelectorAll('input.rowfilter[data-fk]').forEach((i) => { const v = FILTERS[i.dataset.fk]; if (v) { i.value = v; applyFilter(i); } });
  }
  const clearFilters = () => { Object.keys(FILTERS).forEach((k) => delete FILTERS[k]); };
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('rowfilter')) ev.preventDefault(); });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t.classList || !t.classList.contains('rowfilter')) return;
    if (t.dataset.fk) FILTERS[t.dataset.fk] = t.value;
    applyFilter(t);
  });

  return { ask, confirm, prompt, alert, filterBox, restoreFilters, clearFilters, norm };
})();
