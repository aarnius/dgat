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
  'dashboard.view', 'calendar.all', 'attendance.view', 'attendance.mark',
  'students.view', 'students.edit', 'students.delete', 'students.import',
  'classes.manage', 'classes.all', 'reports.view', 'reports.export',
  'data.view', 'data.backup', 'data.restore', 'data.wipe',
  'users.manage', 'roles.manage',
  'logs.view', 'logs.undo', 'logs.clear',
  'attendance.free',
  'activities.view', 'activities.create', 'activities.edit', 'activities.delete', 'activities.mark', 'activities.report',
  'tools.view', 'tools.save',
];
const VIEW_PERMS = ['dashboard.view', 'attendance.view', 'students.view', 'reports.view', 'data.view', 'activities.view'];

/* ---------- duomenų bazė ---------- */
let _sql = null;
export function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new HttpError(500, 'Duomenų bazė nesukonfigūruota: trūksta DATABASE_URL (žr. README).');
  return (_sql ??= neon(url));
}

let ready = null;
/* Schemos versija: kai ji jau įrašyta, visas lentelių kūrimas / perėjimai praleidžiami (vienas greitas užklausimas
   vietoj kelių dešimčių) – tai ženkliai pagreitina kiekvieną „šaltą“ serverio paleidimą. Keičiant schemą, padidinkite SCHEMA_V. */
