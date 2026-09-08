import { env } from "cloudflare:workers";

export type Role = "student" | "group_admin" | "super_admin";
export type Profile = {
  id: string;
  email: string;
  displayName: string;
  groupId: number | null;
  role: Role;
};

type ProfileRow = {
  id: string;
  email: string;
  display_name: string;
  group_id: number | null;
  role: Role;
};

type SessionRow = ProfileRow & {
  token_hash: string;
  expires_at: string;
  last_used_at: string;
};

type AuthCodeRow = { user_id: string };

export const OWNER_EMAIL = "vasmat2009@gmail.com";
export const GITHUB_PAGES_ORIGIN = "https://phantyt.github.io";
export const GITHUB_PAGES_APP_URL = `${GITHUB_PAGES_ORIGIN}/by-pogostik/`;

export const STUDY_GROUPS = [
  { id: 8954, code: "26-ИСбо-1" },
  { id: 8881, code: "26-ИСбо-2" },
  { id: 9000, code: "26-ИСбо-3" },
  { id: 8953, code: "26-ИСбо-4" },
  { id: 8878, code: "26-ИСбо-5" },
  { id: 8949, code: "26-ИБбо-6" },
  { id: 8948, code: "26-ПМбо-1" },
] as const;

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
const PROFILE_SELECT = "SELECT id, email, display_name, group_id, role FROM users";

let initialized = false;

export function getD1(): D1Database {
  if (!env.DB) throw new Error("Database binding DB is unavailable");
  return env.DB;
}

export async function ensureDatabase() {
  if (initialized) return;
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      eios_url TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE,
      display_name TEXT NOT NULL,
      group_id INTEGER REFERENCES groups(id),
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','group_admin','super_admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_codes (
      code_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS homework (
      id TEXT PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id),
      subject TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      due TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id),
      title TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_claim_attempts (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL
    )`),
  ]);

  await db.batch(STUDY_GROUPS.map((group) => db.prepare("INSERT OR IGNORE INTO groups (id, code, eios_url) VALUES (?, ?, ?)")
    .bind(group.id, group.code, `https://eios.kosgos.ru/WebApp/#/Rasp/Group/${group.id}`)));

  await db.prepare("UPDATE users SET email = lower(trim(email)) WHERE email != lower(trim(email))").run();
  await db.batch([
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_nocase ON users(email COLLATE NOCASE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_users_group_id ON users(group_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_single_super_admin ON users(role) WHERE role = 'super_admin'"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_auth_codes_expires_at ON auth_codes(expires_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_homework_group_due ON homework(group_id, due)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_events_group_date ON events(group_id, date)"),
  ]);

  await forceOwnerRole(db);
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  await db.prepare("DELETE FROM auth_codes WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  await db.prepare("PRAGMA optimize").run();
  initialized = true;
}

export async function upsertVerifiedUser(identity: { userId: string; email: string; displayName: string }): Promise<Profile> {
  await ensureDatabase();
  const db = getD1();
  const email = normalizeEmail(identity.email);
  if (!email) throw new Error("The identity provider returned an invalid email address");
  const now = new Date().toISOString();
  const existingById = await db.prepare(`${PROFILE_SELECT} WHERE id = ?`).bind(identity.userId).first<ProfileRow>();
  const existingByEmail = existingById
    ? null
    : await db.prepare(`${PROFILE_SELECT} WHERE email = ? COLLATE NOCASE`).bind(email).first<ProfileRow>();
  const existing = existingById ?? existingByEmail;
  const userId = existing?.id ?? identity.userId;
  const configuredOwnerEmail = getOwnerEmail();
  const owner = email === configuredOwnerEmail;

  if (owner) {
    await db.batch([
      db.prepare("UPDATE users SET role = 'student', updated_at = ? WHERE role = 'super_admin' AND email != ? COLLATE NOCASE")
        .bind(now, configuredOwnerEmail),
      existing
        ? db.prepare("UPDATE users SET email = ?, role = 'super_admin', updated_at = ? WHERE id = ?").bind(email, now, userId)
        : db.prepare("INSERT INTO users (id, email, display_name, group_id, role, created_at, updated_at) VALUES (?, ?, ?, NULL, 'super_admin', ?, ?)")
          .bind(userId, email, cleanText(identity.displayName, 60) || email, now, now),
    ]);
  } else if (existing) {
    await db.prepare("UPDATE users SET email = ?, role = CASE WHEN role = 'super_admin' THEN 'student' ELSE role END, updated_at = ? WHERE id = ?")
      .bind(email, now, userId).run();
  } else {
    await db.prepare("INSERT INTO users (id, email, display_name, group_id, role, created_at, updated_at) VALUES (?, ?, ?, NULL, 'student', ?, ?)")
      .bind(userId, email, cleanText(identity.displayName, 60) || email, now, now).run();
  }

  const row = await db.prepare(`${PROFILE_SELECT} WHERE id = ?`).bind(userId).first<ProfileRow>();
  if (!row) throw new Error("Could not create a local user profile");
  return rowToProfile(row);
}

export async function createAuthCode(userId: string): Promise<string> {
  await ensureDatabase();
  const code = randomToken(32);
  const codeHash = await hashToken(code);
  const now = new Date();
  await getD1().batch([
    getD1().prepare("DELETE FROM auth_codes WHERE expires_at <= ?").bind(now.toISOString()),
    getD1().prepare("INSERT INTO auth_codes (code_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(codeHash, userId, new Date(now.getTime() + AUTH_CODE_TTL_MS).toISOString(), now.toISOString()),
  ]);
  return code;
}

export async function consumeAuthCode(code: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return null;
  await ensureDatabase();
  const row = await getD1().prepare("DELETE FROM auth_codes WHERE code_hash = ? AND expires_at > ? RETURNING user_id")
    .bind(await hashToken(code), new Date().toISOString()).first<AuthCodeRow>();
  return row?.user_id ?? null;
}

export async function createSession(userId: string): Promise<string> {
  await ensureDatabase();
  const token = randomToken(32);
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const nowIso = now.toISOString();
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowIso),
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .bind(tokenHash, userId, expiresAt, nowIso, nowIso),
  ]);
  await db.prepare(`DELETE FROM sessions WHERE token_hash IN (
    SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 20
  )`).bind(userId).run();
  return token;
}

