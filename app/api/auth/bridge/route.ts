import { getChatGPTUser } from "@/app/chatgpt-auth";
import { clearAuthStateCookie, validAuthState } from "@/app/api/auth/start/route";
import { createAuthCode, GITHUB_PAGES_APP_URL, upsertVerifiedUser, withApiHeaders } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get("state") ?? "";
  if (!validAuthState(request, state)) return redirectToApp(request, "auth_error=state");

  const identity = await getChatGPTUser();
  if (!identity) return redirectToApp(request, "auth_error=identity");

  try {
    const profile = await upsertVerifiedUser(identity);
    const code = await createAuthCode(profile.id);
    return redirectToApp(request, `code=${encodeURIComponent(code)}`);
  } catch {
    return redirectToApp(request, "auth_error=server");
  }
}

function redirectToApp(request: Request, fragment: string) {
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: `${GITHUB_PAGES_APP_URL}#${fragment}`,
      "Set-Cookie": clearAuthStateCookie(),
    },
  });
  return withApiHeaders(request, response);
}
