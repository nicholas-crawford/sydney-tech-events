import "./style.css";
import type { Event } from "../scripts/types.ts";

type Summary = { uniqueEvents: number; sources: string[]; generatedAt: string };

const TZ = "Australia/Sydney";
const BASE = import.meta.env.BASE_URL;

// Formatters are expensive to construct; build once, reuse per event.
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }); // YYYY-MM-DD
const dayLabel = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeLabel = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
});
const updatedLabel = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, dateStyle: "medium" });

const $ = <T extends Element>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector)!;

/** Clone a <template>'s first element. textContent/attributes only: scraped titles never touch innerHTML. */
const clone = (id: string) =>
  ($<HTMLTemplateElement>(`#${id}`).content.firstElementChild as HTMLElement).cloneNode(
    true,
  ) as HTMLElement;

function renderSource(source: Event["sources"][number]) {
  const li = clone("source-template");
  const a = $<HTMLAnchorElement>("a", li);
  a.href = source.url;
  $(".source-name", li).textContent = source.name;
  return li;
}

function renderEvent(event: Event) {
  const li = clone("event-template");
  const title = $<HTMLAnchorElement>(".event-title", li);
  title.href = event.primaryUrl;
  title.textContent = event.title;

  const time = $<HTMLTimeElement>(".event-time", li);
  const start = new Date(event.start);
  time.dateTime = event.allDay ? dayKey.format(start) : event.start;
  time.textContent = event.allDay ? "All day" : timeLabel.format(start);

  const venue = $(".event-venue", li);
  if (event.venue) venue.textContent = ` · ${event.venue}`;
  else venue.remove();

  $(".sources", li).append(...event.sources.map(renderSource));
  return li;
}

function renderDays(events: Event[]) {
  // events.json is already sorted by start, so a Map keeps days in order.
  const byDay = new Map<string, Event[]>();
  for (const e of events) {
    const key = dayKey.format(new Date(e.start));
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  return [...byDay].map(([key, dayEvents]) => {
    const li = clone("day-template");
    const time = $<HTMLTimeElement>("time", li);
    time.dateTime = key;
    time.textContent = dayLabel.format(new Date(dayEvents[0].start));
    $(".events", li).append(...dayEvents.map(renderEvent));
    return li;
  });
}

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function main() {
  const days = $<HTMLOListElement>("#days");
  const summary = $("#summary");
  $<HTMLAnchorElement>("#csv").href = `${BASE}events.csv`;

  try {
    const [events, meta] = await Promise.all([
      getJson<Event[]>("events.json"),
      getJson<Summary>("summary.json"),
    ]);
    const n = meta.sources.length;
    summary.textContent =
      `${meta.uniqueEvents} unique events from ${n} source${n === 1 ? "" : "s"} ` +
      `(${meta.sources.join(", ")}). Updated ${updatedLabel.format(new Date(meta.generatedAt))}.`;
    days.append(...renderDays(events));
  } catch (err) {
    summary.textContent = "Couldn't load events. Try refreshing.";
    console.error(err);
  } finally {
    days.removeAttribute("aria-busy");
  }
}

void main();
