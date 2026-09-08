"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react/jsx-no-comment-textnodes, @next/next/no-img-element, jsx-a11y/media-has-caption */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { academicYearForDate, normalizeEiosSchedule, scheduleWeekRange, type ScheduleLesson } from "@/lib/eios-schedule";

type View = "home" | "schedule" | "homework" | "events" | "profile" | "admin";
type Role = "student" | "group_admin" | "super_admin";
type Group = { id: number; code: string; eiosUrl: string };
type Profile = { id: string; email: string; displayName: string; groupId: number | null; role: Role };
type Homework = { id: string; groupId: number; subject: string; title: string; details: string; due: string; done: boolean };
type StudyEvent = { id: string; groupId: number; title: string; details: string; date: string; time: string };
type AdminUser = Profile & { createdAt: string };
type Track = { id: string; title: string; artist: string; cover?: string; stream?: string; sourceUrl?: string; licenseUrl?: string; source: "synth" | "audius" | "archive" };

const FALLBACK_GROUPS: Group[] = [
  [8954, "26-ИСбо-1"], [8881, "26-ИСбо-2"], [9000, "26-ИСбо-3"], [8953, "26-ИСбо-4"], [8878, "26-ИСбо-5"], [8949, "26-ИБбо-6"], [8948, "26-ПМбо-1"],
].map(([id, code]) => ({ id: Number(id), code: String(code), eiosUrl: `https://eios.kosgos.ru/WebApp/#/Rasp/Group/${id}` }));
const emptyHomework = { subject: "Программирование", title: "", details: "", due: "" };
const emptyEvent = { title: "", details: "", date: "", time: "" };
const defaultTrack: Track = { id: "pixel-focus", title: "Pixel Focus", artist: "by pogostik · бесконечный ambient", source: "synth" };
const randomMusicTerms = ["instrumental ambient", "lofi instrumental", "classical piano", "study music", "jazz instrumental", "electronic ambient"];
const TOKEN_KEY = "pogostik-auth-token";
const REMOTE_API_ORIGIN = "https://by-pogostik.vasmat2009.chatgpt.site";

const apiUrl = (path: string) => {
  if (typeof window === "undefined") return path;
  return window.location.hostname.endsWith("github.io") ? `${REMOTE_API_ORIGIN}${path}` : path;
};

const apiFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  const token = typeof window === "undefined" ? "" : sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(apiUrl(path), { ...init, headers, credentials: "omit" });
};

