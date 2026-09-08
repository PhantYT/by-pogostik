import { canManageGroup, cleanText, getD1, isIsoDate, readJsonObject, requireProfile, validGroupId } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  const body = await readJsonObject(request);
  const groupId = Number(body.groupId);
  const subject = cleanText(body.subject, 80);
  const title = cleanText(body.title, 180);
  const details = cleanText(body.details, 1500);
  const due = cleanText(body.due, 10);
  if (!validGroupId(groupId) || !subject || !title || !isIsoDate(due)) return Response.json({ error: "Заполните предмет, задание и срок" }, { status: 400 });
  if (!canManageGroup(auth.profile, groupId)) return Response.json({ error: "Публиковать ДЗ может только администратор этой группы" }, { status: 403 });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getD1().prepare("INSERT INTO homework (id, group_id, subject, title, details, due, done, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
    .bind(id, groupId, subject, title, details, due, auth.profile.id, now, now).run();
  return Response.json({ ok: true, id });
}

export async function PUT(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  const body = await readJsonObject(request);
  const id = cleanText(body.id, 80);
  const row = await getD1().prepare("SELECT group_id FROM homework WHERE id = ?").bind(id).first<{ group_id: number }>();
  if (!row) return Response.json({ error: "Задание не найдено" }, { status: 404 });
  if (!canManageGroup(auth.profile, row.group_id)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  const subject = cleanText(body.subject, 80);
  const title = cleanText(body.title, 180);
  const details = cleanText(body.details, 1500);
  const due = cleanText(body.due, 10);
  const done = body.done ? 1 : 0;
  if (!subject || !title || !isIsoDate(due)) return Response.json({ error: "Заполните обязательные поля" }, { status: 400 });
  await getD1().prepare("UPDATE homework SET subject = ?, title = ?, details = ?, due = ?, done = ?, updated_at = ? WHERE id = ?")
    .bind(subject, title, details, due, done, new Date().toISOString(), id).run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  const id = cleanText((await readJsonObject(request)).id, 80);
  const row = await getD1().prepare("SELECT group_id FROM homework WHERE id = ?").bind(id).first<{ group_id: number }>();
  if (!row) return Response.json({ error: "Задание не найдено" }, { status: 404 });
  if (!canManageGroup(auth.profile, row.group_id)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  await getD1().prepare("DELETE FROM homework WHERE id = ?").bind(id).run();
  return Response.json({ ok: true });
}
