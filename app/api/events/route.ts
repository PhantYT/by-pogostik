import { apiJson, apiOptions, canManageGroup, cleanText, getD1, isIsoDate, isValidTime, readJsonObject, requireProfile, validGroupId } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  const body = await readJsonObject(request);
  const groupId = Number(body.groupId);
  const title = cleanText(body.title, 180);
  const details = cleanText(body.details, 1500);
  const date = cleanText(body.date, 10);
  const time = cleanText(body.time, 5);
  if (!validGroupId(groupId) || !title || !isIsoDate(date) || (time && !isValidTime(time))) return apiJson(request, { error: "Заполните название и дату" }, 400);
  if (!canManageGroup(auth.profile, groupId)) return apiJson(request, { error: "Публиковать события может только администратор этой группы" }, 403);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getD1().prepare("INSERT INTO events (id, group_id, title, details, date, time, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, groupId, title, details, date, time, auth.profile.id, now, now).run();
  return apiJson(request, { ok: true, id });
}

export async function PUT(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  const body = await readJsonObject(request);
  const id = cleanText(body.id, 80);
  const row = await getD1().prepare("SELECT group_id FROM events WHERE id = ?").bind(id).first<{ group_id: number }>();
  if (!row) return apiJson(request, { error: "Событие не найдено" }, 404);
  if (!canManageGroup(auth.profile, row.group_id)) return apiJson(request, { error: "Недостаточно прав" }, 403);
  const title = cleanText(body.title, 180);
  const details = cleanText(body.details, 1500);
  const date = cleanText(body.date, 10);
  const time = cleanText(body.time, 5);
  if (!title || !isIsoDate(date) || (time && !isValidTime(time))) return apiJson(request, { error: "Заполните обязательные поля" }, 400);
  await getD1().prepare("UPDATE events SET title = ?, details = ?, date = ?, time = ?, updated_at = ? WHERE id = ?")
    .bind(title, details, date, time, new Date().toISOString(), id).run();
  return apiJson(request, { ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  const id = cleanText((await readJsonObject(request)).id, 80);
  const row = await getD1().prepare("SELECT group_id FROM events WHERE id = ?").bind(id).first<{ group_id: number }>();
  if (!row) return apiJson(request, { error: "Событие не найдено" }, 404);
  if (!canManageGroup(auth.profile, row.group_id)) return apiJson(request, { error: "Недостаточно прав" }, 403);
  await getD1().prepare("DELETE FROM events WHERE id = ?").bind(id).run();
  return apiJson(request, { ok: true });
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