const formatDate = (value: string, short = false) => new Intl.DateTimeFormat("ru-RU", short ? { day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
const lessonType = (subject: string) => /^(лек)(?:\s|$)/i.test(subject) ? "Лекция" : /^(лаб)(?:\s|$)/i.test(subject) ? "Лабораторная" : /^(пр)(?:\s|$)/i.test(subject) ? "Практика" : "Занятие";
const cleanLessonTitle = (subject: string) => subject.replace(/^(?:лек|лаб|пр)\s+/i, "").replace(/,?\s*п\/г\s*\d+\s*$/i, "").trim();

async function findAudiusTracks(term = ""): Promise<Track[]> {
  const endpoint = term.trim() ? "tracks/search" : "tracks/trending";
  const params = new URLSearchParams({ limit: "24", app_name: "by_pogostik" });
  if (term.trim()) params.set("query", term.trim());
  else params.set("time", "week");
  const response = await fetch(`https://api.audius.co/v1/${endpoint}?${params}`, { credentials: "omit" });
  if (!response.ok) throw new Error("Современный музыкальный каталог временно недоступен");
  const payload = await response.json() as { data?: unknown[] };
  const rows = (payload.data ?? []) as Array<{
    id: string; title?: string; duration?: number; permalink?: string; is_streamable?: boolean; is_stream_gated?: boolean;
    access?: { stream?: boolean }; artwork?: Record<string, string | string[]> | null; user?: { name?: string };
  }>;
  return rows
    .filter((item) => item.id && item.is_streamable !== false && !item.is_stream_gated && item.access?.stream !== false && Number(item.duration ?? 0) > 35)
    .map((item) => ({
      id: `audius:${item.id}`,
      title: item.title?.trim() || "Без названия",
      artist: item.user?.name?.trim() || "Audius artist",
      cover: typeof item.artwork?.["480x480"] === "string" ? item.artwork["480x480"] as string : undefined,
      stream: `https://api.audius.co/v1/tracks/${encodeURIComponent(item.id)}/stream?app_name=by_pogostik`,
      sourceUrl: item.permalink ? `https://audius.co${item.permalink}` : "https://audius.co/",
      source: "audius" as const,
    }));
}

async function findArchiveTracks(term: string): Promise<Track[]> {
  const words = term.normalize("NFKC").trim().split(/\s+/).filter(Boolean).slice(0, 10).map((word) => `"${word.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  const textQuery = words.length ? ` AND (title:(${words.join(" AND ")}) OR creator:(${words.join(" AND ")}) OR subject:(${words.join(" AND ")}))` : "";
  const query = `mediatype:audio AND collection:netlabels AND format:"VBR MP3" AND licenseurl:[* TO *]${textQuery}`;
  const params = new URLSearchParams({ q: query, rows: "10", page: "1", output: "json" });
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "creator");
  params.append("fl[]", "licenseurl");
  params.set("sort[]", "downloads desc");
  const response = await fetch(`https://archive.org/advancedsearch.php?${params}`);
  if (!response.ok) throw new Error("Каталог музыки временно недоступен");
  const payload = await response.json() as { response?: { docs?: unknown[] } };
  const docs = (payload.response?.docs ?? []) as Array<{ identifier: string; title?: string | string[]; creator?: string | string[]; licenseurl?: string | string[] }>;
  const candidates = await Promise.all(docs.slice(0, 8).map(async (doc): Promise<Track | null> => {
    try {
      const metadataResponse = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
      if (!metadataResponse.ok) return null;
      const metadata = await metadataResponse.json() as { metadata?: Record<string, unknown>; files?: unknown[] };
      const first = (value: unknown) => Array.isArray(value) ? String(value[0] ?? "") : value == null ? "" : String(value);
      const licenseUrl = first(metadata.metadata?.licenseurl) || first(doc.licenseurl);
      if (!/^https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses|publicdomain)\//i.test(licenseUrl)) return null;
      const files = (metadata.files ?? []) as Array<{ name?: string; format?: string; size?: string; title?: string | string[]; track?: string; source?: string; original?: string; bitrate?: string; artist?: string | string[]; creator?: string | string[] }>;
      const file = files
        .filter((item) => item.name?.toLowerCase().endsWith(".mp3") && /vbr mp3|mp3/i.test(item.format ?? "") && Number(item.size ?? 0) > 500000)
        .sort((left, right) => {
          const score = (item: typeof left) => (item.source === "original" ? 3 : item.format === "VBR MP3" ? 2 : /64kb/i.test(item.name ?? "") ? 0 : 1) * 1_000_000_000 + Number(item.bitrate ?? 0) * 1_000_000 + Number(item.size ?? 0);
          return score(right) - score(left);
        })[0];
      if (!file?.name) return null;
      const creator = first(file.artist) || first(file.creator) || first(metadata.metadata?.creator) || first(doc.creator);
      return {
        id: `${doc.identifier}/${file.name}`,
        title: first(file.title) || first(doc.title) || file.name.replace(/_(?:vbr|64kb)(?=\.mp3$)/i, "").replace(/\.mp3$/i, "").replace(/_/g, " "),
        artist: creator || "Internet Archive",
        cover: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
        stream: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${file.name.split("/").map(encodeURIComponent).join("/")}`,
        sourceUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
        licenseUrl,
        source: "archive",
      };
    } catch { return null; }
  }));
  return candidates.filter((track): track is Track => Boolean(track));
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [groups, setGroups] = useState<Group[]>(FALLBACK_GROUPS);
  const [selectedGroup, setSelectedGroup] = useState(8954);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [events, setEvents] = useState<StudyEvent[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [homeworkForm, setHomeworkForm] = useState(emptyHomework);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [editingHomework, setEditingHomework] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [registrationName, setRegistrationName] = useState("");
  const [registrationGroup, setRegistrationGroup] = useState(8954);
  const [profileName, setProfileName] = useState("");
  const [profileGroup, setProfileGroup] = useState(8954);
  const [profileBusy, setProfileBusy] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicQuery, setMusicQuery] = useState("");
  const [musicResults, setMusicResults] = useState<Track[]>([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [track, setTrack] = useState<Track>(defaultTrack);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.45);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleLessons, setScheduleLessons] = useState<ScheduleLesson[]>([]);
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduleYear, setScheduleYear] = useState("");
  const [scheduleSource, setScheduleSource] = useState<"proxy" | "direct" | "">("");
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleUseIframe, setScheduleUseIframe] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const autoPlayRef = useRef(false);
  const catalogLoadedRef = useRef(false);
  const musicRequestRef = useRef(0);
  const audioErrorsRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const synthNodesRef = useRef<OscillatorNode[]>([]);
  const synthGainRef = useRef<GainNode | null>(null);

  const selectedGroupInfo = groups.find((group) => group.id === selectedGroup) ?? groups[0];
  const canManage = profile?.role === "super_admin" || (profile?.role === "group_admin" && profile.groupId === selectedGroup);
  const upcomingHomework = useMemo(() => homework.filter((item) => !item.done).sort((a, b) => a.due.localeCompare(b.due)), [homework]);
  const upcomingEvents = useMemo(() => [...events].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), [events]);
  const scheduleRange = useMemo(() => scheduleWeekRange(scheduleDate), [scheduleDate]);
  const scheduleDays = useMemo(() => {
    const days = new Map<string, ScheduleLesson[]>();
    scheduleLessons
      .filter((lesson) => lesson.date >= scheduleRange.start && lesson.date <= scheduleRange.end)
      .forEach((lesson) => days.set(lesson.date, [...(days.get(lesson.date) ?? []), lesson]));
    return [...days.entries()].map(([date, lessons]) => ({ date, lessons }));
  }, [scheduleLessons, scheduleRange]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  };

  const refreshData = async (groupId = selectedGroup) => {
    try {
      let response = await apiFetch(`/api/data?groupId=${groupId}`, { cache: "no-store" });
      if (response.status === 401 && sessionStorage.getItem(TOKEN_KEY)) {
        sessionStorage.removeItem(TOKEN_KEY);
        response = await apiFetch(`/api/data?groupId=${groupId}`, { cache: "no-store" });
      }
      if (!response.ok) throw new Error("Не удалось загрузить данные");
      const data = await response.json() as {
        groups: Group[]; homework: Homework[]; events: StudyEvent[]; profile: Profile | null;
        signedIn?: boolean;
      };
      setGroups(data.groups);
      setHomework(data.homework);
      setEvents(data.events);
      setProfile(data.profile);
      setSignedIn(Boolean(data.profile ?? data.signedIn));
    } catch { showNotice("Серверная база запускается — обновите страницу через пару секунд"); }
    setReady(true);
  };

  useEffect(() => {
    const authResult = new URLSearchParams(location.hash.slice(1));
    const returnedCode = authResult.get("code");
    const authError = authResult.get("auth_error");
    if (returnedCode) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      if (/^[A-Za-z0-9_-]{43}$/.test(returnedCode)) {
        void apiFetch("/api/auth/exchange", { method: "POST", body: JSON.stringify({ code: returnedCode }) }).then(async (response) => {
          const data = await response.json().catch(() => ({})) as { token?: string; error?: string };
          if (!response.ok || !data.token || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Error(data.error || "Не удалось завершить вход");
          sessionStorage.setItem(TOKEN_KEY, data.token);
          const meResponse = await apiFetch("/api/auth/me", { cache: "no-store" });
          if (!meResponse.ok) throw new Error("Не удалось загрузить профиль");
          const me = await meResponse.json() as { profile?: Profile };
          if (!me.profile) throw new Error("Профиль не найден");
          setProfile(me.profile);
          setSignedIn(true);
          if (me.profile.groupId) setSelectedGroup(me.profile.groupId);
          await refreshData(me.profile.groupId ?? selectedGroup);
        }).catch((error) => showNotice(error instanceof Error ? error.message : "Не удалось завершить вход"));
      } else {
        showNotice("Некорректный код входа. Попробуйте ещё раз");
      }
    } else if (authError) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      showNotice("Не удалось завершить вход. Попробуйте ещё раз");
    }
    const saved = Number(localStorage.getItem("pogostik-selected-group"));
    const savedIsValid = FALLBACK_GROUPS.some((group) => group.id === saved);
    if (savedIsValid) setSelectedGroup(saved);
    else void refreshData(8954);

    if (sessionStorage.getItem(TOKEN_KEY)) {
      void apiFetch("/api/auth/me", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) sessionStorage.removeItem(TOKEN_KEY);
          return;
        }
        const data = await response.json() as { profile?: Profile };
        if (data.profile) {
          setProfile(data.profile);
          setSignedIn(true);
          if (data.profile.groupId && !savedIsValid) setSelectedGroup(data.profile.groupId);
        }
      }).catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("pogostik-selected-group", String(selectedGroup));
    void refreshData(selectedGroup);
    setScheduleLoaded(false);
    setScheduleLessons([]);
    setScheduleError("");
    setScheduleSource("");
    setScheduleUseIframe(false);
  }, [selectedGroup]);
  useEffect(() => {
    if (!profile) return;
    setProfileName(profile.displayName);
    setProfileGroup(profile.groupId ?? selectedGroup);
    setRegistrationName(profile.displayName);
    setRegistrationGroup(profile.groupId ?? selectedGroup);
  }, [profile?.id, profile?.displayName, profile?.groupId]);

  useEffect(() => {
    let ticking = false;
    const update = () => { document.documentElement.style.setProperty("--page-scroll", `${window.scrollY}px`); ticking = false; };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  const navigate = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const setScheduleAnchor = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (scheduleYear && academicYearForDate(date) !== scheduleYear) {
      setScheduleLoaded(false);
      setScheduleLessons([]);
      setScheduleError("");
    }
    setScheduleDate(date);
  };

  const shiftScheduleWeek = (weeks: number) => {
    const next = new Date(`${scheduleDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + weeks * 7);
    setScheduleAnchor(next.toISOString().slice(0, 10));
  };

  const loadSchedule = async () => {
    const year = academicYearForDate(scheduleDate);
    setScheduleLoaded(true);
    setScheduleLoading(true);
    setScheduleError("");
    setScheduleUseIframe(false);
    try {
      const response = await apiFetch(`/api/schedule?groupId=${selectedGroup}&year=${encodeURIComponent(year)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { lessons?: ScheduleLesson[]; error?: string };
      if (!response.ok || !Array.isArray(data.lessons)) throw new Error(data.error || "Прокси ЭИОС недоступен");
      setScheduleLessons(data.lessons);
      setScheduleYear(year);
      setScheduleSource("proxy");
      return;
    } catch {
      try {
        const directUrl = new URL("https://eios.kosgos.ru/api/Rasp");
        directUrl.searchParams.set("idGroup", String(selectedGroup));
        directUrl.searchParams.set("year", year);
        const response = await fetch(directUrl, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw new Error("ЭИОС недоступен");
        const normalized = normalizeEiosSchedule(await response.json());
        setScheduleLessons(normalized.lessons);
        setScheduleYear(year);
        setScheduleSource("direct");
        return;
      } catch {
        setScheduleLessons([]);
        setScheduleSource("");
        setScheduleError("ЭИОС заблокировал сетевой запрос. Отключите VPN или откройте официальное расписание ниже.");
      }
    } finally {
      setScheduleLoading(false);
    }
  };

  const openAuth = () => {
    location.assign(`${REMOTE_API_ORIGIN}/api/auth/start`);
  };

  const apiMutation = async (url: string, method: string, body: object) => {
    const response = await apiFetch(url, { method, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string; [key: string]: unknown };
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить");
    return data;
  };

  const logout = async () => {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch { /* local logout still succeeds */ }
    sessionStorage.removeItem(TOKEN_KEY);
    setProfile(null);
    setSignedIn(false);
    setView("home");
    await refreshData(selectedGroup);
    showNotice("Вы вышли из аккаунта");
  };

  const completeOnboarding = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    setProfileBusy(true);
    try {
      const data = await apiMutation("/api/profile", "PUT", { displayName: registrationName, groupId: registrationGroup }) as { profile?: Profile };
      const nextProfile = data.profile ?? { ...profile, displayName: registrationName, groupId: registrationGroup };
      setProfile(nextProfile);
      setSelectedGroup(registrationGroup);
      showNotice("Профиль готов");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Не удалось сохранить профиль"); }
    finally { setProfileBusy(false); }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    setProfileBusy(true);
    try {
      const body: { displayName: string; groupId?: number } = { displayName: profileName };
      if (profile.role !== "group_admin") body.groupId = profileGroup;
      const data = await apiMutation("/api/profile", "PUT", body) as { profile?: Profile };
      const nextProfile = data.profile ?? { ...profile, displayName: profileName, groupId: body.groupId ?? profile.groupId };
      setProfile(nextProfile);
      if (nextProfile.groupId) setSelectedGroup(nextProfile.groupId);
      showNotice("Профиль сохранён");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Не удалось сохранить профиль"); }
    finally { setProfileBusy(false); }
  };

  const saveHomework = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiMutation("/api/homework", editingHomework ? "PUT" : "POST", { id: editingHomework, groupId: selectedGroup, ...homeworkForm, done: homework.find((item) => item.id === editingHomework)?.done ?? false });
      setHomeworkForm(emptyHomework); setEditingHomework(null); await refreshData(); showNotice("Домашнее задание сохранено");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка сохранения"); }
  };

  const editHomework = (item: Homework) => { setHomeworkForm({ subject: item.subject, title: item.title, details: item.details, due: item.due }); setEditingHomework(item.id); };
  const updateHomework = async (item: Homework, patch: Partial<Homework>) => {
    try { await apiMutation("/api/homework", "PUT", { ...item, ...patch }); await refreshData(); }
    catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка"); }
  };
  const deleteHomework = async (id: string) => { try { await apiMutation("/api/homework", "DELETE", { id }); await refreshData(); } catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка"); } };

  const saveEvent = async (event: FormEvent) => {
    event.preventDefault();
    try { await apiMutation("/api/events", editingEvent ? "PUT" : "POST", { id: editingEvent, groupId: selectedGroup, ...eventForm }); setEventForm(emptyEvent); setEditingEvent(null); await refreshData(); showNotice("Мероприятие сохранено"); }
    catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка сохранения"); }
  };
  const deleteEvent = async (id: string) => { try { await apiMutation("/api/events", "DELETE", { id }); await refreshData(); } catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка"); } };

  const loadAdminUsers = async () => {
    try { const response = await apiFetch("/api/admin/users", { cache: "no-store" }); const data = await response.json() as { error?: string; users?: AdminUser[] }; if (!response.ok) throw new Error(data.error); setAdminUsers(data.users ?? []); }
    catch (error) { showNotice(error instanceof Error ? error.message : "Не удалось загрузить пользователей"); }
  };
  useEffect(() => { if (view === "admin" && profile?.role === "super_admin") void loadAdminUsers(); }, [view, profile?.role]);

  const saveAdminUser = async (user: AdminUser, changes: Pick<Profile, "displayName" | "groupId" | "role">) => {
    try {
      await apiMutation(`/api/admin/users/${encodeURIComponent(user.id)}`, "PUT", changes);
      await loadAdminUsers();
      showNotice("Профиль пользователя сохранён");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка изменения профиля"); }
  };

  const stopSynth = () => {
    synthNodesRef.current.forEach((node) => { try { node.stop(); } catch { /* already stopped */ } });
    synthNodesRef.current = [];
    synthGainRef.current?.disconnect();
    synthGainRef.current = null;
  };

  const startSynth = async () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const context = audioContextRef.current || new AudioCtx();
    audioContextRef.current = context;
    await context.resume();
    stopSynth();
    const gain = context.createGain();
    gain.gain.value = volume * .12;
    gain.connect(context.destination);
    synthGainRef.current = gain;
    synthNodesRef.current = [110, 164.81, 220, 329.63].map((frequency, index) => {
      const oscillator = context.createOscillator(); const localGain = context.createGain();
      oscillator.type = index % 2 ? "triangle" : "sine"; oscillator.frequency.value = frequency; localGain.gain.value = index ? .17 : .4;
      oscillator.connect(localGain).connect(gain); oscillator.start(); return oscillator;
    });
  };

  const toggleMusic = async () => {
    if (playing) { audioRef.current?.pause(); stopSynth(); setPlaying(false); return; }
    try {
      if (track.source === "synth") await startSynth();
      else if (audioRef.current) await audioRef.current.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      showNotice("Этот поток не запустился — выбираю следующий трек");
    }
  };
  useEffect(() => { if (synthGainRef.current) synthGainRef.current.gain.value = volume * .12; if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => () => stopSynth(), []);
  useEffect(() => {
    if (!autoPlayRef.current || track.source === "synth") return;
    autoPlayRef.current = false;
    const timer = window.setTimeout(() => { void audioRef.current?.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }, 80);
    return () => clearTimeout(timer);
  }, [track]);

  const chooseTrack = async (nextTrack: Track) => {
    audioRef.current?.pause(); stopSynth(); setPlaying(false);
    if (nextTrack.source === "synth") { setTrack(nextTrack); await startSynth(); setPlaying(true); }
    else { autoPlayRef.current = true; setTrack(nextTrack); }
  };

  const searchMusic = async (event: FormEvent) => {
    event.preventDefault(); if (!musicQuery.trim()) return;
    const requestId = ++musicRequestRef.current;
    setMusicLoading(true); catalogLoadedRef.current = true;
    try {
      let results = await findAudiusTracks(musicQuery.trim());
      if (!results.length) results = await findArchiveTracks(musicQuery.trim());
      if (!results.length) { results = await findAudiusTracks(); results.sort(() => Math.random() - .5); showNotice("Точного совпадения нет — включил свежую случайную подборку"); }
      if (requestId === musicRequestRef.current) setMusicResults(results);
    } catch {
      if (requestId === musicRequestRef.current) { setMusicResults([]); showNotice("Музыкальный каталог временно недоступен"); }
    }
    if (requestId === musicRequestRef.current) setMusicLoading(false);
  };

  const loadTrendingMusic = async () => {
    const requestId = ++musicRequestRef.current;
    setMusicLoading(true);
    try {
      const results = await findAudiusTracks();
      if (requestId === musicRequestRef.current) setMusicResults(results.sort(() => Math.random() - .5));
    } catch { if (requestId === musicRequestRef.current) showNotice("Не удалось загрузить свежую подборку"); }
    if (requestId === musicRequestRef.current) setMusicLoading(false);
  };

  useEffect(() => {
    if (!musicOpen || catalogLoadedRef.current) return;
    catalogLoadedRef.current = true;
    void loadTrendingMusic();
  }, [musicOpen]);

  const playNextTrack = async () => {
    let queue = musicResults;
    if (!queue.length) {
      try {
        queue = await findAudiusTracks();
        queue.sort(() => Math.random() - .5);
        if (!queue.length) queue = await findArchiveTracks(randomMusicTerms[Math.floor(Math.random() * randomMusicTerms.length)]);
        setMusicResults(queue);
      }
      catch { queue = []; }
    }
    if (!queue.length) { setTrack(defaultTrack); await startSynth(); setPlaying(true); return; }
    const currentIndex = queue.findIndex((item) => item.id === track.id);
    const next = queue[(currentIndex + 1 + queue.length) % queue.length];
    if (next.id === track.id && audioRef.current) {
      audioRef.current.currentTime = 0;
      try { await audioRef.current.play(); } catch { setPlaying(false); }
    }
    else { autoPlayRef.current = true; setTrack(next); }
  };

  const handleAudioError = () => {
    setPlaying(false);
    audioErrorsRef.current += 1;
    if (audioErrorsRef.current > 5) {
      setTrack(defaultTrack);
      showNotice("Потоки недоступны — оставил бесконечный Pixel Focus");
      return;
    }
    void playNextTrack();
  };

  return (
    <main>
      {notice && <div className="toast">{notice}</div>}
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")} aria-label="На главную"><span className="pixel-logo" aria-hidden="true"><i/><i/><i/><i/></span><span><b>by pogostik</b><small>student OS · КГУ</small></span></button>
        <nav aria-label="Главная навигация">
          {([["home","Сегодня"],["schedule","Расписание"],["homework","Домашка"],["events","Мероприятия"]] as [View,string][]).map(([key,label]) => <button key={key} className={view === key ? "active" : ""} onClick={() => navigate(key)}>{label}</button>)}
          {profile && <button className={view === "profile" ? "active" : ""} onClick={() => navigate("profile")}>Профиль</button>}
          {profile?.role === "super_admin" && <button className={view === "admin" ? "active" : ""} onClick={() => navigate("admin")}>Админ</button>}
        </nav>
        <div className="header-tools">
          <label className="group-select"><span className="status-dot"/><select aria-label="Учебная группа" value={selectedGroup} onChange={(event) => setSelectedGroup(Number(event.target.value))}>{groups.map((group) => <option key={group.id} value={group.id}>{group.code}</option>)}</select></label>
          {profile ? <button className="account-chip" onClick={() => navigate("profile")} title="Открыть профиль"><b>{profile.displayName.slice(0,1).toUpperCase()}</b><span>{profile.displayName}<small>{profile.role === "super_admin" ? "главный админ" : profile.role === "group_admin" ? "админ группы" : "студент"}</small></span></button> : <button className="account-login" onClick={openAuth}>Войти</button>}
        </div>
      </header>

      {view === "home" && <>
        <section className="hero section-shell">
          <div className="hero-copy"><span className="eyebrow">// учебный хаб · {selectedGroupInfo?.code}</span><h1>Учёба.<br/><span>Без хаоса.</span></h1><p>Расписание, дедлайны, события и полная музыка для фокуса — в одном пространстве для первокурсников Высшей IT‑школы.</p><div className="hero-actions"><button className="primary-button" onClick={() => navigate("schedule")}>Смотреть пары <span>→</span></button><button className="ghost-button" onClick={() => navigate("homework")}>{canManage ? "+ Добавить ДЗ" : "Смотреть ДЗ"}</button></div><div className="mini-stats"><span><b>{upcomingHomework.length}</b> задач впереди</span><span><b>{upcomingEvents.length}</b> событий</span><span><b>{groups.length}</b> групп 2026</span></div></div>
          <div className="hero-visual" aria-label="Студенты Высшей IT-школы"><div className="circuit-grid"/><img src="/photos/students.webp" alt="Студенты Высшей IT-школы КГУ"/><div className="floating-card top-card"><span>ON AIR</span><b>FOCUS MODE</b></div><div className="floating-card bottom-card"><b>HIGHER IT SCHOOL</b><small>KOSTROMA</small></div></div>
        </section>
        <section className="dashboard section-shell">
          <div className="section-heading"><div><span className="eyebrow">// {selectedGroupInfo?.code}</span><h2>На радаре</h2></div><span className="live-label"><i/> общая база группы</span></div>
          <div className="dashboard-grid">
            <article className="panel deadline-panel"><div className="panel-title"><h3>Домашние задания</h3><button onClick={() => navigate("homework")}>Все →</button></div><div className="task-preview-list">{upcomingHomework.slice(0,3).map((item,index) => <button className="task-preview" key={item.id} onClick={() => navigate("homework")}><span className={`subject-mark color-${index%3}`}>{item.subject.slice(0,2).toUpperCase()}</span><span><b>{item.title}</b><small>{item.subject}</small></span><time>{formatDate(item.due,true)}</time></button>)}{ready && !upcomingHomework.length && <div className="empty-state">Для этой группы заданий пока нет ✦</div>}</div></article>
            <article className="panel event-panel"><div className="panel-title"><h3>События</h3><button onClick={() => navigate("events")}>{canManage ? "Добавить +" : "Все →"}</button></div>{upcomingEvents[0] ? <div className="next-event"><div className="calendar-tile"><b>{new Date(`${upcomingEvents[0].date}T12:00:00`).getDate()}</b><span>{new Date(`${upcomingEvents[0].date}T12:00:00`).toLocaleDateString("ru-RU",{month:"short"})}</span></div><div><span className="tag">NEXT EVENT</span><h4>{upcomingEvents[0].title}</h4><p>{upcomingEvents[0].time || "Весь день"} · {upcomingEvents[0].details || "Событие группы"}</p></div></div> : <div className="empty-state">Пока ничего не запланировано</div>}</article>
          </div>
        </section>
        <section className="campus-scroll"><div className="campus-sticky"><div className="campus-photo campus-main"><img src="/photos/campus.webp" alt="Корпус Высшей IT-школы КГУ"/></div><div className="campus-copy"><span className="eyebrow light">// здесь создают будущее</span><h2>Твой кампус.<br/>Твоя среда.</h2><p>Новый корпус Высшей IT‑школы — пространство для кода, командной работы и больших идей.</p><a href="https://itschool.kosgos.ru/campus" target="_blank" rel="noreferrer">Открыть 3D‑экскурсию →</a></div><div className="campus-photo campus-side"><img src="/photos/hallway.webp" alt="Интерьер Высшей IT-школы"/></div><div className="campus-photo campus-tiny"><img src="/photos/lab.webp" alt="Компьютерный класс Высшей IT-школы"/></div></div></section>
      </>}

      {view === "schedule" && <section className="workspace-page section-shell">
        <div className="page-intro"><div><span className="eyebrow">// ЭИОС КГУ · {selectedGroupInfo?.code}</span><h1>Расписание</h1><p>Пары выбранной группы прямо на сайте: дата, время, предмет, преподаватель, аудитория и замены.</p></div><a className="primary-button link-button" href={selectedGroupInfo?.eiosUrl} target="_blank" rel="noreferrer">Открыть в ЭИОС ↗</a></div>
        <div className="group-tabs">{groups.map((group) => <button className={group.id === selectedGroup ? "active" : ""} key={group.id} onClick={() => setSelectedGroup(group.id)}>{group.code}</button>)}</div>
        <div className="schedule-notice"><span className="status-dot"/><b>Официальный API ЭИОС</b><p>Данные не копируются вручную: сайт получает актуальные пары, преподавателей и аудитории из расписания КГУ.</p></div>
        <div className="schedule-toolbar">
          <button type="button" aria-label="Предыдущая неделя" onClick={() => shiftScheduleWeek(-1)}>←</button>
          <label><span>Неделя с</span><input type="date" value={scheduleDate} onChange={(event) => setScheduleAnchor(event.target.value)}/></label>
          <button type="button" aria-label="Следующая неделя" onClick={() => shiftScheduleWeek(1)}>→</button>
          <strong>{formatDate(scheduleRange.start, true)} — {formatDate(scheduleRange.end, true)}</strong>
          {scheduleLoaded && !scheduleLoading && <button className="schedule-refresh" type="button" onClick={() => void loadSchedule()}>обновить ↻</button>}
        </div>
        {!scheduleLoaded ? <button className="schedule-loader" onClick={() => void loadSchedule()}><span className="pixel-calendar"><i>{new Date(`${scheduleRange.start}T12:00:00`).getDate()}</i><b>{new Date(`${scheduleRange.start}T12:00:00`).toLocaleDateString("ru-RU", { month: "short" })}</b></span><span><b>Загрузить {selectedGroupInfo?.code}</b><small>{academicYearForDate(scheduleDate)} · предметы, преподаватели и аудитории из ЭИОС</small></span><strong>→</strong></button>
        : scheduleLoading ? <div className="schedule-loading"><span className="pixel-loader"/><b>Получаю расписание из ЭИОС…</b></div>
        : scheduleError ? <div className="schedule-error"><span className="eyebrow">// соединение с ЭИОС</span><h2>Расписание не загрузилось</h2><p>{scheduleError}</p><div><button className="primary-button" onClick={() => void loadSchedule()}>Повторить</button><button className="ghost-button" onClick={() => setScheduleUseIframe((value) => !value)}>{scheduleUseIframe ? "Скрыть окно" : "Показать ЭИОС здесь"}</button></div></div>
        : <div className="schedule-board">
          <div className="schedule-source"><span className="status-dot"/><b>{scheduleSource === "direct" ? "Прямое соединение с ЭИОС" : "Синхронизировано с ЭИОС"}</b><small>{scheduleYear}</small></div>
          {scheduleDays.map((day) => <section className="schedule-day" key={day.date}><header><time>{formatDate(day.date)}</time><span>{day.lessons.length} {day.lessons.length === 1 ? "пара" : day.lessons.length < 5 ? "пары" : "пар"}</span></header><div className="lesson-list">{day.lessons.map((lesson) => <article className={`lesson-card ${lesson.replacement ? "replacement" : ""}`} style={{ "--lesson-color": lesson.color } as React.CSSProperties} key={lesson.id}><div className="lesson-time"><b>{lesson.start || "—"}</b><span>{lesson.end || ""}</span>{lesson.lessonNumber && <small>{lesson.lessonNumber} пара</small>}</div><div className="lesson-main"><div className="lesson-badges"><span>{lessonType(lesson.subject)}</span>{lesson.subgroup != null && lesson.subgroup > 0 && <span>п/г {lesson.subgroup}</span>}{lesson.replacement && <span className="replacement-badge">замена</span>}</div><h3>{cleanLessonTitle(lesson.subject) || "Занятие"}</h3><div className="lesson-meta"><span>👤 {lesson.teacher || "Преподаватель не указан"}</span><span>⌖ {lesson.room ? `ауд. ${lesson.room}` : "Аудитория не указана"}</span></div></div></article>)}</div></section>)}
          {!scheduleDays.length && <div className="empty-state large">На неделе {formatDate(scheduleRange.start, true)} — {formatDate(scheduleRange.end, true)} занятий нет</div>}
        </div>}
        {scheduleUseIframe && <div className="schedule-frame-wrap"><div className="browser-bar"><i/><i/><i/><span>eios.kosgos.ru · {selectedGroupInfo?.code}</span></div><iframe key={selectedGroup} title={`Расписание ${selectedGroupInfo?.code}`} src={selectedGroupInfo?.eiosUrl} className="schedule-frame"/></div>}
      </section>}

      {view === "homework" && <section className="workspace-page section-shell"><div className="page-intro"><div><span className="eyebrow">// {selectedGroupInfo?.code}</span><h1>Домашка</h1><p>Общие задания группы. Публиковать и редактировать их может только назначенный администратор.</p></div><span className="big-counter">{upcomingHomework.length}<small>активно</small></span></div><div className={`crud-grid ${!canManage ? "viewer" : ""}`}><div className="items-column"><div className="filter-row"><span>Все задания</span><span>{homework.length} всего</span></div>{homework.map((item) => <article className={`crud-item ${item.done ? "done" : ""}`} key={item.id}>{canManage ? <button className="pixel-check" aria-label={item.done ? "Вернуть задание" : "Завершить задание"} onClick={() => updateHomework(item,{done:!item.done})}>{item.done ? "✓" : ""}</button> : <span className="pixel-check readonly">{item.done ? "✓" : ""}</span>}<div className="crud-body"><span className="tag">{item.subject}</span><h3>{item.title}</h3>{item.details && <p>{item.details}</p>}<time>Сделать: {formatDate(item.due)}</time></div>{canManage && <div className="item-actions"><button onClick={() => editHomework(item)}>ред.</button><button className="danger" onClick={() => deleteHomework(item.id)}>×</button></div>}</article>)}{ready && !homework.length && <div className="empty-state large">Администратор группы ещё не добавил задания</div>}</div>{canManage ? <form className="editor-panel" onSubmit={saveHomework}><span className="eyebrow">// {editingHomework ? "редактирование" : "новая задача"}</span><h2>{editingHomework ? "Изменить ДЗ" : "Добавить ДЗ"}</h2><label>Предмет<select value={homeworkForm.subject} onChange={(e) => setHomeworkForm({...homeworkForm,subject:e.target.value})}><option>Программирование</option><option>Математика</option><option>Английский язык</option><option>Информатика</option><option>Физкультура</option><option>Другое</option></select></label><label>Что сделать<input required placeholder="Например: решить задачи 1–5" value={homeworkForm.title} onChange={(e) => setHomeworkForm({...homeworkForm,title:e.target.value})}/></label><label>Комментарий<textarea placeholder="Ссылки, страницы, детали..." value={homeworkForm.details} onChange={(e) => setHomeworkForm({...homeworkForm,details:e.target.value})}/></label><label>Срок<input required type="date" value={homeworkForm.due} onChange={(e) => setHomeworkForm({...homeworkForm,due:e.target.value})}/></label><button className="primary-button wide" type="submit">{editingHomework ? "Сохранить изменения" : `Опубликовать для ${selectedGroupInfo?.code}`}</button>{editingHomework && <button className="cancel-button" type="button" onClick={() => {setEditingHomework(null);setHomeworkForm(emptyHomework)}}>Отмена</button>}</form> : <LockedPanel signedIn={signedIn} onSignIn={openAuth}/>}</div></section>}

      {view === "events" && <section className="workspace-page section-shell"><div className="page-intro"><div><span className="eyebrow">// {selectedGroupInfo?.code}</span><h1>Мероприятия</h1><p>Демки, встречи и хакатоны выбранной группы — всё по датам.</p></div><span className="big-counter">{events.length}<small>событий</small></span></div><div className={`crud-grid ${!canManage ? "viewer" : ""}`}><div className="items-column event-list">{upcomingEvents.map((item) => <article className="crud-item" key={item.id}><div className="event-date"><b>{new Date(`${item.date}T12:00:00`).getDate()}</b><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString("ru-RU",{month:"short"})}</span></div><div className="crud-body"><span className="tag">{item.time || "Весь день"}</span><h3>{item.title}</h3><p>{item.details || "Без описания"}</p><time>{formatDate(item.date)}</time></div>{canManage && <div className="item-actions"><button onClick={() => {setEventForm({title:item.title,details:item.details,date:item.date,time:item.time});setEditingEvent(item.id)}}>ред.</button><button className="danger" onClick={() => deleteEvent(item.id)}>×</button></div>}</article>)}{ready && !events.length && <div className="empty-state large">В календаре группы пока пусто</div>}</div>{canManage ? <form className="editor-panel" onSubmit={saveEvent}><span className="eyebrow">// {editingEvent ? "редактирование" : "новое событие"}</span><h2>{editingEvent ? "Изменить" : "Запланировать"}</h2><label>Название<input required placeholder="Например: IT‑хакатон" value={eventForm.title} onChange={(e) => setEventForm({...eventForm,title:e.target.value})}/></label><label>Описание<textarea placeholder="Место, команда, что взять..." value={eventForm.details} onChange={(e) => setEventForm({...eventForm,details:e.target.value})}/></label><div className="split-fields"><label>Дата<input required type="date" value={eventForm.date} onChange={(e) => setEventForm({...eventForm,date:e.target.value})}/></label><label>Время<input type="time" value={eventForm.time} onChange={(e) => setEventForm({...eventForm,time:e.target.value})}/></label></div><button className="primary-button wide" type="submit">{editingEvent ? "Сохранить изменения" : `Опубликовать для ${selectedGroupInfo?.code}`}</button>{editingEvent && <button className="cancel-button" type="button" onClick={() => {setEditingEvent(null);setEventForm(emptyEvent)}}>Отмена</button>}</form> : <LockedPanel signedIn={signedIn} onSignIn={openAuth}/>}</div></section>}

      {view === "profile" && profile && <section className="workspace-page section-shell profile-page"><div className="page-intro"><div><span className="eyebrow">// личный кабинет</span><h1>Профиль</h1><p>Имя и группа используются в общем учебном пространстве.</p></div></div><div className="profile-grid"><aside className="profile-card"><span className="profile-avatar">{profile.displayName.slice(0,1).toUpperCase()}</span><span className="role-pill">{profile.role === "super_admin" ? "OWNER · главный админ" : profile.role === "group_admin" ? "администратор группы" : "студент"}</span><h2>{profile.displayName}</h2><p>{profile.email}</p><small>{groups.find((group) => group.id === profile.groupId)?.code ?? "Группа не выбрана"}</small></aside><form className="editor-panel profile-form" onSubmit={saveProfile}><span className="eyebrow">// настройки аккаунта</span><h2>Изменить профиль</h2><label>Как тебя показывать<input required minLength={2} maxLength={60} value={profileName} onChange={(event) => setProfileName(event.target.value)}/></label><label>Учебная группа<select value={profileGroup} disabled={profile.role === "group_admin"} onChange={(event) => setProfileGroup(Number(event.target.value))}>{groups.map((group) => <option key={group.id} value={group.id}>{group.code}</option>)}</select></label>{profile.role === "group_admin" && <p className="field-note">Чтобы права администратора не перенеслись в другую группу, группу меняет главный администратор.</p>}<button className="primary-button wide" type="submit" disabled={profileBusy}>{profileBusy ? "Сохраняю..." : "Сохранить изменения"}</button><button className="logout-button wide" type="button" onClick={() => void logout()}>Выйти из аккаунта</button></form></div></section>}

      {view === "admin" && profile?.role === "super_admin" && <section className="workspace-page section-shell admin-page"><div className="page-intro"><div><span className="eyebrow">// управление доступом</span><h1>Админка</h1><p>Редактируй имена и группы пользователей, назначай ответственных за ДЗ и мероприятия.</p></div></div><div className="users-panel"><div className="panel-title"><h3>Зарегистрированные пользователи</h3><button onClick={loadAdminUsers}>Обновить ↻</button></div><div className="users-head"><span>#</span><span>Профиль</span><span>Группа</span><span>Роль и действие</span></div>{adminUsers.map((user) => <AdminUserEditor key={user.id} user={user} groups={groups} locked={user.email.toLowerCase() === "vasmat2009@gmail.com" || user.role === "super_admin"} onSave={saveAdminUser}/>)}{!adminUsers.length && <div className="empty-state large">Пользователи появятся здесь после первого входа</div>}</div></section>}

      {profile && profile.groupId === null && <div className="modal-backdrop"><form className="registration-card" onSubmit={completeOnboarding}><span className="pixel-logo large-logo" aria-hidden="true"><i/><i/><i/><i/></span><span className="eyebrow">// первый вход</span><h2>Добро пожаловать</h2><p>Выбери имя и свою группу. Их можно будет изменить позже во вкладке «Профиль».</p><label>Как тебя показывать<input required minLength={2} maxLength={60} value={registrationName} onChange={(e) => setRegistrationName(e.target.value)}/></label><label>Твоя группа<select value={registrationGroup} onChange={(e) => setRegistrationGroup(Number(e.target.value))}>{groups.map((group) => <option key={group.id} value={group.id}>{group.code}</option>)}</select></label><button className="primary-button wide" disabled={profileBusy}>{profileBusy ? "Сохраняю..." : "Завершить регистрацию"}</button><button className="logout-button wide" type="button" onClick={() => void logout()}>Выйти из аккаунта</button></form></div>}

      <aside className={`music-player ${musicOpen ? "open" : ""}`}>{musicOpen && <div className="music-library"><div className="library-head"><span><small>// audius + open music db</small><b>Современные полные треки</b></span><button onClick={() => setMusicOpen(false)} aria-label="Свернуть музыку">×</button></div><form className="music-search" onSubmit={searchMusic}><input value={musicQuery} onChange={(e) => setMusicQuery(e.target.value)} placeholder="Русский / зарубежный артист или трек..."/><button type="submit" aria-label="Найти">⌕</button></form><button className={`track-row ${track.id === defaultTrack.id ? "selected" : ""}`} onClick={() => chooseTrack(defaultTrack)}><span className="synth-cover">♪</span><span><b>Pixel Focus</b><small>Бесконечный эмбиент · без слов</small></span></button><div className="search-results">{musicLoading && <div className="music-status">Ищу полные треки...</div>}{!musicLoading && musicResults.map((item) => <button className={`track-row ${track.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => chooseTrack(item)}>{item.cover ? <img src={item.cover} alt=""/> : <span className="synth-cover">♪</span>}<span><b>{item.title}</b><small>{item.artist} · полный трек</small></span></button>)}{!musicLoading && musicQuery && !musicResults.length && <div className="music-status">Нет результатов — после текущего трека включится случайная подборка.</div>}</div></div>}<div className="now-playing"><button className="cover-button" onClick={() => setMusicOpen((value) => !value)} aria-label="Открыть музыкальную библиотеку">{track.cover ? <img src={track.cover} alt=""/> : <span className="synth-cover pixel-disc">♪</span>}</button><div className="track-info"><button onClick={() => setMusicOpen((value) => !value)}><b>{track.title}</b><small>{track.artist}</small></button>{track.sourceUrl && <span className="track-links"><a href={track.sourceUrl} target="_blank" rel="noreferrer">{track.source === "audius" ? "Audius" : "Archive"} ↗</a>{track.licenseUrl && <a href={track.licenseUrl} target="_blank" rel="noreferrer">CC</a>}</span>}</div><button className="play-button" onClick={toggleMusic} aria-label={playing ? "Пауза" : "Воспроизвести"}>{playing ? "Ⅱ" : "▶"}</button><input className="volume" aria-label="Громкость" type="range" min="0" max="1" step=".05" value={volume} onChange={(e) => setVolume(Number(e.target.value))}/></div><audio ref={audioRef} preload="auto" src={track.stream} onEnded={() => void playNextTrack()} onError={handleAudioError} onPlay={() => { audioErrorsRef.current = 0; setPlaying(true); }} onPause={() => track.source !== "synth" && setPlaying(false)}/></aside>
      <footer><span>© 2026 by pogostik</span><span>Для первокурсников Высшей IT‑школы КГУ</span><a href="https://itschool.kosgos.ru/" target="_blank" rel="noreferrer">itschool.kosgos.ru ↗</a></footer>
    </main>
  );
}

function AdminUserEditor({ user, groups, locked, onSave }: { user: AdminUser; groups: Group[]; locked: boolean; onSave: (user: AdminUser, changes: Pick<Profile, "displayName" | "groupId" | "role">) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [groupId, setGroupId] = useState<number | null>(user.groupId ?? groups[0]?.id ?? null);
  const [role, setRole] = useState<Role>(user.role);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDisplayName(user.displayName);
    setGroupId(user.groupId ?? groups[0]?.id ?? null);
    setRole(user.role);
  }, [user.displayName, user.groupId, user.role]);

  const submit = async () => {
    if (!displayName.trim() || groupId === null) return;
    setBusy(true);
    await onSave(user, { displayName: displayName.trim(), groupId, role: locked ? "super_admin" : role });
    setBusy(false);
  };

  return <div className="user-row"><span className="user-avatar">{displayName.slice(0,1).toUpperCase() || "?"}</span><span className="admin-profile-fields"><input aria-label={`Имя пользователя ${user.email}`} value={displayName} maxLength={60} onChange={(event) => setDisplayName(event.target.value)}/><small>{user.email}</small></span><select aria-label={`Группа пользователя ${user.displayName}`} value={groupId ?? ""} onChange={(event) => setGroupId(Number(event.target.value))}>{groups.map((group) => <option value={group.id} key={group.id}>{group.code}</option>)}</select><span className="admin-role-editor">{locked ? <span className="role-owner">OWNER · главный админ</span> : <select aria-label={`Роль пользователя ${user.displayName}`} value={role} onChange={(event) => setRole(event.target.value as "student" | "group_admin")}><option value="student">Студент</option><option value="group_admin">Админ группы</option></select>}<button className="save-user" type="button" disabled={busy || !displayName.trim()} onClick={() => void submit()}>{busy ? "..." : "Сохранить"}</button></span></div>;
}

function LockedPanel({ signedIn, onSignIn }: { signedIn: boolean; onSignIn: () => void }) {
  return <aside className="editor-panel locked-panel"><span className="pixel-lock">▣</span><span className="eyebrow">// только для админа</span><h2>Публикация закрыта</h2><p>{signedIn ? "Главный администратор должен назначить вас администратором этой группы." : "Войдите и зарегистрируйтесь. Смотреть записи можно всем, публиковать — только администраторам групп."}</p>{!signedIn && <button className="primary-button link-button" onClick={onSignIn}>Войти / регистрация</button>}</aside>;
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }
