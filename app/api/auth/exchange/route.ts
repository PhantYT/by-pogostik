import { apiJson, apiOptions, consumeAuthCode, createSession, isAllowedOrigin, readJsonObject } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return apiJson(request, { error: "Запрос с другого сайта отклонён" }, 403);
  const body = await readJsonObject(request);
  const userId = await consumeAuthCode(typeof body.code === "string" ? body.code : "");
  if (!userId) return apiJson(request, { error: "Код входа недействителен или уже использован" }, 401);
  const token = await createSession(userId);
  return apiJson(request, { token });
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
