import { apiJson, apiOptions, isAllowedOrigin, revokeSession } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return apiJson(request, { error: "Запрос с другого сайта отклонён" }, 403);
  await revokeSession(request);
  return apiJson(request, { ok: true });
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
