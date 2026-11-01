/* Paprastas laiškų siuntimas per SMTP (tie patys Vercel aplinkos kintamieji kaip api/send-email.js):
   SMTP_USER, SMTP_PASS, nebūtina: SMTP_HOST, SMTP_PORT, MAIL_FROM, MAIL_REPLY_TO. */
import nodemailer from 'nodemailer';
import { HttpError } from './server.js';

let _tx = null;
export function transport() {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new HttpError(500, 'Laiškų siuntimas nesukonfigūruotas: Vercel aplinkoje trūksta SMTP_USER ir SMTP_PASS.');
  const port = Number(process.env.SMTP_PORT) || 465;
  return (_tx ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user, pass }, pool: true, maxConnections: 3,
  }));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const htmlOf = (text) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">${esc(text).replace(/\r?\n/g, '<br>')}</div>`;

export async function sendMail(tx, to, subject, text) {
  await tx.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER, replyTo: process.env.MAIL_REPLY_TO || undefined,
    to, subject, text, html: htmlOf(text),
  });
}
