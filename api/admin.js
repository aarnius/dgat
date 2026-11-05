import { db, handler, HttpError, getUser, can, requireUser, requirePerm, hashPw, newId, USERNAME_RE, str, BUILTIN_PERMS, logEvent, assertPassword, genPassword } from '../lib/server.js';
import { transport, sendMail } from '../lib/mail.js';

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/* Prisijungimo duomenų laiškas naujam / atnaujintam vartotojui. */
async function mailCredentials(req, to, name, username, password, why) {
  const base = process.env.PUBLIC_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const text = `Sveiki, ${name},\n\n${why}\n\nPrisijungimo adresas: ${base.replace(/\/$/, '')}/zurnalas\nVartotojo vardas: ${username}\nLaikinas slaptažodis: ${password}\n\nPrisijungę būsite paprašyti iškart susikurti savo slaptažodį (bent 12 simbolių). Laikinas slaptažodis veiks tik šiam pirmam prisijungimui. Niekam jo neperduokite.\n\nJei šio laiško nelaukėte, jo nepaisykite.`;
  await sendMail(transport(), to, 'Jūsų prisijungimo duomenys', text);
}

async function snapshot(sql) {
  const [users, roles, customPerms, classes] = await Promise.all([
    sql`SELECT u.id, u.name, u.username, u.email, u.must_change AS "mustChange", u.role_id AS "roleId", u.active, u.class_ids AS "classIds", COALESCE(extract(epoch FROM p.updated_at)::bigint, 0) AS photo
      FROM users u LEFT JOIN user_photos p ON p.user_id = u.id ORDER BY u.name`,
    sql`SELECT id, name, system, perms FROM roles ORDER BY system DESC, name`,
    sql`SELECT key, label FROM custom_perms ORDER BY label`,
    sql`SELECT id, name FROM classes ORDER BY name`,
  ]);
  return { users, roles, customPerms, classes };
}
const superCount = async (sql, exceptId) => (await sql`SELECT count(*)::int AS n FROM users WHERE role_id = 'superadmin' AND active AND id <> ${exceptId || ''}`)[0].n;

