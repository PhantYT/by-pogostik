import { normalizeEiosSchedule } from "@/lib/eios-schedule";
import { apiJson, apiOptions, STUDY_GROUPS, validGroupId } from "@/lib/server-data";

export const dynamic = "force-dynamic";

const EIOS_SCHEDULE_URL = "https://eios.kosgos.ru/api/Rasp";
const MAX_EIOS_RESPONSE_BYTES = 8 * 1024 * 1024;

function validAcademicYear(value: string) {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1 && start >= 2023 && start <= new Date().getUTCFullYear() + 1;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const groupId = Number(requestUrl.searchParams.get("groupId"));
  const year = requestUrl.searchParams.get("year") ?? "";
  if (!validGroupId(groupId) || !validAcademicYear(year)) {
    return apiJson(request, { error: "Неизвестная группа или учебный год" }, 400);
  }

  const group = STUDY_GROUPS.find((item) => item.id === groupId)!;
  const upstreamUrl = new URL(EIOS_SCHEDULE_URL);
  upstreamUrl.searchParams.set("idGroup", String(groupId));
  upstreamUrl.searchParams.set("year", year);

  try {
    let upstream = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    let source = "eios";
    if (!upstream.ok) {
      const translatorUrl = new URL("https://translate.yandex.ru/translate");
      translatorUrl.searchParams.set("url", upstreamUrl.toString());
      translatorUrl.searchParams.set("lang", "ru-en");
      upstream = await fetch(translatorUrl, {
        headers: { Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(18_000),
      });
      source = "eios-relay";
    }
    if (!upstream.ok) {
      return apiJson(request, { error: "ЭИОС временно не отвечает", code: "EIOS_UPSTREAM_ERROR" }, 502);
    }
    const declaredSize = Number(upstream.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_EIOS_RESPONSE_BYTES) {
      return apiJson(request, { error: "Слишком большой ответ ЭИОС", code: "EIOS_RESPONSE_TOO_LARGE" }, 502);
    }
    const raw = await upstream.text();
    if (raw.length > MAX_EIOS_RESPONSE_BYTES) {
      return apiJson(request, { error: "Слишком большой ответ ЭИОС", code: "EIOS_RESPONSE_TOO_LARGE" }, 502);
    }
    const normalized = normalizeEiosSchedule(JSON.parse(raw));
    return apiJson(request, {
      ...normalized,
      group: { id: group.id, code: group.code },
      year,
      source,
    });
  } catch {
    return apiJson(request, { error: "Не удалось связаться с ЭИОС", code: "EIOS_UNAVAILABLE" }, 503);
  }
}

export function OPTIONS(request: Request) {
  return apiOptions(request);
}
