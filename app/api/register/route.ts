import { getD1, currentProfile, cleanText, isSameOrigin, readJsonObject, validGroupId } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Запрос с другого сайта отклонён" }, { status: 403 });
  const { identity, profile } = await currentProfile();
  if (!identity) return Response.json({ error: "Войдите через ChatGPT" }, { status: 401 });
  const body = await readJsonObject(request);
  const displayName = cleanText(body.displayName, 60);
  const groupId = Number(body.groupId);
  if (displayName.length < 2 || !validGroupId(groupId)) return Response.json({ error: "Укажите имя и учебную группу" }, { status: 400 });
  const now = new Date().toISOString();
  const db = getD1();
  if (profile && profile.role !== "student") {
    await db.prepare("UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE id = ?").bind(identity.email, displayName, now, identity.userId).run();
  } else {
    await db.prepare(`INSERT INTO users (id, email, display_name, group_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'student', ?, ?)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, group_id = excluded.group_id, updated_at = excluded.updated_at`)
      .bind(identity.userId, identity.email, displayName, groupId, now, now).run();
  }
  return Response.json({ ok: true });
}
