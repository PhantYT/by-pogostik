import { env } from "cloudflare:workers";
import { cleanText, currentProfile, getD1, isSameOrigin, readJsonObject, secureCodeMatches } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Запрос с другого сайта отклонён" }, { status: 403 });
  const { identity, profile } = await currentProfile();
  if (!identity || !profile) return Response.json({ error: "Сначала войдите и зарегистрируйтесь" }, { status: 401 });
  if (profile.role === "super_admin") return Response.json({ ok: true });
  const db = getD1();
  const existing = await db.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").first();
  if (existing) return Response.json({ error: "Главный администратор уже активирован" }, { status: 409 });
  const attempt = await db.prepare("SELECT attempts, locked_until FROM admin_claim_attempts WHERE user_id = ?").bind(identity.userId).first<{ attempts: number; locked_until: string | null }>();
  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) return Response.json({ error: "Слишком много попыток. Повторите через 15 минут" }, { status: 429 });
  const expected = typeof env.SUPER_ADMIN_CODE === "string" ? env.SUPER_ADMIN_CODE : "";
  const code = cleanText((await readJsonObject(request)).code, 100);
  if (!expected || !secureCodeMatches(code, expected)) {
    const attempts = (attempt?.attempts ?? 0) + 1;
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await db.prepare(`INSERT INTO admin_claim_attempts (user_id, attempts, locked_until, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
      .bind(identity.userId, lockedUntil ? 0 : attempts, lockedUntil, new Date().toISOString()).run();
    return Response.json({ error: lockedUntil ? "Слишком много попыток. Повторите через 15 минут" : "Неверный код владельца" }, { status: lockedUntil ? 429 : 403 });
  }
  try {
    await db.batch([
      db.prepare("UPDATE users SET role = 'super_admin', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), identity.userId),
      db.prepare("DELETE FROM admin_claim_attempts WHERE user_id = ?").bind(identity.userId),
    ]);
  } catch { return Response.json({ error: "Главный администратор уже активирован" }, { status: 409 }); }
  return Response.json({ ok: true });
}
