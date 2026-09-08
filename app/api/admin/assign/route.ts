import { getD1, readJsonObject, requireProfile, validGroupId } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  if (auth.profile.role !== "super_admin") return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  const body = await readJsonObject(request);
  const userId = typeof body.userId === "string" ? body.userId : "";
  const role = body.role === "group_admin" ? "group_admin" : body.role === "student" ? "student" : null;
  const groupId = Number(body.groupId);
  if (!userId || !role || !validGroupId(groupId)) return Response.json({ error: "Некорректные данные" }, { status: 400 });
  if (userId === auth.profile.id) return Response.json({ error: "Нельзя изменить роль главного администратора" }, { status: 400 });
  const result = await getD1().prepare("UPDATE users SET role = ?, group_id = ?, updated_at = ? WHERE id = ? AND role != 'super_admin'").bind(role, groupId, new Date().toISOString(), userId).run();
  if (!result.meta.changes) return Response.json({ error: "Пользователь не найден или защищён" }, { status: 404 });
  return Response.json({ ok: true });
}
