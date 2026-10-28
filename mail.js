/* Laiško siuntimo langas. Naudoja api/send-email.js.
   Mailer.open([{ id, name, email, vars: { rodiklis, nedalyvavo, velavo, ireiles, komitetas } }]) */
const Mailer = (() => {
  const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
  const CHUNK = 15; /* kiek laiškų siunčiama per vieną užklausą (Vercel funkcijos laiko riba) */
  const last = { subject: 'Dėl lankomumo', message: '' };
  let dlg = null, rows = [], busy = false, finished = false;

  const myName = () => { try { return (Auth.user() || {}).name || ''; } catch (x) { return ''; } };
  const defaultBody = () => `Sveiki, {vardas},\n\npastebėjome, kad Jūsų lankomumas komitete „{komitetas}“ šiuo metu yra {rodiklis} (nedalyvavote {nedalyvavo} kartus). Prašome susisiekti su manimi ir aptarti, kuo galime padėti.\n\nPagarbiai,\n${myName()}`;
  const hasMail = (r) => EMAIL_RE.test(String(r.email || '').trim());
  const $ = (id) => dlg.querySelector('#' + id);
  const picks = () => [...dlg.querySelectorAll('input[data-i]:checked')].map((c) => rows[Number(c.dataset.i)]);

  function status(html, bad) { const s = $('mStatus'); s.innerHTML = html; s.style.color = bad ? 'var(--danger, #c0392b)' : ''; }
  function count() { const n = picks().length; $('mCount').textContent = n; $('mSend').textContent = finished ? 'Uždaryti' : (n ? `Siųsti: ${n}` : 'Siųsti'); $('mSend').disabled = busy || (!finished && !n); }
  function lock(v) { busy = v; dlg.querySelectorAll('input,textarea,button').forEach((x) => { if (x.dataset.m !== 'close') x.disabled = v; }); count(); }

  function open(list) {
    rows = list || [];
    if (!rows.length) { toast('Gavėjų sąrašas tuščias'); return; }
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'mailDialog'; document.body.appendChild(dlg); }
    busy = false; finished = false;
    const noMail = rows.filter((r) => !hasMail(r)).length;
    dlg.innerHTML = `<div class="dlg" style="width:min(640px,94vw)">
      <div class="dlg-head"><h3>Siųsti laišką</h3><button type="button" class="icon-btn" data-m="close" aria-label="Uždaryti">&times;</button></div>
      <p class="muted" style="margin-top:0">Gavėjų: <b id="mCount">0</b> iš ${rows.length}${noMail ? ` · be el. pašto: ${noMail}` : ''}. Kiekvienam išsiunčiamas atskiras laiškas, gavėjai vieni kitų nemato.</p>
      <div class="pick-list" style="max-height:170px;overflow:auto;margin-bottom:12px">${rows.map((r, i) => `<label class="check"><input type="checkbox" data-i="${i}" ${hasMail(r) ? 'checked' : 'disabled'}> ${e(r.name)} <small class="muted">${hasMail(r) ? e(r.email) : 'nėra el. pašto'}</small></label>`).join('')}</div>
      <label class="ui-lbl">Tema<input class="ui-input" id="mSubj" maxlength="150" value="${e(last.subject)}" autocomplete="off"></label>
      <label class="ui-lbl">Laiško tekstas<textarea id="mBody" rows="9" maxlength="5000" style="width:100%">${e(last.message || defaultBody())}</textarea></label>
      <p class="muted" style="font-size:.8rem;margin:4px 0 12px">Kiekvienam gavėjui automatiškai įrašoma: {vardas} {pavarde} {rodiklis} {nedalyvavo} {velavo} {ireiles} {komitetas}</p>
      <div class="tool-opts"><label>Bandomasis laiškas į<input id="mTest" type="email" placeholder="jūsų el. paštas" autocomplete="off"></label><button type="button" class="btn small" data-m="test">Išsiųsti bandomąjį</button></div>
      <div id="mStatus" class="muted" style="margin:8px 0;min-height:1.2em"></div>
      <div class="dlg-actions"><button type="button" class="btn" data-m="close">Atšaukti</button><button type="button" class="btn primary" id="mSend" data-m="send">Siųsti</button></div></div>`;
    dlg.onclick = (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-m]');
      if (ev.target === dlg) { if (!busy) dlg.close(); return; }
      if (!b) return;
      if (b.dataset.m === 'close') { if (!busy) dlg.close(); }
      else if (b.dataset.m === 'send') { if (finished) dlg.close(); else send(); }
      else if (b.dataset.m === 'test') test();
    };
    dlg.onchange = (ev) => { if (ev.target.dataset && ev.target.dataset.i !== undefined) count(); };
    dlg.oncancel = (ev) => { if (busy) ev.preventDefault(); };
    dlg.showModal();
    count();
  }

  function form() {
    const subject = $('mSubj').value.trim(), message = $('mBody').value.trim();
    last.subject = subject; last.message = message;
    return { subject, message };
  }
  const itemsOf = (list) => list.map((r) => ({ id: r.id, vars: r.vars || {} }));

  async function test() {
    const { subject, message } = form(), to = $('mTest').value.trim();
    const first = picks()[0] || rows.find(hasMail);
    if (!subject || !message) { status('Įrašykite temą ir tekstą.', true); return; }
    if (!EMAIL_RE.test(to)) { status('Įrašykite savo el. paštą bandomajam laiškui.', true); return; }
    if (!first) { status('Nėra nė vieno gavėjo su el. paštu.', true); return; }
    lock(true); status('Siunčiamas bandomasis laiškas…');
    try { await api('/api/send-email', { subject, message, items: itemsOf([first]), testTo: to }); status(`Bandomasis laiškas išsiųstas į ${e(to)} (pavyzdys: ${e(first.name)}).`); }
    catch (err) { status('Klaida: ' + e(err.message), true); }
    lock(false);
  }

  async function send() {
    const list = picks(), { subject, message } = form();
    if (!list.length) { status('Nepasirinkta gavėjų.', true); return; }
    if (!subject || !message) { status('Įrašykite temą ir tekstą.', true); return; }
    const ok = await UI.confirm(`Išsiųsti laišką ${list.length} gavėjams?\n\nTema: ${subject}\n\nŠio veiksmo atšaukti negalima.`, { title: 'Patvirtinkite siuntimą', okText: 'Siųsti' });
    if (!ok) return;
    lock(true);
    const sent = [], failed = [], skipped = [];
    let err = null;
    try {
      for (let i = 0; i < list.length; i += CHUNK) {
        status(`Siunčiama… ${sent.length + failed.length} iš ${list.length}`);
        const r = await api('/api/send-email', { subject, message, items: itemsOf(list.slice(i, i + CHUNK)) });
        sent.push(...r.sent); failed.push(...r.failed); skipped.push(...r.skipped);
      }
    } catch (x) { err = x; }
    finished = true; lock(false);
    const bad = failed.concat(skipped.map((s) => ({ name: s.name, error: s.reason })));
    status(`<b>Išsiųsta: ${sent.length}</b>${bad.length ? ` · nepavyko / praleista: ${bad.length}` : ''}${err ? `<br>Siuntimas nutrauktas: ${e(err.message)}. Likusiems laiškai neišsiųsti.` : ''}` +
      (bad.length ? `<br><small>${bad.slice(0, 15).map((b) => e(b.name) + ' – ' + e(b.error)).join('<br>')}${bad.length > 15 ? '<br>…' : ''}</small>` : ''), !!err || (!sent.length && !!bad.length));
    toast(`Išsiųsta laiškų: ${sent.length}${bad.length ? ` · nepavyko: ${bad.length}` : ''}`);
  }

  return { open };
})();
