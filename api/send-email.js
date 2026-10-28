/* Laiškų siuntimas mokiniams (pvz. iš rizikos sąrašo). Siunčia kiekvienam atskirą laišką per SMTP (nodemailer).
   Aplinkos kintamieji (Vercel → Settings → Environment Variables):
     SMTP_USER   – siuntėjo paštas (pvz. vardas@dgg.lt)            [privaloma]
     SMTP_PASS   – paštas „App password“ (Gmail) arba SMTP slaptažodis [privaloma]
     SMTP_HOST   – numatyta smtp.gmail.com
     SMTP_PORT   – numatyta 465
     MAIL_FROM   – pvz. DGG Mokinių taryba <vardas@dgg.lt> (numatyta SMTP_USER)
     MAIL_REPLY_TO – kur nukreipti atsakymus (nebūtina)
   Gavėjų adresai imami iš duomenų bazės pagal mokinio id (kliento siunčiami adresai nenaudojami),
   o vartotojas be prieigos prie mokinio komiteto jam siųsti negali. */
import nodemailer from 'nodemailer';
import { db, handler, getUser, requirePerm, HttpError, str, logEvent } from '../lib/server.js';

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_BATCH = 25; /* vienoje užklausoje (klientas siunčia dalimis, kad neviršytų Vercel laiko ribos) */
const VAR_KEYS = ['rodiklis', 'nedalyvavo', 'velavo', 'ireiles', 'komitetas'];

let _tx = null;
function transport() {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new HttpError(500, 'Laiškų siuntimas nesukonfigūruotas: Vercel aplinkoje trūksta SMTP_USER ir SMTP_PASS.');
  const port = Number(process.env.SMTP_PORT) || 465;
  return (_tx ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user, pass }, pool: true, maxConnections: 3,
  }));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
const cleanVars = (v) => {
  const out = {};
  if (v && typeof v === 'object') VAR_KEYS.forEach((k) => { if (v[k] != null) out[k] = str(v[k], 60); });
  return out;
};
const htmlOf = (text) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">${esc(text).replace(/\r?\n/g, '<br>')}</div>`;

async function sendOne(tx, to, subject, text) {
  await tx.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER, replyTo: process.env.MAIL_REPLY_TO || undefined,
    to, subject, text, html: htmlOf(text),
  });
}

export default handler(async (req, res, body) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Metodas neleidžiamas.');
  const sql = db();
  const me = await getUser(req);
  requirePerm(me, 'tools.save');

  const subject = str(body.subject, 150);
  const message = String(body.message || '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  if (!subject || !message) throw new HttpError(400, 'Įrašykite laiško temą ir tekstą.');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new HttpError(400, 'Nepasirinkta gavėjų.');
  if (items.length > MAX_BATCH) throw new HttpError(400, `Vienu metu galima siųsti ne daugiau kaip ${MAX_BATCH} laiškų.`);
  const varsById = new Map();
  items.forEach((it) => { const id = String((it && it.id) || ''); if (ID_RE.test(id)) varsById.set(id, cleanVars(it.vars)); });
  const ids = [...varsById.keys()];
  if (!ids.length) throw new HttpError(400, 'Netinkami gavėjai.');

  /* Mokiniai imami iš DB ir tik iš tų komitetų, prie kurių vartotojas turi prieigą (classIds = null – visi). */
  const scope = me.classIds;
  const rows = await sql`SELECT s.id, s.first_name AS first, s.last_name AS last, s.email FROM students s
    WHERE s.id = ANY(${ids}::text[]) AND (${scope}::text[] IS NULL OR EXISTS
      (SELECT 1 FROM student_classes sc WHERE sc.student_id = s.id AND sc.class_id = ANY(${scope}::text[])))`;
  const personal = (s) => fill(message, { vardas: s.first, pavarde: s.last, ...varsById.get(s.id) });
  const subj = (s) => fill(subject, { vardas: s.first, pavarde: s.last, ...varsById.get(s.id) });
  const tx = transport();

  /* Bandomasis laiškas: pirmo gavėjo duomenimis, bet į nurodytą adresą. */
  const testTo = str(body.testTo, 200);
  if (testTo) {
    if (!EMAIL_RE.test(testTo)) throw new HttpError(400, 'Netinkamas bandomojo laiško adresas.');
    const s = rows[0] || { id: '', first: 'Vardas', last: 'Pavardė' };
    try { await sendOne(tx, testTo, '[BANDOMASIS] ' + subj(s), personal(s)); } catch (e) { console.error('mail test', e); throw new HttpError(502, 'Nepavyko išsiųsti: ' + (e.response || e.message || 'SMTP klaida').toString().slice(0, 200)); }
    return { ok: true, test: true };
  }

  const sent = [], failed = [], skipped = [];
  const queue = [];
  const found = new Set(rows.map((r) => r.id));
  ids.forEach((id) => { if (!found.has(id)) skipped.push({ id, name: '?', reason: 'mokinys nerastas arba nėra prieigos' }); });
  rows.forEach((s) => {
    const name = [s.first, s.last].filter(Boolean).join(' ') || '?';
    if (!EMAIL_RE.test((s.email || '').trim())) skipped.push({ id: s.id, name, reason: 'nėra el. pašto' });
    else queue.push({ s, name, to: s.email.trim() });
  });
  for (let i = 0; i < queue.length; i += 3) {
    await Promise.all(queue.slice(i, i + 3).map(async ({ s, name, to }) => {
      try { await sendOne(tx, to, subj(s), personal(s)); sent.push({ id: s.id, name }); }
      catch (e) { console.error('mail', to, e.message); failed.push({ id: s.id, name, error: String(e.response || e.message || 'SMTP klaida').slice(0, 160) }); }
    }));
  }
  if (sent.length || failed.length) {
    await logEvent(sql, me, 'email', `Išsiųsta laiškų: ${sent.length}${failed.length ? `, nepavyko: ${failed.length}` : ''} · tema „${subject}“`,
      [...sent.map((x) => 'Išsiųsta: ' + x.name), ...failed.map((x) => `Nepavyko: ${x.name} (${x.error})`)]);
  }
  return { ok: true, sent, failed, skipped };
});
