import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import { currentProfile, ensureDatabase, getD1, STUDY_GROUPS, validGroupId } from "@/lib/server-data";

export const dynamic = "force-dynamic";

type HomeworkRow = { id: string; group_id: number; subject: string; title: string; details: string; due: string; done: number };
type EventRow = { id: string; group_id: number; title: string; details: string; date: string; time: string };

export async function GET(request: Request) {
  await ensureDatabase();
  const { identity, profile } = await currentProfile();
  const requestedGroup = Number(new URL(request.url).searchParams.get("groupId"));
  const groupId = validGroupId(requestedGroup) ? requestedGroup : profile?.groupId ?? STUDY_GROUPS[0].id;
  const db = getD1();
  const [homeworkResult, eventsResult, adminResult] = await Promise.all([
    db.prepare("SELECT id, group_id, subject, title, details, due, done, created_at, updated_at FROM homework WHERE group_id = ? ORDER BY due ASC, created_at DESC").bind(groupId).all<HomeworkRow>(),
    db.prepare("SELECT id, group_id, title, details, date, time, created_at, updated_at FROM events WHERE group_id = ? ORDER BY date ASC, time ASC").bind(groupId).all<EventRow>(),
    db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin'").first<{ total: number }>(),
  ]);

  return Response.json({
    signedIn: Boolean(identity),
    identity: identity ? { email: identity.email, displayName: identity.displayName } : null,
    profile,
    superAdminExists: Number(adminResult?.total ?? 0) > 0,
    signInPath: chatGPTSignInPath("/"),
    signOutPath: "/signout-with-chatgpt?return_to=%2F",
    selectedGroupId: groupId,
    groups: STUDY_GROUPS.map((group) => ({ ...group, eiosUrl: `https://eios.kosgos.ru/WebApp/#/Rasp/Group/${group.id}` })),
    homework: homeworkResult.results.map((row) => ({ id: row.id, groupId: row.group_id, subject: row.subject, title: row.title, details: row.details, due: row.due, done: Boolean(row.done) })),
    events: eventsResult.results.map((row) => ({ id: row.id, groupId: row.group_id, title: row.title, details: row.details, date: row.date, time: row.time })),
  });
}
