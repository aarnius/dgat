import { db, handler, HttpError, getUser, userById, publicUser, withPhoto, hashPw, checkPw, DUMMY_PW, sessionCookie, clearCookie, requireUser, newId, USERNAME_RE, str, logEvent, assertPassword, makeToken, readToken } from '../lib/server.js';
import crypto from 'node:crypto';
import { rpOf, ALGS, verifyRegistration, verifyAssertion } from '../lib/webauthn.js';

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export default handler(async (req, res, body) => {
  const sql = db();
  if (req.method === 'GET') {
    const user = await getUser(req);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM users`;
    return { user: publicUser(await withPhoto(sql, user)), needsSetup: n === 0 };
  }

  switch (body.action) {
    case 'setup': {
      const name = str(body.name, 100), username = str(body.username, 40).toLowerCase(), pw = String(body.password || '');
      if (!name || !USERNAME_RE.test(username)) throw new HttpError(400, 'Įveskite vardą ir vartotojo vardą (bent 3 simboliai, be tarpų).');
      assertPassword(pw, { username, name });
      const id = newId('u');
      const hash = await hashPw(pw);
      const rows = await sql`INSERT INTO users (id, name, username, role_id, pw)
        SELECT ${id}, ${name}, ${username}, 'superadmin', ${hash} WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id`;
      if (!rows.length) throw new HttpError(403, 'Pradinė paskyra jau sukurta.');
      res.setHeader('Set-Cookie', sessionCookie(id, false));
      await logEvent(sql, { id, name }, 'auth', 'Sukurta pradinė superadministratoriaus paskyra');
      return { user: publicUser(await withPhoto(sql, await userById(id))) };
    }

    case 'login': {
      const username = str(body.username, 40).toLowerCase(), pw = String(body.password || '');
      const [lock] = await sql`SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - now()))))::int AS wait FROM login_attempts WHERE key = ${username}`;
      if (lock && lock.wait > 0) throw new HttpError(429, `Per daug bandymų. Palaukite ${lock.wait} s.`);
      const [u] = await sql`SELECT id, name, pw, active FROM users WHERE username = ${username}`;
      const ok = await checkPw(pw, u ? u.pw : DUMMY_PW);
      if (!u || !ok) {
        await sql`INSERT INTO login_attempts (key, count) VALUES (${username}, 1)
          ON CONFLICT (key) DO UPDATE SET count = login_attempts.count + 1,
          locked_until = CASE WHEN login_attempts.count + 1 >= 5 THEN now() + interval '60 seconds' ELSE login_attempts.locked_until END`;
        await logEvent(sql, u ? { id: u.id, name: u.name } : { name: username }, 'auth', `Nesėkmingas prisijungimas: ${username}`);
        throw new HttpError(401, 'Neteisingas vartotojo vardas arba slaptažodis.');
      }
      if (!u.active) { await logEvent(sql, { id: u.id, name: u.name }, 'auth', `Bandymas prisijungti prie išjungtos paskyros: ${username}`); throw new HttpError(403, 'Ši paskyra išjungta.'); }
      await sql`DELETE FROM login_attempts WHERE key = ${username}`;
      const cookie = sessionCookie(u.id, !!body.remember);
      res.setHeader('Set-Cookie', cookie);
      await logEvent(sql, { id: u.id, name: u.name }, 'auth', 'Prisijungė', [body.remember ? 'Likti prisijungus: taip' : 'Likti prisijungus: ne']);
      return { user: publicUser(await withPhoto(sql, await userById(u.id))) };
    }

    case 'logout': {
      const who = await getUser(req).catch(() => null);
      if (who) await logEvent(sql, who, 'auth', 'Atsijungė');
      res.setHeader('Set-Cookie', clearCookie());
      return { ok: true };
    }

    case 'set-skin': {
      const me = requireUser(await getUser(req));
      const skin = str(body.skin, 20);
      if (!['ink', 'classic', 'paper', 'soft', 'pro'].includes(skin)) throw new HttpError(400, 'Nežinomas stilius.');
      await sql`UPDATE users SET ui_skin = ${skin} WHERE id = ${me.id}`;
      return { ok: true, skin };
    }
    case 'account': {
      const me = requireUser(await getUser(req), true);
      const name = str(body.name, 100), pw = String(body.password || '');
      const username = str(body.username, 40).toLowerCase() || me.username;
      const email = body.email === undefined ? me.email : str(body.email, 120).toLowerCase();
      if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'Netinkamas el. pašto adresas.');
      if (!name) throw new HttpError(400, 'Įveskite vardą.');
      if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Vartotojo vardas: bent 3 simboliai, be tarpų.');
      const [dupe] = await sql`SELECT id FROM users WHERE username = ${username} AND id <> ${me.id}`;
      if (dupe) throw new HttpError(400, 'Toks vartotojo vardas jau naudojamas.');
      if (pw) {
        assertPassword(pw, { username, name, email: me.email });
        const [u] = await sql`SELECT pw FROM users WHERE id = ${me.id}`;
        if (!(await checkPw(String(body.current || ''), u.pw))) throw new HttpError(400, 'Dabartinis slaptažodis neteisingas.');
        if (await checkPw(pw, u.pw)) throw new HttpError(400, 'Naujas slaptažodis turi skirtis nuo dabartinio.');
        await sql`UPDATE users SET name = ${name}, username = ${username}, email = ${email}, pw = ${await hashPw(pw)}, must_change = false, pw_changed_at = now() WHERE id = ${me.id}`;
      } else {
        await sql`UPDATE users SET name = ${name}, username = ${username}, email = ${email} WHERE id = ${me.id}`;
      }
      await logEvent(sql, me, 'auth', 'Pakeisti savo paskyros duomenys', pw ? ['Pakeistas slaptažodis'] : []);
      return { user: publicUser(await withPhoto(sql, await getUser(req))) };
    }

    /* Priverstinis (arba savanoriškas) slaptažodžio pakeitimas: pirmas prisijungimas su laikinu slaptažodžiu. */
    case 'change-password': {
      const me = requireUser(await getUser(req), true);
      const pw = String(body.password || '');
      const email = str(body.email, 120).toLowerCase() || me.email;
      if (!EMAIL_RE.test(email || '')) throw new HttpError(400, 'Įveskite savo el. paštą (reikalingas prisijungimo duomenims ir slaptažodžio atkūrimui).');
      const [u] = await sql`SELECT pw FROM users WHERE id = ${me.id}`;
      if (!(await checkPw(String(body.current || ''), u.pw))) throw new HttpError(400, 'Dabartinis (laikinas) slaptažodis neteisingas.');
      assertPassword(pw, { username: me.username, name: me.name, email });
      if (await checkPw(pw, u.pw)) throw new HttpError(400, 'Naujas slaptažodis turi skirtis nuo laikinojo.');
      await sql`UPDATE users SET email = ${email}, pw = ${await hashPw(pw)}, must_change = false, pw_changed_at = now() WHERE id = ${me.id}`;
      await logEvent(sql, me, 'auth', 'Pakeistas slaptažodis', [me.mustChange ? 'Privalomas pakeitimas įvykdytas' : 'Savanoriškas pakeitimas']);
      return { user: publicUser(await withPhoto(sql, await getUser(req))) };
    }

    /* ---- Passkey (prisijungimas biometrija) ---- */
    case 'pk-reg-options': {
      const me = requireUser(await getUser(req));
      const rp = rpOf(req);
      const challenge = crypto.randomBytes(32).toString('base64url');
      const have = await sql`SELECT id FROM passkeys WHERE user_id = ${me.id}`;
      return {
        token: makeToken({ c: challenge, p: 'reg', u: me.id }, 5 * 60000),
        options: { challenge, rp: { id: rp.id, name: 'Lankomumo žurnalas' },
          user: { id: Buffer.from(me.id).toString('base64url'), name: me.username, displayName: me.name },
          pubKeyCredParams: ALGS.map((alg) => ({ type: 'public-key', alg })),
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          excludeCredentials: have.map((x) => ({ type: 'public-key', id: x.id })), timeout: 60000, attestation: 'none' },
      };
    }
    case 'pk-reg-verify': {
      const me = requireUser(await getUser(req));
      const t = readToken(body.token);
      if (!t || t.p !== 'reg' || t.u !== me.id) throw new HttpError(400, 'Užklausa nebegalioja. Bandykite iš naujo.');
      const r = verifyRegistration(req, body, t.c);
      const name = str(body.name, 60) || 'Mano įrenginys';
      await sql`INSERT INTO passkeys (id, user_id, pub, alg, counter, name) VALUES (${r.id}, ${me.id}, ${r.pub}, ${r.alg}, ${r.counter}, ${name})`;
      await logEvent(sql, me, 'auth', 'Pridėtas passkey', [name]);
      return { passkeys: await sql`SELECT id, name, created_at AS "createdAt", last_used AS "lastUsed" FROM passkeys WHERE user_id = ${me.id} ORDER BY created_at` };
    }
    case 'pk-list': {
      const me = requireUser(await getUser(req), true);
      return { passkeys: await sql`SELECT id, name, created_at AS "createdAt", last_used AS "lastUsed" FROM passkeys WHERE user_id = ${me.id} ORDER BY created_at` };
    }
    case 'pk-delete': {
      const me = requireUser(await getUser(req), true);
      await sql`DELETE FROM passkeys WHERE id = ${str(body.id, 1024)} AND user_id = ${me.id}`;
      await logEvent(sql, me, 'auth', 'Pašalintas passkey');
      return { passkeys: await sql`SELECT id, name, created_at AS "createdAt", last_used AS "lastUsed" FROM passkeys WHERE user_id = ${me.id} ORDER BY created_at` };
    }
    case 'pk-login-options': {
      const rp = rpOf(req);
      const challenge = crypto.randomBytes(32).toString('base64url');
      return { token: makeToken({ c: challenge, p: 'login' }, 5 * 60000),
        options: { challenge, rpId: rp.id, userVerification: 'required', timeout: 60000, allowCredentials: [] } };
    }
    case 'pk-login-verify': {
      const t = readToken(body.token);
      if (!t || t.p !== 'login') throw new HttpError(400, 'Užklausa nebegalioja. Bandykite iš naujo.');
      const [row] = await sql`SELECT k.id, k.user_id, k.pub, k.alg, k.counter, u.name, u.active FROM passkeys k JOIN users u ON u.id = k.user_id WHERE k.id = ${str(body.id, 1024)}`;
      if (!row) throw new HttpError(401, 'Šis passkey nežinomas. Prisijunkite slaptažodžiu ir pridėkite jį skiltyje „Mano paskyra“.');
      const counter = verifyAssertion(req, body, t.c, row);
      if (!row.active) { await logEvent(sql, { id: row.user_id, name: row.name }, 'auth', 'Bandymas prisijungti prie išjungtos paskyros (passkey)'); throw new HttpError(403, 'Ši paskyra išjungta.'); }
      await sql`UPDATE passkeys SET counter = ${counter}, last_used = now() WHERE id = ${row.id}`;
      res.setHeader('Set-Cookie', sessionCookie(row.user_id, !!body.remember));
      await logEvent(sql, { id: row.user_id, name: row.name }, 'auth', 'Prisijungė (passkey)');
      return { user: publicUser(await withPhoto(sql, await userById(row.user_id))) };
    }

    /* Savo profilio nuotrauka (matoma kitiems darbuotojams ir mokiniams, kuriems pažymėjote lankomumą). */
    case 'photo': {
      const me = requireUser(await getUser(req));
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
      if (!m || m[1].length > 120000 || Buffer.from(m[1].slice(0, 8), 'base64')[0] !== 0xff) throw new HttpError(400, 'Netinkama nuotrauka.');
      await sql`INSERT INTO user_photos (user_id, data, updated_at) VALUES (${me.id}, ${m[1]}, now())
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      return { user: publicUser(await withPhoto(sql, await getUser(req))) };
    }
    case 'photo-delete': {
      const me = requireUser(await getUser(req));
      await sql`DELETE FROM user_photos WHERE user_id = ${me.id}`;
      return { user: publicUser(await withPhoto(sql, await getUser(req))) };
    }

    default:
      throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});