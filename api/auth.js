import { db, handler, HttpError, getUser, userById, publicUser, hashPw, checkPw, DUMMY_PW, sessionCookie, clearCookie, requireUser, newId, USERNAME_RE, str } from '../lib/server.js';

export default handler(async (req, res, body) => {
  const sql = db();
  if (req.method === 'GET') {
    const user = await getUser(req);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM users`;
    return { user: publicUser(user), needsSetup: n === 0 };
  }

  switch (body.action) {
    case 'setup': {
      const name = str(body.name, 100), username = str(body.username, 40).toLowerCase(), pw = String(body.password || '');
      if (!name || !USERNAME_RE.test(username)) throw new HttpError(400, 'Įveskite vardą ir vartotojo vardą (bent 3 simboliai, be tarpų).');
      if (pw.length < 8) throw new HttpError(400, 'Slaptažodis per trumpas (bent 8 simboliai).');
      const id = newId('u');
      const hash = await hashPw(pw);
      const rows = await sql`INSERT INTO users (id, name, username, role_id, pw)
        SELECT ${id}, ${name}, ${username}, 'superadmin', ${hash} WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id`;
      if (!rows.length) throw new HttpError(403, 'Pradinė paskyra jau sukurta.');
      res.setHeader('Set-Cookie', sessionCookie(id, false));
      return { user: publicUser(await userById(id)) };
    }

    case 'login': {
      const username = str(body.username, 40).toLowerCase(), pw = String(body.password || '');
      const [lock] = await sql`SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - now()))))::int AS wait FROM login_attempts WHERE key = ${username}`;
      if (lock && lock.wait > 0) throw new HttpError(429, `Per daug bandymų. Palaukite ${lock.wait} s.`);
      const [u] = await sql`SELECT id, pw, active FROM users WHERE username = ${username}`;
      const ok = await checkPw(pw, u ? u.pw : DUMMY_PW);
      if (!u || !ok) {
        await sql`INSERT INTO login_attempts (key, count) VALUES (${username}, 1)
          ON CONFLICT (key) DO UPDATE SET count = login_attempts.count + 1,
          locked_until = CASE WHEN login_attempts.count + 1 >= 5 THEN now() + interval '60 seconds' ELSE login_attempts.locked_until END`;
        throw new HttpError(401, 'Neteisingas vartotojo vardas arba slaptažodis.');
      }
      if (!u.active) throw new HttpError(403, 'Ši paskyra išjungta.');
      await sql`DELETE FROM login_attempts WHERE key = ${username}`;
      const cookie = sessionCookie(u.id, !!body.remember);
      res.setHeader('Set-Cookie', cookie);
      return { user: publicUser(await userById(u.id)) };
    }

    case 'logout':
      res.setHeader('Set-Cookie', clearCookie());
      return { ok: true };

    case 'account': {
      const me = requireUser(await getUser(req));
      const name = str(body.name, 100), pw = String(body.password || '');
      const username = str(body.username, 40).toLowerCase() || me.username;
      if (!name) throw new HttpError(400, 'Įveskite vardą.');
      if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Vartotojo vardas: bent 3 simboliai, be tarpų.');
      const [dupe] = await sql`SELECT id FROM users WHERE username = ${username} AND id <> ${me.id}`;
      if (dupe) throw new HttpError(400, 'Toks vartotojo vardas jau naudojamas.');
      if (pw) {
        if (pw.length < 8) throw new HttpError(400, 'Naujas slaptažodis per trumpas (bent 8 simboliai).');
        const [u] = await sql`SELECT pw FROM users WHERE id = ${me.id}`;
        if (!(await checkPw(String(body.current || ''), u.pw))) throw new HttpError(400, 'Dabartinis slaptažodis neteisingas.');
        await sql`UPDATE users SET name = ${name}, username = ${username}, pw = ${await hashPw(pw)} WHERE id = ${me.id}`;
      } else {
        await sql`UPDATE users SET name = ${name}, username = ${username} WHERE id = ${me.id}`;
      }
      return { user: publicUser(await getUser(req)) };
    }

    default:
      throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});