import { apiJson, apiOptions, getD1, requireProfile } from "@/lib/server-data";

export const dynamic = "force-dynamic";

type UserRow = { id: string; email: string; display_name: string; group_id: number | null; role: "student" | "group_admin" | "super_admin"; created_at: string };

export async function GET(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  if (auth.profile.role !== "super_admin") return apiJson(request, { error: "Недостаточно прав" }, 403);
  const rows = await getD1().prepare("SELECT id, email, display_name, group_id, role, created_at FROM users ORDER BY created_at DESC").all<UserRow>();
  return apiJson(request, { users: rows.results.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name, groupId: row.group_id, role: row.role, createdAt: row.created_at })) });
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
