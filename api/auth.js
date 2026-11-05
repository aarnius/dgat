import { db, handler, HttpError, getUser, userById, publicUser, withPhoto, hashPw, checkPw, DUMMY_PW, sessionCookie, clearCookie, requireUser, newId, USERNAME_RE, str, logEvent, assertPassword } from '../lib/server.js';

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