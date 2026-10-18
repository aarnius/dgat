import { db, handler, HttpError, getUser, can, requireUser, requirePerm, hashPw, newId, USERNAME_RE, str, BUILTIN_PERMS } from '../lib/server.js';

async function snapshot(sql) {
  const [users, roles, customPerms, classes] = await Promise.all([
    sql`SELECT id, name, username, role_id AS "roleId", active, class_ids AS "classIds" FROM users ORDER BY name`,
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
      const [role] = await sql`SELECT id FROM roles WHERE id = ${roleId}`;
      if (!role) throw new HttpError(400, 'Pasirinkite rolę.');
      if (!id && pw.length < 8) throw new HttpError(400, 'Slaptažodis turi būti bent 8 simbolių.');
      if (id && pw && pw.length < 8) throw new HttpError(400, 'Slaptažodis per trumpas (bent 8 simboliai).');
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
      if (existing) {
        await sql`UPDATE users SET name=${name}, username=${username}, role_id=${roleId}, active=${active} WHERE id=${id}`;
        if (pw) await sql`UPDATE users SET pw=${await hashPw(pw)} WHERE id=${id}`;
        if (classIds) await sql`UPDATE users SET class_ids=${JSON.stringify(classIds)}::jsonb WHERE id=${id}`;
      } else {
        await sql`INSERT INTO users (id, name, username, role_id, active, pw, class_ids) VALUES (${newId('u')}, ${name}, ${username}, ${roleId}, ${active}, ${await hashPw(pw)}, ${JSON.stringify(classIds || [])}::jsonb)`;
      }
      return snapshot(sql);
    }

    case 'user-delete': {
      requirePerm(me, 'users.manage');
      const id = str(body.id, 40);
      const [u] = await sql`SELECT id, role_id FROM users WHERE id = ${id}`;
      if (!u) return snapshot(sql);
      if (id === me.id) throw new HttpError(400, 'Negalite ištrinti savo paskyros.');
      if (u.role_id === 'superadmin' && !isSuper) throw new HttpError(403, 'Tik superadministratorius gali valdyti superadministratorius.');
      if (u.role_id === 'superadmin' && (await superCount(sql, id)) === 0) throw new HttpError(400, 'Negalite ištrinti paskutinio superadministratoriaus.');
      await sql`DELETE FROM users WHERE id = ${id}`;
      return snapshot(sql);
    }

    case 'role-add': {
      requirePerm(me, 'roles.manage');
      const name = str(body.name, 60);
      if (!name) throw new HttpError(400, 'Įveskite rolės pavadinimą.');
      const [dupe] = await sql`SELECT id FROM roles WHERE lower(name) = ${name.toLowerCase()}`;
      if (dupe) throw new HttpError(400, 'Tokia rolė jau yra.');
      await sql`INSERT INTO roles (id, name, perms) VALUES (${newId('r')}, ${name}, '[]'::jsonb)`;
      return snapshot(sql);
    }

    case 'role-rename': {
      requirePerm(me, 'roles.manage');
      const name = str(body.name, 60), id = str(body.id, 40);
      if (!name) throw new HttpError(400, 'Įveskite rolės pavadinimą.');
      await sql`UPDATE roles SET name = ${name} WHERE id = ${id}`;
      return snapshot(sql);
    }

    case 'role-delete': {
      requirePerm(me, 'roles.manage');
      const id = str(body.id, 40);
      const [inUse] = await sql`SELECT 1 AS x FROM users WHERE role_id = ${id} LIMIT 1`;
      if (inUse) throw new HttpError(400, 'Pirmiausia perkelkite šios rolės vartotojus į kitą rolę.');
      await sql`DELETE FROM roles WHERE id = ${id} AND NOT system`;
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
      return { ...(await snapshot(sql)), key };
    }

    case 'perm-delete': {
      requirePerm(me, 'roles.manage');
      const key = str(body.key, 120);
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
