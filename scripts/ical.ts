import ical from "node-ical";

/** A VEVENT flattened to the fields adapters care about. Times are UTC ISO strings. */
export type IcsEvent = {
  uid: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
  geo?: { lat: number; lon: number };
  url?: string;
  cancelled: boolean;
};

type ParamValue = string | { val: string };
const text = (v: ParamValue | undefined) => (typeof v === "object" ? v.val : v)?.trim();

/**
 * node-ical parses DATE-only values as midnight in the *machine's* timezone, so the
 * UTC instant differs between a laptop in Sydney and a UTC CI runner. Read the local
 * date parts back out and pin it to 01:00Z, which is 11am/12pm the same day in Sydney.
 * (TZID and Z-suffixed DATE-TIMEs are converted correctly by node-ical.)
 */
const allDayStart = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 1)).toISOString();

export function parseIcs(body: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  for (const c of Object.values(ical.sync.parseICS(body))) {
    if (c?.type !== "VEVENT") continue;
    const title = text(c.summary);
    if (!title) continue;
    const allDay = c.datetype === "date";
    events.push({
      uid: c.uid,
      title,
      start: allDay ? allDayStart(c.start) : c.start.toISOString(),
      end: allDay ? undefined : c.end?.toISOString(),
      allDay,
      location: text(c.location),
      geo: c.geo,
      // URL;VALUE=URI:… parses to { params, val } despite node-ical's `string` type.
      url: text(c.url as ParamValue | undefined),
      cancelled: c.status === "CANCELLED",
    });
  }
  return events;
}
