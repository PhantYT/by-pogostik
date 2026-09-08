export type ScheduleLesson = {
  id: string;
  sourceId: number | null;
  date: string;
  start: string;
  end: string;
  dayName: string;
  lessonNumber: number | null;
  subject: string;
  teacher: string;
  room: string;
  group: string;
  subgroup: number | null;
  replacement: boolean;
  color: string;
};

export type NormalizedSchedule = {
  lessons: ScheduleLesson[];
  updatedAt: string | null;
  currentWeek: number | null;
  semester: number | null;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const withoutControls = Array.from(value.normalize("NFKC"), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
  return withoutControls.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function cleanDate(value: unknown) {
  const candidate = cleanString(value, 32).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? candidate : "";
}

function cleanTime(value: unknown) {
  const candidate = cleanString(value, 32);
  const match = /(?:^|T)([01]\d|2[0-3]):([0-5]\d)/.exec(candidate);
  return match ? `${match[1]}:${match[2]}` : "";
}

export function academicYearForDate(date: string) {
  const validDate = cleanDate(date) || new Date().toISOString().slice(0, 10);
  const year = Number(validDate.slice(0, 4));
  const month = Number(validDate.slice(5, 7));
  return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export function scheduleWeekRange(date: string) {
  const validDate = cleanDate(date) || new Date().toISOString().slice(0, 10);
  const selected = new Date(`${validDate}T12:00:00Z`);
  const day = selected.getUTCDay();
  const monday = new Date(selected);
  monday.setUTCDate(selected.getUTCDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

export function normalizeEiosSchedule(payload: unknown): NormalizedSchedule {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : root;
  const info = isRecord(data.info) ? data.info : {};
  const rawLessons = Array.isArray(data.rasp) ? data.rasp : Array.isArray(root.rasp) ? root.rasp : [];
  const seen = new Set<string>();
  const lessons: ScheduleLesson[] = [];

  rawLessons.slice(0, 5000).forEach((value, index) => {
    if (!isRecord(value)) return;
    const sourceId = safeNumber(value["код"]);
    const date = cleanDate(value["дата"] || value["датаНачала"]);
    const start = cleanTime(value["начало"] || value["датаНачала"]);
    const end = cleanTime(value["конец"] || value["датаОкончания"]);
    const subject = cleanString(value["дисциплина"], 240);
    const teacher = cleanString(value["преподаватель"] || value["фиоПреподавателя"], 160);
    const room = cleanString(value["аудитория"], 100);
    if (!date || (!subject && !start)) return;

    const dedupeKey = [sourceId ?? "", date, start, end, subject, teacher, room].join("|");
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const rawColor = cleanString(value["цвет"], 7);
    lessons.push({
      id: sourceId == null ? `eios-${date}-${start || "time"}-${index}` : `eios-${sourceId}`,
      sourceId,
      date,
      start,
      end,
      dayName: cleanString(value["день_недели"], 24),
      lessonNumber: safeNumber(value["номерЗанятия"], 1, 20),
      subject,
      teacher,
      room,
      group: cleanString(value["группа"], 40),
      subgroup: safeNumber(value["номерПодгруппы"], 0, 20),
      replacement: value["замена"] === true,
      color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#1597e5",
    });
  });

  lessons.sort((left, right) => `${left.date} ${left.start}`.localeCompare(`${right.date} ${right.start}`, "ru"));
  return {
    lessons,
    updatedAt: cleanString(info.dateUploadingRasp, 40) || null,
    currentWeek: safeNumber(info.curWeekNumber, 0, 60),
    semester: safeNumber(info.curSem, 1, 12),
  };
}