export async function revokeSession(request: Request) {
  const token = bearerToken(request);
  if (!token) return;
  await ensureDatabase();
  await getD1().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
}

export async function currentProfile(request?: Request): Promise<{
  identity: { userId: string; email: string; displayName: string } | null;
  profile: Profile | null;
}> {
  await ensureDatabase();
  if (!request) return { identity: null, profile: null };
  const token = bearerToken(request);
  if (!token) return { identity: null, profile: null };
  const tokenHash = await hashToken(token);
  const now = new Date();
  const row = await getD1().prepare(`SELECT s.token_hash, s.expires_at, s.last_used_at,
    u.id, u.email, u.display_name, u.group_id, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(tokenHash, now.toISOString()).first<SessionRow>();
  if (!row) return { identity: null, profile: null };

  const lastUsed = Date.parse(row.last_used_at);
  if (!Number.isFinite(lastUsed) || now.getTime() - lastUsed >= SESSION_TOUCH_INTERVAL_MS) {
    await getD1().prepare("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?").bind(now.toISOString(), tokenHash).run();
  }
  const profile = rowToProfile(row);
  return {
    identity: { userId: profile.id, email: profile.email, displayName: profile.displayName },
    profile,
  };
}

export async function requireProfile(request: Request) {
  if (!isAllowedOrigin(request)) return { error: apiJson(request, { error: "Запрос с другого сайта отклонён" }, 403) } as const;
  const value = await currentProfile(request);
  if (!value.profile) return { error: apiJson(request, { error: "Войдите в аккаунт" }, 401) } as const;
  return { identity: value.identity!, profile: value.profile, error: null } as const;
}

export function canManageGroup(profile: Profile, groupId: number) {
  return profile.role === "super_admin" || (profile.role === "group_admin" && profile.groupId === groupId);
}

export function validGroupId(value: unknown): value is number {
  return typeof value === "number" && STUDY_GROUPS.some((group) => group.id === value);
}

export function validRole(value: unknown): value is Role {
  return value === "student" || value === "group_admin" || value === "super_admin";
}

export function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function getOwnerEmail() {
  return normalizeEmail(env.OWNER_EMAIL) || OWNER_EMAIL;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || origin === GITHUB_PAGES_ORIGIN;
}

export const isSameOrigin = isAllowedOrigin;

export function apiJson(request: Request, body: unknown, init: ResponseInit | number = {}) {
  const options = typeof init === "number" ? { status: init } : init;
  return withApiHeaders(request, Response.json(body, options));
}

export function apiOptions(request: Request) {
  if (!isAllowedOrigin(request)) return withApiHeaders(request, new Response(null, { status: 403 }));
  return withApiHeaders(request, new Response(null, { status: 204 }));
}

export function withApiHeaders(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(request)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function secureCodeMatches(value: string, expected: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(value);
  const right = encoder.encode(expected);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    groupId: row.group_id,
    role: row.role,
  };
}

async function forceOwnerRole(db: D1Database) {
  const now = new Date().toISOString();
  const configuredOwnerEmail = getOwnerEmail();
  await db.batch([
    db.prepare("UPDATE users SET role = 'student', updated_at = ? WHERE role = 'super_admin' AND email != ? COLLATE NOCASE")
      .bind(now, configuredOwnerEmail),
    db.prepare("UPDATE users SET role = 'super_admin', updated_at = ? WHERE email = ? COLLATE NOCASE AND role != 'super_admin'")
      .bind(now, configuredOwnerEmail),
  ]);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,512})$/i.exec(authorization);
  return match?.[1] ?? null;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
