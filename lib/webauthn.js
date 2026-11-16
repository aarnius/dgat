/* Minimalus WebAuthn (passkey) patikrinimas be išorinių bibliotekų.
   Naršyklė siunčia viešąjį raktą SPKI formatu (getPublicKey), todėl CBOR dekoduoti nereikia.
   Palaikomi ES256 (-7) ir RS256 (-257). */
import crypto from 'node:crypto';
import { HttpError } from './server.js';

export const ALGS = [-7, -257];
const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

/* Kuris adresas laikomas svetaine: ta pati kilmė, iš kurios atėjo užklausa. */
export function rpOf(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return { id: host.replace(/:\d+$/, ''), origin: `https://${host}`, host };
}

function checkCommon(req, clientDataB64, authDataB64, type, challenge) {
  const rp = rpOf(req);
  let cd;
  try { cd = JSON.parse(fromB64u(clientDataB64).toString('utf8')); } catch { throw new HttpError(400, 'Netinkami passkey duomenys.'); }
  if (cd.type !== type || cd.challenge !== challenge) throw new HttpError(400, 'Passkey patikra nepavyko (iššūkis nesutampa). Bandykite iš naujo.');
  if (cd.origin !== rp.origin) throw new HttpError(400, 'Passkey patikra nepavyko (kitas adresas).');
  const ad = fromB64u(authDataB64);
  if (ad.length < 37) throw new HttpError(400, 'Netinkami passkey duomenys.');
  if (!ad.subarray(0, 32).equals(crypto.createHash('sha256').update(rp.id).digest())) throw new HttpError(400, 'Passkey patikra nepavyko (svetainė nesutampa).');
  const flags = ad[32];
  if (!(flags & 0x01)) throw new HttpError(400, 'Reikalingas naudotojo buvimo patvirtinimas.');
  if (!(flags & 0x04)) throw new HttpError(400, 'Reikalingas biometrinis arba PIN patvirtinimas.');
  return { ad, counter: ad.readUInt32BE(33) };
}

/* Registracija: grąžina { id, pub, alg, counter }. */
export function verifyRegistration(req, b, challenge) {
  const { counter } = checkCommon(req, b.clientDataJSON, b.authenticatorData, 'webauthn.create', challenge);
  const alg = Number(b.alg);
  if (!ALGS.includes(alg)) throw new HttpError(400, 'Šis passkey algoritmas nepalaikomas.');
  const pub = fromB64u(b.publicKey);
  try { crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' }); } catch { throw new HttpError(400, 'Netinkamas viešasis raktas.'); }
  const id = String(b.id || '');
  if (!/^[A-Za-z0-9_-]{16,1024}$/.test(id)) throw new HttpError(400, 'Netinkamas passkey ID.');
  return { id, pub: b64u(pub), alg, counter };
}

/* Prisijungimas: tikrina parašą ir skaitiklį, grąžina naują skaitiklį. */
export function verifyAssertion(req, b, challenge, row) {
  const { ad, counter } = checkCommon(req, b.clientDataJSON, b.authenticatorData, 'webauthn.get', challenge);
  const hash = crypto.createHash('sha256').update(fromB64u(b.clientDataJSON)).digest();
  const key = crypto.createPublicKey({ key: fromB64u(row.pub), format: 'der', type: 'spki' });
  const ok = crypto.verify(row.alg === -7 ? 'sha256' : 'sha256', Buffer.concat([ad, hash]), key, fromB64u(b.signature));
  if (!ok) throw new HttpError(401, 'Passkey parašas neteisingas.');
  const prev = Number(row.counter) || 0;
  if ((counter || prev) && counter <= prev) throw new HttpError(401, 'Passkey atmestas (galimai nukopijuotas).');
  return counter;
}
