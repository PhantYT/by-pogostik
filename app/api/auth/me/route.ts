import { apiJson, apiOptions, requireProfile } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireProfile(request);
  if (auth.error) return auth.error;
  return apiJson(request, { profile: auth.profile });
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
