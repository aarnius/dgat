/* Bendras serverio kodas: duomenų bazė, sesijos, slaptažodžiai, leidimai. */
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* Visi įmontuoti leidimai (turi sutapti su PERMS faile auth.js). */
export const BUILTIN_PERMS = [
  'dashboard.view', 'attendance.view', 'attendance.mark',
  'students.view', 'students.edit', 'students.delete', 'students.import',
  'classes.manage', 'classes.all', 'reports.view', 'reports.export',
  'data.view', 'data.backup', 'data.restore', 'data.wipe',
  'users.manage', 'roles.manage',
];
const VIEW_PERMS = ['dashboard.view', 'attendance.view', 'students.view', 'reports.view', 'data.view'];

/* ---------- duomenų bazė ---------- */
let _sql = null;
export function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new HttpError(500, 'Duomenų bazė nesukonfigūruota: trūksta DATABASE_URL (žr. README).');
  return (_sql ??= neon(url));
}

let ready = null;
export function ensureSchema() {
  return (ready ??= (async () => {
    const sql = db();
    await sql`CREATE TABLE IF NOT EXISTS roles (
      id text PRIMARY KEY, name text NOT NULL, system boolean NOT NULL DEFAULT false, perms jsonb NOT NULL DEFAULT '[]'::jsonb)`;
    await sql`CREATE TABLE IF NOT EXISTS custom_perms (key text PRIMARY KEY, label text NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY, name text NOT NULL, username text NOT NULL UNIQUE,
      role_id text NOT NULL REFERENCES roles(id), active boolean NOT NULL DEFAULT true,
      pw text NOT NULL, class_ids jsonb, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS login_attempts (
      key text PRIMARY KEY, count int NOT NULL DEFAULT 0, locked_until timestamptz)`;
    await sql`CREATE TABLE IF NOT EXISTS classes (id text PRIMARY KEY, name text NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS students (
      id text PRIMARY KEY, class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
      email text NOT NULL DEFAULT '', parent_email text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', grade text NOT NULL DEFAULT '')`;
    await sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS grade text NOT NULL DEFAULT ''`; /* mokinio klasė (pvz. 7A) */
    await sql`CREATE TABLE IF NOT EXISTS records (
      class_id text NOT NULL, d text NOT NULL, student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      s text NOT NULL DEFAULT '', n text NOT NULL DEFAULT '', PRIMARY KEY (class_id, d, student_id))`;
    /* Perėjimas iš senos versijos: pridedamas klasių priskyrimas, o esamos rolės išlaiko prieigą prie visų klasių. */
    const [col] = await sql`SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'class_ids'`;
    if (!col) {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_ids jsonb`;
      await sql`UPDATE roles SET perms = perms || '["classes.all"]'::jsonb WHERE NOT system AND NOT (perms @> '["classes.all"]'::jsonb)`;
    }
    const roles = [
      ['superadmin', 'Superadministratorius', true, []],
      ['teacher', 'Mokytojas', false, ['dashboard.view', 'attendance.view', 'attendance.mark', 'students.view', 'reports.view', 'classes.all']],
      ['viewer', 'Stebėtojas', false, ['dashboard.view', 'attendance.view', 'students.view', 'reports.view', 'classes.all']],
    ];
    for (const [id, name, system, perms] of roles) {
      await sql`INSERT INTO roles (id, name, system, perms) VALUES (${id}, ${name}, ${system}, ${JSON.stringify(perms)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    }
  })().catch((e) => { ready = null; throw e; }));
}

/* ---------- slaptažodžiai (scrypt) ---------- */
export async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `s1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function checkPw(pw, stored) {
  const [v, saltHex, keyHex] = String(stored || '').split('$');
  if (v !== 's1' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
export const DUMMY_PW = 's1$' + '00'.repeat(16) + '$' + '00'.repeat(64);

/* ---------- sesija (pasirašytas slapukas) ---------- */
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'Trūksta aplinkos kintamojo SESSION_SECRET (bent 16 simbolių, žr. README).');
  return s;
}
const sign = (p) => crypto.createHmac('sha256', secret()).update(p).digest('base64url');
export function sessionCookie(uid, remember) {
  const exp = Date.now() + (remember ? 30 : 1) * 86400000;
  const p = Buffer.from(JSON.stringify({ u: uid, e: exp })).toString('base64url');
  return `sid=${p}.${sign(p)}; HttpOnly; Secure; SameSite=Lax; Path=/${remember ? '; Max-Age=' + 30 * 86400 : ''}`;
}
export const clearCookie = () => 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

function readSid(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [p, sig] = m[1].split('.');
  if (!p || !sig) return null;
  const want = sign(p);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString());
    return o.e > Date.now() ? o.u : null;
  } catch (e) { return null; }
}

export const publicUser = (u) => u && ({ id: u.id, name: u.name, username: u.username, roleId: u.roleId, roleName: u.roleName, perms: u.perms, classIds: u.classIds });

/* Dabartinis vartotojas imamas iš DB kiekvieną kartą, todėl leidimų pakeitimai ir išjungimas galioja iškart. */
export async function getUser(req) {
  const uid = readSid(req);
  return uid ? userById(uid) : null;
}
export async function userById(uid) {
  const sql = db();
  const [r] = await sql`SELECT u.id, u.name, u.username, u.role_id, u.active, u.class_ids, r.name AS role_name, r.perms
    FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${uid}`;
  if (!r || !r.active) return null;
  const perms = r.role_id === 'superadmin' ? '*' : (r.perms || []);
  /* classIds: null = mato visas klases, masyvas = tik šias klases */
  const all = perms === '*' || perms.includes('classes.all');
  return { id: r.id, name: r.name, username: r.username, roleId: r.role_id, roleName: r.role_name, perms, classIds: all ? null : (Array.isArray(r.class_ids) ? r.class_ids : []) };
}
export const can = (u, p) => !!u && (u.perms === '*' || u.perms.includes(p));
export const canAny = (u, list) => list.some((p) => can(u, p));
export const canView = (u) => canAny(u, VIEW_PERMS);
export function requireUser(u) { if (!u) throw new HttpError(401, 'Sesija baigėsi. Prisijunkite iš naujo.'); return u; }
export function requirePerm(u, ...perms) {
  requireUser(u);
  if (!canAny(u, perms)) throw new HttpError(403, 'Neturite teisės atlikti šio veiksmo.');
}

/* ---------- apvalkalas ---------- */
export function handler(fn) {
  return async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'Metodas neleidžiamas.');
      if (req.method === 'POST') {
        const o = req.headers.origin;
        if (o) { let h = ''; try { h = new URL(o).host; } catch (e) { /* ignore */ } if (h !== req.headers.host) throw new HttpError(403, 'Netinkama užklausos kilmė.'); }
      }
      await ensureSchema();
      const out = await fn(req, res, req.body && typeof req.body === 'object' ? req.body : {});
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error(e);
      res.setHeader('Cache-Control', 'no-store');
      res.status(status).json({ error: e instanceof HttpError ? e.message : 'Serverio klaida. Bandykite dar kartą.' });
    }
  };
}

export const newId = (prefix = '') => prefix + crypto.randomBytes(8).toString('hex');
export const USERNAME_RE = /^[\p{L}\p{N}._-]{3,40}$/u;
export const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);