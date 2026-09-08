"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, react/jsx-no-comment-textnodes, @next/next/no-img-element, jsx-a11y/media-has-caption */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "home" | "schedule" | "homework" | "events" | "admin";
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

const formatDate = (value: string, short = false) => new Intl.DateTimeFormat("ru-RU", short ? { day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));

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
  const [signInPath, setSignInPath] = useState("/signin-with-chatgpt?return_to=%2F");
  const [signOutPath, setSignOutPath] = useState("/signout-with-chatgpt?return_to=%2F");
  const [superAdminExists, setSuperAdminExists] = useState(true);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [homeworkForm, setHomeworkForm] = useState(emptyHomework);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [editingHomework, setEditingHomework] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [registrationName, setRegistrationName] = useState("");
  const [registrationGroup, setRegistrationGroup] = useState(8954);
  const [ownerCode, setOwnerCode] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicQuery, setMusicQuery] = useState("");
  const [musicResults, setMusicResults] = useState<Track[]>([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [track, setTrack] = useState<Track>(defaultTrack);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.45);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const autoPlayRef = useRef(false);
  const catalogLoadedRef = useRef(false);
  const audioErrorsRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const synthNodesRef = useRef<OscillatorNode[]>([]);
  const synthGainRef = useRef<GainNode | null>(null);

  const selectedGroupInfo = groups.find((group) => group.id === selectedGroup) ?? groups[0];
  const canManage = profile?.role === "super_admin" || (profile?.role === "group_admin" && profile.groupId === selectedGroup);
  const upcomingHomework = useMemo(() => homework.filter((item) => !item.done).sort((a, b) => a.due.localeCompare(b.due)), [homework]);
  const upcomingEvents = useMemo(() => [...events].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), [events]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  };

  const refreshData = async (groupId = selectedGroup) => {
    try {
      const response = await fetch(`/api/data?groupId=${groupId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось загрузить данные");
      const data = await response.json() as {
        groups: Group[]; homework: Homework[]; events: StudyEvent[]; profile: Profile | null;
        identity: { email: string; displayName: string } | null; signedIn: boolean; superAdminExists: boolean;
        signInPath: string; signOutPath: string;
      };
      setGroups(data.groups);
      setHomework(data.homework);
      setEvents(data.events);
      setProfile(data.profile);
      setSignedIn(data.signedIn);
      setSuperAdminExists(data.superAdminExists);
      setSignInPath(data.signInPath);
      setSignOutPath(data.signOutPath);
      if (data.identity && !data.profile) setRegistrationName(data.identity.displayName ?? "");
    } catch { showNotice("Серверная база запускается — обновите страницу через пару секунд"); }
    setReady(true);
  };

  useEffect(() => {
    const saved = Number(localStorage.getItem("pogostik-selected-group"));
    if (FALLBACK_GROUPS.some((group) => group.id === saved)) setSelectedGroup(saved);
    else void refreshData(8954);
  }, []);
  useEffect(() => { localStorage.setItem("pogostik-selected-group", String(selectedGroup)); void refreshData(selectedGroup); setScheduleLoaded(false); }, [selectedGroup]);

  useEffect(() => {
    let ticking = false;
    const update = () => { document.documentElement.style.setProperty("--page-scroll", `${window.scrollY}px`); ticking = false; };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  const navigate = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const openSignIn = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      event.preventDefault();
      showNotice("Вход работает на опубликованном сайте — локальный адрес не обслуживает авторизацию");
    }
  };

  const apiMutation = async (url: string, method: string, body: object) => {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string; [key: string]: unknown };
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить");
    return data;
  };

  const register = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await apiMutation("/api/register", "POST", { displayName: registrationName, groupId: registrationGroup });
      setSelectedGroup(registrationGroup);
      await refreshData(registrationGroup);
      showNotice("Регистрация завершена");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка регистрации"); }
  };

  const claimOwner = async (event: FormEvent) => {
    event.preventDefault();
    try { await apiMutation("/api/claim-admin", "POST", { code: ownerCode }); setOwnerCode(""); await refreshData(); showNotice("Вы — главный администратор"); }
    catch (error) { showNotice(error instanceof Error ? error.message : "Неверный код"); }
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
    try { const response = await fetch("/api/admin/users", { cache: "no-store" }); const data = await response.json() as { error?: string; users?: AdminUser[] }; if (!response.ok) throw new Error(data.error); setAdminUsers(data.users ?? []); }
    catch (error) { showNotice(error instanceof Error ? error.message : "Не удалось загрузить пользователей"); }
  };
  useEffect(() => { if (view === "admin" && profile?.role === "super_admin") void loadAdminUsers(); }, [view, profile?.role]);

  const assignUser = async (user: AdminUser, role: "student" | "group_admin", groupId: number) => {
    try { await apiMutation("/api/admin/assign", "POST", { userId: user.id, role, groupId }); await loadAdminUsers(); showNotice(role === "group_admin" ? "Администратор назначен" : "Права администратора сняты"); }
    catch (error) { showNotice(error instanceof Error ? error.message : "Ошибка назначения"); }
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
    event.preventDefault(); if (!musicQuery.trim()) return; setMusicLoading(true); catalogLoadedRef.current = true;
    try {
      let results = await findAudiusTracks(musicQuery.trim());
      if (!results.length) results = await findArchiveTracks(musicQuery.trim());
      if (!results.length) { results = await findAudiusTracks(); results.sort(() => Math.random() - .5); showNotice("Точного совпадения нет — включил свежую случайную подборку"); }
      setMusicResults(results);
    } catch { setMusicResults([]); showNotice("Музыкальный каталог временно недоступен"); }
    setMusicLoading(false);
  };

  const loadTrendingMusic = async () => {
    setMusicLoading(true);
    try {
      const results = await findAudiusTracks();
      setMusicResults(results.sort(() => Math.random() - .5));
    } catch { showNotice("Не удалось загрузить свежую подборку"); }
    setMusicLoading(false);
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
          {(profile?.role === "super_admin" || (profile && !superAdminExists)) && <button className={view === "admin" ? "active" : ""} onClick={() => navigate("admin")}>Админ</button>}
        </nav>
        <div className="header-tools">
          <label className="group-select"><span className="status-dot"/><select aria-label="Учебная группа" value={selectedGroup} onChange={(event) => setSelectedGroup(Number(event.target.value))}>{groups.map((group) => <option key={group.id} value={group.id}>{group.code}</option>)}</select></label>
          {profile ? <a className="account-chip" href={signOutPath} title="Выйти"><b>{profile.displayName.slice(0,1).toUpperCase()}</b><span>{profile.displayName}<small>{profile.role === "super_admin" ? "главный админ" : profile.role === "group_admin" ? "админ группы" : "студент"}</small></span></a> : <a className="account-login" href={signInPath} onClick={openSignIn}>Войти</a>}
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

      {view === "schedule" && <section className="workspace-page section-shell"><div className="page-intro"><div><span className="eyebrow">// ЭИОС КГУ · {selectedGroupInfo?.code}</span><h1>Расписание</h1><p>Живые пары выбранной группы: предмет, преподаватель, аудитория и изменения из официального источника.</p></div><a className="primary-button link-button" href={selectedGroupInfo?.eiosUrl} target="_blank" rel="noreferrer">Открыть в ЭИОС ↗</a></div><div className="group-tabs">{groups.map((group) => <button className={group.id === selectedGroup ? "active" : ""} key={group.id} onClick={() => setSelectedGroup(group.id)}>{group.code}</button>)}</div><div className="schedule-notice"><span className="status-dot"/><b>Живое расписание</b><p>ЭИОС загружается внутри страницы. Если включён VPN — отключите его. При блокировке встроенного окна используйте кнопку «Открыть в ЭИОС».</p></div>{!scheduleLoaded ? <button className="schedule-loader" onClick={() => setScheduleLoaded(true)}><span className="pixel-calendar"><i>26</i><b>КУРС</b></span><span><b>Загрузить {selectedGroupInfo?.code}</b><small>Пары, преподаватели, аудитории и изменения из ЭИОС</small></span><strong>→</strong></button> : <div className="schedule-frame-wrap"><div className="browser-bar"><i/><i/><i/><span>eios.kosgos.ru · {selectedGroupInfo?.code}</span></div><iframe key={selectedGroup} title={`Расписание ${selectedGroupInfo?.code}`} src={selectedGroupInfo?.eiosUrl} className="schedule-frame"/></div>}</section>}

      {view === "homework" && <section className="workspace-page section-shell"><div className="page-intro"><div><span className="eyebrow">// {selectedGroupInfo?.code}</span><h1>Домашка</h1><p>Общие задания группы. Публиковать и редактировать их может только назначенный администратор.</p></div><span className="big-counter">{upcomingHomework.length}<small>активно</small></span></div><div className={`crud-grid ${!canManage ? "viewer" : ""}`}><div className="items-column"><div className="filter-row"><span>Все задания</span><span>{homework.length} всего</span></div>{homework.map((item) => <article className={`crud-item ${item.done ? "done" : ""}`} key={item.id}>{canManage ? <button className="pixel-check" aria-label={item.done ? "Вернуть задание" : "Завершить задание"} onClick={() => updateHomework(item,{done:!item.done})}>{item.done ? "✓" : ""}</button> : <span className="pixel-check readonly">{item.done ? "✓" : ""}</span>}<div className="crud-body"><span className="tag">{item.subject}</span><h3>{item.title}</h3>{item.details && <p>{item.details}</p>}<time>Сделать: {formatDate(item.due)}</time></div>{canManage && <div className="item-actions"><button onClick={() => editHomework(item)}>ред.</button><button className="danger" onClick={() => deleteHomework(item.id)}>×</button></div>}</article>)}{ready && !homework.length && <div className="empty-state large">Администратор группы ещё не добавил задания</div>}</div>{canManage ? <form className="editor-panel" onSubmit={saveHomework}><span className="eyebrow">// {editingHomework ? "редактирование" : "новая задача"}</span><h2>{editingHomework ? "Изменить ДЗ" : "Добавить ДЗ"}</h2><label>Предмет<select value={homeworkForm.subject} onChange={(e) => setHomeworkForm({...homeworkForm,subject:e.target.value})}><option>Программирование</option><option>Математика</option><option>Английский язык</option><option>Информатика</option><option>Физкультура</option><option>Другое</option></select></label><label>Что сделать<input required placeholder="Например: решить задачи 1–5" value={homeworkForm.title} onChange={(e) => setHomeworkForm({...homeworkForm,title:e.target.value})}/></label><label>Комментарий<textarea placeholder="Ссылки, страницы, детали..." value={homeworkForm.details} onChange={(e) => setHomeworkForm({...homeworkForm,details:e.target.value})}/></label><label>Срок<input required type="date" value={homeworkForm.due} onChange={(e) => setHomeworkForm({...homeworkForm,due:e.target.value})}/></label><button className="primary-button wide" type="submit">{editingHomework ? "Сохранить изменения" : `Опубликовать для ${selectedGroupInfo?.code}`}</button>{editingHomework && <button className="cancel-button" type="button" onClick={() => {setEditingHomework(null);setHomeworkForm(emptyHomework)}}>Отмена</button>}</form> : <LockedPanel signedIn={signedIn} signInPath={signInPath} onSignIn={openSignIn}/>}</div></section>}

      {view === "events" && <section className="workspace-page section-shell"><div className="page-intro"><div><span className="eyebrow">// {selectedGroupInfo?.code}</span><h1>Мероприятия</h1><p>Демки, встречи и хакатоны выбранной группы — всё по датам.</p></div><span className="big-counter">{events.length}<small>событий</small></span></div><div className={`crud-grid ${!canManage ? "viewer" : ""}`}><div className="items-column event-list">{upcomingEvents.map((item) => <article className="crud-item" key={item.id}><div className="event-date"><b>{new Date(`${item.date}T12:00:00`).getDate()}</b><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString("ru-RU",{month:"short"})}</span></div><div className="crud-body"><span className="tag">{item.time || "Весь день"}</span><h3>{item.title}</h3><p>{item.details || "Без описания"}</p><time>{formatDate(item.date)}</time></div>{canManage && <div className="item-actions"><button onClick={() => {setEventForm({title:item.title,details:item.details,date:item.date,time:item.time});setEditingEvent(item.id)}}>ред.</button><button className="danger" onClick={() => deleteEvent(item.id)}>×</button></div>}</article>)}{ready && !events.length && <div className="empty-state large">В календаре группы пока пусто</div>}</div>{canManage ? <form className="editor-panel" onSubmit={saveEvent}><span className="eyebrow">// {editingEvent ? "редактирование" : "новое событие"}</span><h2>{editingEvent ? "Изменить" : "Запланировать"}</h2><label>Название<input required placeholder="Например: IT‑хакатон" value={eventForm.title} onChange={(e) => setEventForm({...eventForm,title:e.target.value})}/></label><label>Описание<textarea placeholder="Место, команда, что взять..." value={eventForm.details} onChange={(e) => setEventForm({...eventForm,details:e.target.value})}/></label><div className="split-fields"><label>Дата<input required type="date" value={eventForm.date} onChange={(e) => setEventForm({...eventForm,date:e.target.value})}/></label><label>Время<input type="time" value={eventForm.time} onChange={(e) => setEventForm({...eventForm,time:e.target.value})}/></label></div><button className="primary-button wide" type="submit">{editingEvent ? "Сохранить изменения" : `Опубликовать для ${selectedGroupInfo?.code}`}</button>{editingEvent && <button className="cancel-button" type="button" onClick={() => {setEditingEvent(null);setEventForm(emptyEvent)}}>Отмена</button>}</form> : <LockedPanel signedIn={signedIn} signInPath={signInPath} onSignIn={openSignIn}/>}</div></section>}

      {view === "admin" && <section className="workspace-page section-shell admin-page"><div className="page-intro"><div><span className="eyebrow">// управление доступом</span><h1>Админка</h1><p>Главный администратор назначает ответственных за ДЗ и мероприятия каждой группы.</p></div></div>{profile && !superAdminExists && <form className="owner-claim" onSubmit={claimOwner}><span className="pixel-lock">◆</span><div><span className="eyebrow">// первичная активация</span><h2>Стать главным администратором</h2><p>Введите одноразовый код владельца, полученный при запуске сайта.</p></div><div className="claim-form"><input className="pixel-key" type="password" required placeholder="Код владельца" value={ownerCode} onChange={(e) => setOwnerCode(e.target.value)}/><button className="primary-button">Активировать</button></div></form>}{profile?.role === "super_admin" && <div className="users-panel"><div className="panel-title"><h3>Зарегистрированные пользователи</h3><button onClick={loadAdminUsers}>Обновить ↻</button></div>{adminUsers.map((user) => <div className="user-row" key={user.id}><span className="user-avatar">{user.displayName.slice(0,1).toUpperCase()}</span><span className="user-main"><b>{user.displayName}</b><small>{user.email}</small></span><select aria-label={`Группа пользователя ${user.displayName}`} value={user.groupId ?? groups[0].id} disabled={user.role === "super_admin"} onChange={(e) => assignUser(user,user.role === "group_admin" ? "group_admin" : "student",Number(e.target.value))}>{groups.map((group) => <option value={group.id} key={group.id}>{group.code}</option>)}</select>{user.role === "super_admin" ? <span className="role-owner">Владелец</span> : <select aria-label={`Роль пользователя ${user.displayName}`} value={user.role === "group_admin" ? "group_admin" : "student"} onChange={(e) => assignUser(user,e.target.value as "student"|"group_admin",user.groupId ?? groups[0].id)}><option value="student">Студент</option><option value="group_admin">Админ группы</option></select>}</div>)}{!adminUsers.length && <div className="empty-state large">Пользователи появятся здесь после регистрации</div>}</div>}</section>}

      {signedIn && !profile && <div className="modal-backdrop"><form className="registration-card" onSubmit={register}><span className="pixel-logo large-logo" aria-hidden="true"><i/><i/><i/><i/></span><span className="eyebrow">// первый вход</span><h2>Добро пожаловать</h2><p>Выбери имя и свою группу. Потом главный администратор сможет назначить тебя админом группы.</p><label>Как тебя показывать<input required minLength={2} value={registrationName} onChange={(e) => setRegistrationName(e.target.value)}/></label><label>Твоя группа<select value={registrationGroup} onChange={(e) => setRegistrationGroup(Number(e.target.value))}>{groups.map((group) => <option key={group.id} value={group.id}>{group.code}</option>)}</select></label><button className="primary-button wide">Завершить регистрацию</button><a href={signOutPath}>Выйти из аккаунта</a></form></div>}

      <aside className={`music-player ${musicOpen ? "open" : ""}`}>{musicOpen && <div className="music-library"><div className="library-head"><span><small>// audius + open music db</small><b>Современные полные треки</b></span><button onClick={() => setMusicOpen(false)} aria-label="Свернуть музыку">×</button></div><form className="music-search" onSubmit={searchMusic}><input value={musicQuery} onChange={(e) => setMusicQuery(e.target.value)} placeholder="Русский / зарубежный артист или трек..."/><button type="submit" aria-label="Найти">⌕</button></form><button className={`track-row ${track.id === defaultTrack.id ? "selected" : ""}`} onClick={() => chooseTrack(defaultTrack)}><span className="synth-cover">♪</span><span><b>Pixel Focus</b><small>Бесконечный эмбиент · без слов</small></span></button><div className="search-results">{musicLoading && <div className="music-status">Ищу полные треки...</div>}{!musicLoading && musicResults.map((item) => <button className={`track-row ${track.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => chooseTrack(item)}>{item.cover ? <img src={item.cover} alt=""/> : <span className="synth-cover">♪</span>}<span><b>{item.title}</b><small>{item.artist} · полный трек</small></span></button>)}{!musicLoading && musicQuery && !musicResults.length && <div className="music-status">Нет результатов — после текущего трека включится случайная подборка.</div>}</div></div>}<div className="now-playing"><button className="cover-button" onClick={() => setMusicOpen((value) => !value)} aria-label="Открыть музыкальную библиотеку">{track.cover ? <img src={track.cover} alt=""/> : <span className="synth-cover pixel-disc">♪</span>}</button><div className="track-info"><button onClick={() => setMusicOpen((value) => !value)}><b>{track.title}</b><small>{track.artist}</small></button>{track.sourceUrl && <span className="track-links"><a href={track.sourceUrl} target="_blank" rel="noreferrer">{track.source === "audius" ? "Audius" : "Archive"} ↗</a>{track.licenseUrl && <a href={track.licenseUrl} target="_blank" rel="noreferrer">CC</a>}</span>}</div><button className="play-button" onClick={toggleMusic} aria-label={playing ? "Пауза" : "Воспроизвести"}>{playing ? "Ⅱ" : "▶"}</button><input className="volume" aria-label="Громкость" type="range" min="0" max="1" step=".05" value={volume} onChange={(e) => setVolume(Number(e.target.value))}/></div><audio ref={audioRef} preload="auto" src={track.stream} onEnded={() => void playNextTrack()} onError={handleAudioError} onPlay={() => { audioErrorsRef.current = 0; setPlaying(true); }} onPause={() => track.source !== "synth" && setPlaying(false)}/></aside>
      <footer><span>© 2026 by pogostik</span><span>Для первокурсников Высшей IT‑школы КГУ</span><a href="https://itschool.kosgos.ru/" target="_blank" rel="noreferrer">itschool.kosgos.ru ↗</a></footer>
    </main>
  );
}

function LockedPanel({ signedIn, signInPath, onSignIn }: { signedIn: boolean; signInPath: string; onSignIn: (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  return <aside className="editor-panel locked-panel"><span className="pixel-lock">▣</span><span className="eyebrow">// только для админа</span><h2>Публикация закрыта</h2><p>{signedIn ? "Главный администратор должен назначить вас администратором этой группы." : "Войдите и зарегистрируйтесь. Смотреть записи можно всем, публиковать — только администраторам групп."}</p>{!signedIn && <a className="primary-button link-button" href={signInPath} onClick={onSignIn}>Войти / регистрация</a>}</aside>;
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }
