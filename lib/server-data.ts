import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export type Role = "student" | "group_admin" | "super_admin";
export type Profile = {
  id: string;
  email: string;
  displayName: string;
  groupId: number | null;
  role: Role;
};

export const STUDY_GROUPS = [
  { id: 8954, code: "26-ИСбо-1" },
  { id: 8881, code: "26-ИСбо-2" },
  { id: 9000, code: "26-ИСбо-3" },
  { id: 8953, code: "26-ИСбо-4" },
  { id: 8878, code: "26-ИСбо-5" },
  { id: 8949, code: "26-ИБбо-6" },
  { id: 8948, code: "26-ПМбо-1" },
] as const;

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
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      group_id INTEGER REFERENCES groups(id),
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','group_admin','super_admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    db.prepare("CREATE INDEX IF NOT EXISTS idx_users_group_id ON users(group_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_single_super_admin ON users(role) WHERE role = 'super_admin'"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_homework_group_due ON homework(group_id, due)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_events_group_date ON events(group_id, date)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_claim_attempts (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL
    )`),
  ]);
  await db.batch(STUDY_GROUPS.map((group) => db.prepare("INSERT OR IGNORE INTO groups (id, code, eios_url) VALUES (?, ?, ?)").bind(group.id, group.code, `https://eios.kosgos.ru/WebApp/#/Rasp/Group/${group.id}`)));
  await db.prepare("PRAGMA optimize").run();
  initialized = true;
}

export async function currentProfile(): Promise<{ identity: Awaited<ReturnType<typeof getChatGPTUser>>; profile: Profile | null }> {
  await ensureDatabase();
  const identity = await getChatGPTUser();
  if (!identity) return { identity: null, profile: null };
  const row = await getD1().prepare("SELECT id, email, display_name, group_id, role FROM users WHERE id = ?").bind(identity.userId).first<{ id: string; email: string; display_name: string; group_id: number | null; role: Role }>();
  return {
    identity,
    profile: row ? { id: row.id, email: row.email, displayName: row.display_name, groupId: row.group_id, role: row.role } : null,
  };
}

export async function requireProfile(request?: Request) {
  if (request && !isSameOrigin(request)) return { error: Response.json({ error: "Запрос с другого сайта отклонён" }, { status: 403 }) } as const;
  const value = await currentProfile();
  if (!value.identity) return { error: Response.json({ error: "Войдите через ChatGPT" }, { status: 401 }) } as const;
  if (!value.profile) return { error: Response.json({ error: "Сначала завершите регистрацию" }, { status: 403 }) } as const;
  return { identity: value.identity, profile: value.profile, error: null } as const;
}

export function canManageGroup(profile: Profile, groupId: number) {
  return profile.role === "super_admin" || (profile.role === "group_admin" && profile.groupId === groupId);
}

export function validGroupId(value: unknown): value is number {
  return typeof value === "number" && STUDY_GROUPS.some((group) => group.id === value);
}

export function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
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
