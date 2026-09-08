import { apiJson, apiOptions, cleanText, getD1, requireProfile, validGroupId } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  return apiJson(request, { profile: auth.profile });
}

export async function PUT(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const displayName = cleanText(body?.displayName, 60);
  const groupId = body?.groupId == null ? auth.profile.groupId : Number(body.groupId);
  if (displayName.length < 2 || groupId === null || !validGroupId(groupId)) {
    return apiJson(request, { error: "Укажите имя и учебную группу" }, 400);
  }
  if (auth.profile.role === "group_admin" && auth.profile.groupId !== groupId) {
    return apiJson(request, { error: "Администратор группы не может сам сменить группу. Обратитесь к главному администратору" }, 403);
  }
  const now = new Date().toISOString();
  await getD1().prepare("UPDATE users SET display_name = ?, group_id = ?, updated_at = ? WHERE id = ?")
    .bind(displayName, groupId, now, auth.profile.id).run();
  return apiJson(request, {
    profile: { ...auth.profile, displayName, groupId },
  });
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