const SCHEMA_V = 'v12-templates';
export function ensureSchema() {
  return (ready ??= (async () => {
    const sql = db();
    try {
      const [m] = await sql`SELECT val FROM app_meta WHERE key = 'schema_version'`;
      if (m && m.val === SCHEMA_V) return;
    } catch (e) { /* lentelės dar nėra – vykdome pilną paruošimą */ }
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
      id text PRIMARY KEY,
      first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
      email text NOT NULL DEFAULT '', parent_email text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', grade text NOT NULL DEFAULT '')`;
    await sql`ALTER TABLE students ADD COLUMN IF NOT EXISTS grade text NOT NULL DEFAULT ''`; /* mokinio klasė (pvz. 7A) */
    /* Mokinys gali priklausyti keliems komitetams, todėl ryšys saugomas atskiroje lentelėje. */
    await sql`CREATE TABLE IF NOT EXISTS student_classes (
      student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      PRIMARY KEY (student_id, class_id))`;
    /* Perėjimas iš senos versijos (vienas students.class_id): perkeliame ryšius ir pašaliname seną stulpelį. */
    const [legacy] = await sql`SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'class_id'`;
    if (legacy) {
      await sql`INSERT INTO student_classes (student_id, class_id) SELECT id, class_id FROM students WHERE class_id IS NOT NULL ON CONFLICT DO NOTHING`;
      await sql`ALTER TABLE students DROP COLUMN class_id`;
    }
    await sql`CREATE TABLE IF NOT EXISTS records (
      class_id text NOT NULL, d text NOT NULL, student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      s text NOT NULL DEFAULT '', n text NOT NULL DEFAULT '', PRIMARY KEY (class_id, d, student_id))`;
    await sql`CREATE TABLE IF NOT EXISTS logs (
      id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), user_id text, user_name text NOT NULL DEFAULT '',
      kind text NOT NULL DEFAULT '', summary text NOT NULL, details jsonb NOT NULL DEFAULT '[]'::jsonb,
      undo jsonb, undone boolean NOT NULL DEFAULT false)`;
    await sql`CREATE INDEX IF NOT EXISTS logs_ts_idx ON logs (ts DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS backups (
      id bigserial PRIMARY KEY, day date NOT NULL, kind text NOT NULL DEFAULT 'auto',
      created_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS backups_auto_day ON backups (day) WHERE kind = 'auto'`;
    /* Perėjimas iš senos versijos: pridedamas klasių priskyrimas, o esamos rolės išlaiko prieigą prie visų klasių. */
    const [col] = await sql`SELECT 1 AS x FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'class_ids'`;
    if (!col) {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS class_ids jsonb`;
      await sql`UPDATE roles SET perms = perms || '["classes.all"]'::jsonb WHERE NOT system AND NOT (perms @> '["classes.all"]'::jsonb)`;
    }
    /* ---------- veiklos ---------- */
    await sql`CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, val text NOT NULL DEFAULT '')`;
    await sql`CREATE TABLE IF NOT EXISTS activities (
      id text PRIMARY KEY, class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      name text NOT NULL, description text NOT NULL DEFAULT '', place text NOT NULL DEFAULT '',
      teacher_id text REFERENCES users(id) ON DELETE SET NULL, teacher_name text NOT NULL DEFAULT '',
      created_by text, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS activities_class_idx ON activities (class_id)`;
    /* Tuščias dalyvių sąrašas = visi komiteto mokiniai. */
    await sql`CREATE TABLE IF NOT EXISTS activity_students (
      activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      PRIMARY KEY (activity_id, student_id))`;
    await sql`CREATE TABLE IF NOT EXISTS activity_sessions (
      id text PRIMARY KEY, activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      d text NOT NULL, t_from text NOT NULL DEFAULT '', t_to text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '')`;
    await sql`CREATE INDEX IF NOT EXISTS activity_sessions_act_idx ON activity_sessions (activity_id)`;
    await sql`CREATE INDEX IF NOT EXISTS activity_sessions_d_idx ON activity_sessions (d)`;
    await sql`CREATE TABLE IF NOT EXISTS activity_records (
      session_id text NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
      student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      s text NOT NULL DEFAULT '', n text NOT NULL DEFAULT '', PRIMARY KEY (session_id, student_id))`;
    /* Vienkartinis perėjimas: esamos rolės išlaiko dabartines galimybes (matyti veiklas, žymėti, žymėti dieną be veiklos). */
    const [permsDone] = await sql`SELECT 1 AS x FROM app_meta WHERE key = 'activities_perms_v1'`;
    if (!permsDone) {
      await sql`UPDATE roles SET perms = perms || '["activities.view"]'::jsonb WHERE NOT system AND perms @> '["attendance.view"]'::jsonb AND NOT (perms @> '["activities.view"]'::jsonb)`;
      await sql`UPDATE roles SET perms = perms || '["activities.mark","attendance.free"]'::jsonb WHERE NOT system AND perms @> '["attendance.mark"]'::jsonb AND NOT (perms @> '["activities.mark"]'::jsonb)`;
      await sql`INSERT INTO app_meta (key, val) VALUES ('activities_perms_v1', now()::text) ON CONFLICT DO NOTHING`;
    }
    /* ---------- įrankiai ---------- */
    await sql`CREATE TABLE IF NOT EXISTS saved_groups (
      id text PRIMARY KEY, class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE, name text NOT NULL, data jsonb NOT NULL,
      created_by text, created_by_name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS list_templates (
      id text PRIMARY KEY, name text NOT NULL, data jsonb NOT NULL,
      created_by text, created_by_name text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now())`;
    const [toolsDone] = await sql`SELECT 1 AS x FROM app_meta WHERE key = 'tools_perms_v1'`;
    if (!toolsDone) {
      await sql`UPDATE roles SET perms = perms || '["tools.view"]'::jsonb WHERE NOT system AND perms @> '["attendance.view"]'::jsonb AND NOT (perms @> '["tools.view"]'::jsonb)`;
      await sql`UPDATE roles SET perms = perms || '["tools.save"]'::jsonb WHERE NOT system AND perms @> '["attendance.mark"]'::jsonb AND NOT (perms @> '["tools.save"]'::jsonb)`;
      await sql`INSERT INTO app_meta (key, val) VALUES ('tools_perms_v1', now()::text) ON CONFLICT DO NOTHING`;
    }
    const roles = [
      ['superadmin', 'Superadministratorius', true, []],
      ['teacher', 'Mokytojas', false, ['dashboard.view', 'attendance.view', 'attendance.mark', 'attendance.free', 'students.view', 'reports.view', 'classes.all', 'activities.view', 'activities.mark', 'tools.view', 'tools.save']],
      ['viewer', 'Stebėtojas', false, ['dashboard.view', 'attendance.view', 'students.view', 'reports.view', 'classes.all', 'activities.view', 'tools.view']],
    ];
    for (const [id, name, system, perms] of roles) {
      await sql`INSERT INTO roles (id, name, system, perms) VALUES (${id}, ${name}, ${system}, ${JSON.stringify(perms)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    }
    /* ---------- našumo indeksai ---------- */
    await sql`CREATE INDEX IF NOT EXISTS student_classes_class_idx ON student_classes (class_id)`;
    await sql`CREATE INDEX IF NOT EXISTS records_student_idx ON records (student_id)`;
    await sql`CREATE INDEX IF NOT EXISTS activity_students_student_idx ON activity_students (student_id)`;
    await sql`CREATE INDEX IF NOT EXISTS activity_records_student_idx ON activity_records (student_id)`;
    await sql`CREATE INDEX IF NOT EXISTS logs_undone_idx ON logs (id) WHERE undone`;
    await sql`INSERT INTO app_meta (key, val) VALUES ('schema_version', ${SCHEMA_V}) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val`;
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

/* ---------- LOG (pakeitimų istorija) ---------- */
const logRow = (who, kind, summary, details, undo) => [
  who && who.id ? who.id : null, who && who.name ? who.name : '', kind, String(summary).slice(0, 500),
  JSON.stringify((details || []).slice(0, 80).map((x) => String(x).slice(0, 300))), undo ? JSON.stringify(undo) : null,
];
/* Užklausa, kurią galima įdėti į transakciją kartu su pakeitimu. */
export function logQ(sql, who, kind, summary, details, undo) {
  const [u, n, k, s, d, un] = logRow(who, kind, summary, details, undo);
  return sql`INSERT INTO logs (user_id, user_name, kind, summary, details, undo) VALUES (${u}, ${n}, ${k}, ${s}, ${d}::jsonb, ${un}::jsonb)`;
}
/* Atskiras įrašas; LOG klaida niekada nenutraukia pagrindinio veiksmo. */
export async function logEvent(sql, who, kind, summary, details) {
  try { await logQ(sql, who, kind, summary, details, null); } catch (e) { console.error('log', e); }
}

/* ---------- pilna duomenų būsena ir atsarginės kopijos ---------- */
export async function fullState(sql, ids = null) {
  const [classes, students, links, records] = await Promise.all([
    sql`SELECT id, name FROM classes WHERE (${ids}::text[] IS NULL OR id = ANY(${ids}::text[])) ORDER BY name`,
    sql`SELECT s.id, s.first_name AS first, s.last_name AS last, s.email, s.parent_email AS "parentEmail", s.notes, s.grade FROM students s
        WHERE ${ids}::text[] IS NULL OR EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = s.id AND sc.class_id = ANY(${ids}::text[]))`,
    sql`SELECT student_id AS sid, class_id AS cid FROM student_classes WHERE (${ids}::text[] IS NULL OR class_id = ANY(${ids}::text[]))`,
    sql`SELECT class_id AS c, d, student_id AS sid, s, n FROM records WHERE (${ids}::text[] IS NULL OR class_id = ANY(${ids}::text[]))`,
  ]);
  const m = new Map();
  links.forEach((l) => { if (!m.has(l.sid)) m.set(l.sid, []); m.get(l.sid).push(l.cid); });
  return { classes, students: students.map((s) => ({ ...s, classIds: m.get(s.id) || [] })), records };
}

/* Duomenų versija: pigus patikrinimas „ar kas nors pasikeitė?“. Kiekvienas pakeitimas (lib/ops.js) toje pačioje
   transakcijoje įrašo LOG eilutę, todėl didžiausias logs.id pasikeičia po bet kokio pakeitimo.
   Atšaukimai (undone), LOG valymas, mokinių / komitetų pridėjimas ar trynimas taip pat pakeičia versiją. */
export async function dataVersion(sql) {
  const [r] = await sql`SELECT
    COALESCE((SELECT max(id) FROM logs), 0)::text AS l,
    (SELECT count(*) FROM logs WHERE undone)::text AS u,
    (SELECT count(*) FROM classes)::text AS c,
    (SELECT count(*) FROM students)::text AS s,
    (SELECT count(*) FROM student_classes)::text AS sc`;
  return [r.l, r.u, r.c, r.s, r.sc].join('.');
}

/* Veiklų duomenys atsarginei kopijai (įrašoma į kopijos JSON kaip „activities“). */
export async function activitiesDump(sql) {
  const [activities, students, sessions, records] = await Promise.all([
    sql`SELECT id, class_id AS "classId", name, description, place, teacher_id AS "teacherId", teacher_name AS "teacherName" FROM activities ORDER BY name`,
    sql`SELECT activity_id AS aid, student_id AS sid FROM activity_students`,
    sql`SELECT id, activity_id AS aid, d, t_from AS "from", t_to AS "to", note FROM activity_sessions ORDER BY d`,
    sql`SELECT session_id AS ssid, student_id AS sid, s, n FROM activity_records`,
  ]);
  return { activities, students, sessions, records };
}

export async function makeBackup(sql, kind = 'auto', who = null) {
  const data = await fullState(sql, null);
  if (kind === 'auto' && !data.classes.length && !data.students.length) return null;
  try { data.activities = await activitiesDump(sql); } catch (e) { console.error('activities dump', e); }
  const rows = await sql`INSERT INTO backups (day, kind, data) VALUES ((now() AT TIME ZONE 'Europe/Vilnius')::date, ${kind}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (day) WHERE kind = 'auto' DO NOTHING RETURNING id`;
  if (!rows.length) return null;
  await sql`DELETE FROM backups WHERE created_at < now() - interval '30 days'`;
  await logEvent(sql, who, 'backup', kind === 'auto' ? 'Sukurta automatinė dienos atsarginė kopija' : 'Sukurta atsarginė kopija serveryje',
    [`Komitetų: ${data.classes.length}`, `Mokinių: ${data.students.length}`, `Lankomumo žymų: ${data.records.length}`]);
  return rows[0].id;
}

/* Atsarginė kopija kartą per dieną: pagrindinis būdas – Vercel Cron (vercel.json), čia – atsarginis variantas, jei cron neveikia. */
let backupDay = null;
export async function dailyBackup(sql) {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vilnius' });
  if (backupDay === day) return;
  const [ex] = await sql`SELECT 1 AS x FROM backups WHERE kind = 'auto' AND day = (now() AT TIME ZONE 'Europe/Vilnius')::date`;
  if (!ex) await makeBackup(sql, 'auto');
  backupDay = day;
}