import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import { apiOptions, secureCodeMatches, withApiHeaders } from "@/lib/server-data";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "pogostik_auth_state";

export async function GET(request: Request) {
  const state = crypto.randomUUID();
  const returnTo = `/api/auth/bridge?state=${encodeURIComponent(state)}`;
  const location = new URL(chatGPTSignInPath(returnTo), request.url).toString();
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": `${STATE_COOKIE}=${state}; Max-Age=600; Path=/api/auth; HttpOnly; Secure; SameSite=Lax`,
    },
  });
  return withApiHeaders(request, response);
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}

export function validAuthState(request: Request, state: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const stored = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) ?? "";
  return Boolean(state && stored && secureCodeMatches(state, stored));
}

export function clearAuthStateCookie() {
  return `${STATE_COOKIE}=; Max-Age=0; Path=/api/auth; HttpOnly; Secure; SameSite=Lax`;
}
