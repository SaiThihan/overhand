import { CFG, secret } from "../env";
import type { UiEvent } from "./types";

// --- calendar: secret iCal addresses (Google / Outlook), Keychain item ops-ical holds space-separated URLs ---

/** Converts a wall-clock time in an IANA zone to epoch ms; unknown zones fall back to local time. */
function zoned(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(new Date(guess))
      .reduce<Record<string, number>>((a, p) => {
        if (p.type !== "literal") a[p.type] = Number(p.value);
        return a;
      }, {});
    const asUtc = Date.UTC(parts.year ?? y, (parts.month ?? mo + 1) - 1, parts.day ?? d, parts.hour ?? h, parts.minute ?? mi);
    return guess - (asUtc - guess);
  } catch {
    return new Date(y, mo, d, h, mi).getTime();
  }
}

interface IcsTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  tz: string;
  utc: boolean;
  allDay: boolean;
}

function icsTime(prop: string, value: string): IcsTime | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/);
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]) - 1,
    d: Number(m[3]),
    h: Number(m[4] ?? 0),
    mi: Number(m[5] ?? 0),
    tz: prop.match(/TZID=([^;:]+)/)?.[1] ?? "",
    utc: m[6] === "Z",
    allDay: !m[4],
  };
}

function icsEpoch(t: IcsTime, y = t.y, mo = t.mo, d = t.d): number {
  if (t.allDay) return new Date(y, mo, d).getTime();
  if (t.utc) return Date.UTC(y, mo, d, t.h, t.mi);
  return t.tz ? zoned(y, mo, d, t.h, t.mi, t.tz) : new Date(y, mo, d, t.h, t.mi).getTime();
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Does a recurrence rule (DAILY/WEEKLY/MONTHLY subset) produce an occurrence on the given local day? */
function occursOn(rrule: string, start: IcsTime, day: Date, exdates: Set<string>): boolean {
  const rule = Object.fromEntries(rrule.split(";").map((kv) => kv.split("=") as [string, string]));
  const interval = Number(rule.INTERVAL ?? 1);
  const startDay = new Date(start.y, start.mo, start.d);
  const target = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  if (target < startDay) return false;
  const key = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}${String(target.getDate()).padStart(2, "0")}`;
  if (exdates.has(key)) return false;
  if (rule.UNTIL) {
    const u = icsTime("", rule.UNTIL.slice(0, 16));
    if (u && target > new Date(u.y, u.mo, u.d)) return false;
  }
  const byDay = (rule.BYDAY ?? "")
    .split(",")
    .filter(Boolean)
    .map((x) => x.slice(-2));
  const matches = (dt: Date): boolean => {
    const days = Math.round((dt.getTime() - startDay.getTime()) / 864e5);
    if (rule.FREQ === "DAILY") return days % interval === 0 && (!byDay.length || byDay.includes(DAY_CODES[dt.getDay()] ?? ""));
    if (rule.FREQ === "WEEKLY") {
      const monday = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate() - ((x.getDay() + 6) % 7)).getTime();
      const weeks = Math.round((monday(dt) - monday(startDay)) / (7 * 864e5));
      const wanted = byDay.length ? byDay : [DAY_CODES[startDay.getDay()] ?? ""];
      return weeks % interval === 0 && wanted.includes(DAY_CODES[dt.getDay()] ?? "");
    }
    if (rule.FREQ === "MONTHLY") {
      const months = (dt.getFullYear() - startDay.getFullYear()) * 12 + dt.getMonth() - startDay.getMonth();
      return months % interval === 0 && dt.getDate() === Number(rule.BYMONTHDAY ?? startDay.getDate());
    }
    return false;
  };
  if (!matches(target)) return false;
  if (!rule.COUNT) return true;
  let n = 0; // ponytail: walks day by day to honour COUNT; fine for series up to a few years
  for (let dt = new Date(startDay); dt <= target; dt.setDate(dt.getDate() + 1)) if (matches(dt)) n++;
  return n <= Number(rule.COUNT);
}

/** Today's events from an .ics feed: single events, overrides, and expanded recurring series. */
export function eventsToday(ics: string, day = new Date()): UiEvent[] {
  const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  type Raw = { props: Map<string, [string, string][]> };
  const events: Raw[] = [];
  let cur: Raw | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = { props: new Map() };
    else if (line === "END:VEVENT" && cur) {
      events.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const prop = line.slice(0, i);
      const name = prop.split(";")[0] ?? prop;
      const list = cur.props.get(name) ?? [];
      list.push([prop, line.slice(i + 1)]);
      cur.props.set(name, list);
    }
  }
  const one = (e: Raw, n: string) => e.props.get(n)?.[0];
  const overridden = new Map<string, Set<string>>();
  for (const e of events) {
    const rid = one(e, "RECURRENCE-ID");
    const uid = one(e, "UID")?.[1] ?? "";
    if (rid) overridden.set(uid, (overridden.get(uid) ?? new Set()).add(rid[1].slice(0, 8)));
  }
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const out: UiEvent[] = [];
  for (const e of events) {
    if (one(e, "STATUS")?.[1] === "CANCELLED") continue;
    const ds = one(e, "DTSTART");
    const start = ds ? icsTime(ds[0], ds[1]) : null;
    if (!start) continue;
    const de = one(e, "DTEND");
    const end = de ? icsTime(de[0], de[1]) : null;
    const durMs = end ? icsEpoch(end) - icsEpoch(start) : start.allDay ? 864e5 : 30 * 60_000;
    const title = (one(e, "SUMMARY")?.[1] ?? "Busy").replace(/\\,/g, ",").replace(/\\n/g, " ");
    const rrule = one(e, "RRULE")?.[1];
    let s: number;
    if (rrule && !one(e, "RECURRENCE-ID")) {
      const ex = new Set([
        ...(e.props.get("EXDATE") ?? []).flatMap(([, v]) => v.split(",").map((x) => x.slice(0, 8))),
        ...(overridden.get(one(e, "UID")?.[1] ?? "") ?? []),
      ]);
      if (!occursOn(rrule, start, day, ex)) continue;
      s = icsEpoch(start, day.getFullYear(), day.getMonth(), day.getDate());
    } else {
      s = icsEpoch(start);
    }
    if (s + durMs <= dayStart || s >= dayStart + 864e5) continue;
    out.push({ title, start: s, end: s + durMs, allDay: start.allDay });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Today's meetings from the iCal addresses in the Keychain. */
export async function calendarToday(): Promise<UiEvent[] | string> {
  let urls: string[] = [];
  try {
    urls = (CFG.status.icalSecret ? secret(CFG.status.icalSecret) : "").split(/\s+/).filter(Boolean);
  } catch {
    return "Add your calendar's secret iCal address to show meetings";
  }
  const all: UiEvent[] = [];
  for (const u of urls)
    all.push(...eventsToday(await (await fetch(u.replace(/^webcal:/, "https:"), { signal: AbortSignal.timeout(30_000) })).text()));
  return all.sort((a, b) => a.start - b.start);
}
