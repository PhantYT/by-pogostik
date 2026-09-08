import { apiJson, apiOptions, cleanText, getD1, getOwnerEmail, requireProfile, validGroupId, validRole, type Profile, type Role } from "@/lib/server-data";

export const dynamic = "force-dynamic";

type UserRow = { id: string; email: string; display_name: string; group_id: number | null; role: Role };

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  if (auth.profile.role !== "super_admin") return apiJson(request, { error: "Недостаточно прав" }, 403);

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const displayName = cleanText(body?.displayName, 60);
  const groupId = Number(body?.groupId);
  const role = body?.role;
  if (!id || displayName.length < 2 || !validGroupId(groupId) || !validRole(role)) {
    return apiJson(request, { error: "Некорректные данные профиля" }, 400);
  }

  const db = getD1();
  const target = await db.prepare("SELECT id, email, display_name, group_id, role FROM users WHERE id = ?")
    .bind(id).first<UserRow>();
  if (!target) return apiJson(request, { error: "Пользователь не найден" }, 404);
  const targetIsOwner = target.email.toLowerCase() === getOwnerEmail();
  if (targetIsOwner && role !== "super_admin") {
    return apiJson(request, { error: "Нельзя понизить роль владельца сайта" }, 400);
  }
  if (!targetIsOwner && role === "super_admin") {
    return apiJson(request, { error: "Роль главного администратора закреплена за владельцем сайта" }, 400);
  }

  await db.prepare("UPDATE users SET display_name = ?, group_id = ?, role = ?, updated_at = ? WHERE id = ?")
    .bind(displayName, groupId, role, new Date().toISOString(), id).run();
  const profile: Profile = { id, email: target.email, displayName, groupId, role };
  return apiJson(request, { profile });
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