export default handler(async (req, res, body) => {
  const sql = db();
  const me = requireUser(await getUser(req));
  if (req.method === 'GET') {
    requirePerm(me, 'users.manage', 'roles.manage');
    return snapshot(sql);
  }
  const isSuper = me.roleId === 'superadmin';

  switch (body.action) {
    case 'user-save': {
      requirePerm(me, 'users.manage');
      const id = str(body.id, 40), name = str(body.name, 100), username = str(body.username, 40).toLowerCase();
      const roleId = str(body.roleId, 40), pw = String(body.password || ''), active = body.active !== false;
      if (!name || !USERNAME_RE.test(username)) throw new HttpError(400, 'Įveskite vardą ir vartotojo vardą (bent 3 simboliai, be tarpų).');
      const [role] = await sql`SELECT id, name FROM roles WHERE id = ${roleId}`;
      if (!role) throw new HttpError(400, 'Pasirinkite rolę.');
      const email = str(body.email, 120).toLowerCase();
      if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'Netinkamas el. pašto adresas.');
      if (!id && !pw) throw new HttpError(400, 'Įveskite arba sugeneruokite slaptažodį.');
      if (pw) assertPassword(pw, { username, name, email });
      const sendInvite = body.sendInvite === true;
      if (sendInvite && (!email || !pw)) throw new HttpError(400, 'Laiškui išsiųsti reikia el. pašto ir slaptažodžio.');
      /* Naujam vartotojui ir kai administratorius nustato kitam slaptažodį – pagal nutylėjimą privaloma jį pakeisti. */
      const mustChange = pw ? body.mustChange !== false : null;
      const [dupe] = await sql`SELECT id FROM users WHERE username = ${username} AND id <> ${id}`;
      if (dupe) throw new HttpError(400, 'Toks vartotojo vardas jau naudojamas.');
      let existing = null;
      if (id) {
        [existing] = await sql`SELECT id, role_id FROM users WHERE id = ${id}`;
        if (!existing) throw new HttpError(404, 'Vartotojas nerastas.');
      }
      if ((roleId === 'superadmin' || (existing && existing.role_id === 'superadmin')) && !isSuper) throw new HttpError(403, 'Tik superadministratorius gali valdyti superadministratorius.');
      if (existing && existing.role_id === 'superadmin' && (roleId !== 'superadmin' || !active) && (await superCount(sql, id)) === 0) throw new HttpError(400, 'Negalite pašalinti paskutinio aktyvaus superadministratoriaus.');
      if (existing && id === me.id && !active) throw new HttpError(400, 'Negalite išjungti savo paskyros.');
      /* Klasių priskyrimą keisti gali tik tas, kuris pats mato visas klases. */
      let classIds = null;
      if (me.classIds === null && Array.isArray(body.classIds)) {
        const want = body.classIds.map((x) => str(x, 40)).filter(Boolean);
        classIds = (await sql`SELECT id FROM classes WHERE id = ANY(${want}::text[])`).map((x) => x.id);
      }
      const info = [`Rolė: ${role.name}`, active ? 'Paskyra aktyvi' : 'Paskyra išjungta'];
      if (pw) info.push('Nustatytas naujas slaptažodis', mustChange ? 'Privalo pakeisti slaptažodį' : 'Slaptažodžio keisti neprivaloma');
      if (sendInvite) info.push('Išsiųsti prisijungimo duomenys: ' + email);
      await logEvent(sql, me, 'admin', `Vartotojas „${name}“ (${username}) ${existing ? 'atnaujintas' : 'sukurtas'}`, info);
      if (existing) {
        await sql`UPDATE users SET name=${name}, username=${username}, email=${email}, role_id=${roleId}, active=${active} WHERE id=${id}`;
        if (pw) await sql`UPDATE users SET pw=${await hashPw(pw)}, must_change=${mustChange}, pw_changed_at=NULL WHERE id=${id}`;
        if (classIds) await sql`UPDATE users SET class_ids=${JSON.stringify(classIds)}::jsonb WHERE id=${id}`;
      } else {
        await sql`INSERT INTO users (id, name, username, email, role_id, active, pw, must_change, class_ids) VALUES (${newId('u')}, ${name}, ${username}, ${email}, ${roleId}, ${active}, ${await hashPw(pw)}, ${mustChange}, ${JSON.stringify(classIds || [])}::jsonb)`;
      }
      const snap = await snapshot(sql);
      if (sendInvite) {
        try { await mailCredentials(req, email, name, username, pw, existing ? 'Jums nustatytas naujas slaptažodis.' : 'Jums sukurta paskyra Dariaus Girėno gimnazijos mokinių tarybos lankomumo sistemoje.'); snap.invite = { sent: email }; }
        catch (e) { console.error('invite mail', e.message); snap.invite = { error: e.message || 'Nepavyko išsiųsti laiško.' }; }
      }
      return snap;
    }

    /* Priversti vartotoją pakeisti slaptažodį kitą kartą prisijungus (arba atšaukti). */
    case 'user-force-change': {
      requirePerm(me, 'users.manage');
      const id = str(body.id, 40), on = body.on !== false;
      const [u] = await sql`SELECT id, name, username, role_id FROM users WHERE id = ${id}`;
      if (!u) throw new HttpError(404, 'Vartotojas nerastas.');
      if (u.role_id === 'superadmin' && !isSuper) throw new HttpError(403, 'Tik superadministratorius gali valdyti superadministratorius.');
      await sql`UPDATE users SET must_change = ${on} WHERE id = ${id}`;
      await logEvent(sql, me, 'admin', `${on ? 'Reikalaujama pakeisti' : 'Nebereikalaujama keisti'} slaptažodį: „${u.name}“ (${u.username})`);
      return snapshot(sql);
    }

    /* Sugeneruoti naują laikiną slaptažodį: išsiunčiamas laišku (jei yra el. paštas) arba parodomas administratoriui vieną kartą. */
    case 'user-temp-password': {
      requirePerm(me, 'users.manage');
      const id = str(body.id, 40);
      const [u] = await sql`SELECT id, name, username, email, role_id FROM users WHERE id = ${id}`;
      if (!u) throw new HttpError(404, 'Vartotojas nerastas.');
      if (u.role_id === 'superadmin' && !isSuper) throw new HttpError(403, 'Tik superadministratorius gali valdyti superadministratorius.');
      if (id === me.id) throw new HttpError(400, 'Savo slaptažodį keiskite skiltyje „Mano paskyra“.');
      const tmp = genPassword();
      const toMail = body.send !== false && EMAIL_RE.test(u.email || '');
      if (toMail) transport();               /* anksti patikriname SMTP, kad nepakeistume slaptažodžio veltui */
      await sql`UPDATE users SET pw = ${await hashPw(tmp)}, must_change = true, pw_changed_at = NULL WHERE id = ${id}`;
      await logEvent(sql, me, 'admin', `Sugeneruotas laikinas slaptažodis: „${u.name}“ (${u.username})`, [toMail ? 'Išsiųstas į ' + u.email : 'Parodytas administratoriui']);
      const snap = await snapshot(sql);
      if (toMail) {
        try { await mailCredentials(req, u.email, u.name, u.username, tmp, 'Administratorius nustatė jums naują laikiną slaptažodį.'); snap.invite = { sent: u.email }; }
        catch (e) { console.error('temp mail', e.message); snap.invite = { error: e.message || 'Nepavyko išsiųsti laiško.' }; snap.temp = { username: u.username, password: tmp }; }
      } else snap.temp = { username: u.username, password: tmp };
      return snap;
    }

    case 'user-delete': {
      requirePerm(me, 'users.manage');
      const id = str(body.id, 40);
      const [u] = await sql`SELECT id, name, username, role_id FROM users WHERE id = ${id}`;
      if (!u) return snapshot(sql);
      if (id === me.id) throw new HttpError(400, 'Negalite ištrinti savo paskyros.');
      if (u.role_id === 'superadmin' && !isSuper) throw new HttpError(403, 'Tik superadministratorius gali valdyti superadministratorius.');
      if (u.role_id === 'superadmin' && (await superCount(sql, id)) === 0) throw new HttpError(400, 'Negalite ištrinti paskutinio superadministratoriaus.');
      await sql`DELETE FROM users WHERE id = ${id}`;
      await logEvent(sql, me, 'admin', `Ištrintas vartotojas „${u.name}“ (${u.username})`);
      return snapshot(sql);
    }

    case 'role-add': {
      requirePerm(me, 'roles.manage');
      const name = str(body.name, 60);
      if (!name) throw new HttpError(400, 'Įveskite rolės pavadinimą.');
      const [dupe] = await sql`SELECT id FROM roles WHERE lower(name) = ${name.toLowerCase()}`;
      if (dupe) throw new HttpError(400, 'Tokia rolė jau yra.');
      await sql`INSERT INTO roles (id, name, perms) VALUES (${newId('r')}, ${name}, '[]'::jsonb)`;
      await logEvent(sql, me, 'admin', `Sukurta rolė „${name}“`);
      return snapshot(sql);
    }

    case 'role-rename': {
      requirePerm(me, 'roles.manage');
      const name = str(body.name, 60), id = str(body.id, 40);
      if (!name) throw new HttpError(400, 'Įveskite rolės pavadinimą.');
      const [oldR] = await sql`SELECT name FROM roles WHERE id = ${id}`;
      await sql`UPDATE roles SET name = ${name} WHERE id = ${id}`;
      if (oldR && oldR.name !== name) await logEvent(sql, me, 'admin', `Rolė „${oldR.name}“ pervadinta į „${name}“`);
      return snapshot(sql);
    }

    case 'role-delete': {
      requirePerm(me, 'roles.manage');
      const id = str(body.id, 40);
      const [inUse] = await sql`SELECT 1 AS x FROM users WHERE role_id = ${id} LIMIT 1`;
      if (inUse) throw new HttpError(400, 'Pirmiausia perkelkite šios rolės vartotojus į kitą rolę.');
      const [delR] = await sql`SELECT name FROM roles WHERE id = ${id} AND NOT system`;
      await sql`DELETE FROM roles WHERE id = ${id} AND NOT system`;
      if (delR) await logEvent(sql, me, 'admin', `Ištrinta rolė „${delR.name}“`);
      return snapshot(sql);
    }

    case 'role-perm': {
      requirePerm(me, 'roles.manage');
      const id = str(body.id, 40), perm = str(body.perm, 120), on = !!body.on;
      const [role] = await sql`SELECT id, system, perms FROM roles WHERE id = ${id}`;
      if (!role) throw new HttpError(404, 'Rolė nerasta.');
      if (role.system) throw new HttpError(400, 'Šios rolės keisti negalima.');
      const [custom] = await sql`SELECT key FROM custom_perms WHERE key = ${perm}`;
      if (!BUILTIN_PERMS.includes(perm) && !custom) throw new HttpError(400, 'Nežinomas leidimas.');
      const set = new Set(role.perms || []);
      if (on) set.add(perm); else set.delete(perm);
      await sql`UPDATE roles SET perms = ${JSON.stringify([...set])}::jsonb WHERE id = ${id}`;
      const [role2] = await sql`SELECT name FROM roles WHERE id = ${id}`;
      await logEvent(sql, me, 'admin', `Rolė „${role2.name}“: leidimas ${custom ? custom.key : perm} ${on ? 'įjungtas' : 'išjungtas'}`);
      return snapshot(sql);
    }

    case 'perm-add': {
      requirePerm(me, 'roles.manage');
      const label = str(body.label, 100);
      if (!label) throw new HttpError(400, 'Įveskite leidimo pavadinimą.');
      const slug = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'leidimas';
      const taken = new Set([...BUILTIN_PERMS, ...(await sql`SELECT key FROM custom_perms`).map((r) => r.key)]);
      let key = 'custom.' + slug, n = 2;
      while (taken.has(key)) key = 'custom.' + slug + '.' + n++;
      await sql`INSERT INTO custom_perms (key, label) VALUES (${key}, ${label})`;
      await logEvent(sql, me, 'admin', `Pridėtas leidimas „${label}“`);
      return { ...(await snapshot(sql)), key };
    }

    case 'perm-delete': {
      requirePerm(me, 'roles.manage');
      const key = str(body.key, 120);
      await logEvent(sql, me, 'admin', `Pašalintas leidimas ${key}`);
      await sql.transaction([
        sql`DELETE FROM custom_perms WHERE key = ${key}`,
        sql`UPDATE roles SET perms = perms - ${key}::text`,
      ]);
      return snapshot(sql);
    }

    default:
      throw new HttpError(400, 'Nežinomas veiksmas.');
  }
});
