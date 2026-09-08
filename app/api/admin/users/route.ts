import { getD1, requireProfile } from "@/lib/server-data";

export const dynamic = "force-dynamic";

type UserRow = { id: string; email: string; display_name: string; group_id: number | null; role: "student" | "group_admin" | "super_admin"; created_at: string };

export async function GET() {
  const auth = await requireProfile();
  if (auth.error) return auth.error;
  if (auth.profile.role !== "super_admin") return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  const rows = await getD1().prepare("SELECT id, email, display_name, group_id, role, created_at FROM users ORDER BY created_at DESC").all<UserRow>();
  return Response.json({ users: rows.results.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name, groupId: row.group_id, role: row.role, createdAt: row.created_at })) });
}
