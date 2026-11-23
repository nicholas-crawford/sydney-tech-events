import ical from "node-ical";
import { fetchAllText } from "../http.ts";
import type { Adapter, SourceListing } from "../types.ts";

/**
 * Luma iCal feeds.
 * - curated: the calendar is already tech/startup-scoped, so skip the keyword allowlist
 *   (the blocklist still applies).
 */
const FEEDS = [
  // Sydney city discover feed: general-interest, needs the keyword filter.
  {
    url: "https://api.luma.com/ics/get?entity=discover&id=discplace-TPdKGPI56hGfOdi",
    curated: false,
  },
  // ANZ Startup Events Calendar: tech-scoped but national, so the Sydney geo filter matters.
  { url: "https://api.luma.com/ics/get?entity=calendar&id=cal-BExqrda4iPuEqSg", curated: true },
];

// Rough Greater Sydney bounding box (Penrith–coast, Hornsby–Sutherland).
const SYDNEY = { latMin: -34.2, latMax: -33.4, lonMin: 150.5, lonMax: 151.4 };

type ParamValue = string | { val: string };
const text = (v: ParamValue | undefined) => (typeof v === "object" ? v.val : v)?.trim();

function inSydney(
  geo: { lat: number; lon: number } | undefined,
  location?: string,
  title?: string,
) {
  if (geo) {
    return (
      geo.lat >= SYDNEY.latMin &&
      geo.lat <= SYDNEY.latMax &&
      geo.lon >= SYDNEY.lonMin &&
      geo.lon <= SYDNEY.lonMax
    );
  }
  // No coordinates (often online or hidden address): only keep if it says Sydney/NSW.
  return /\b(sydney|nsw)\b/i.test(`${location ?? ""} ${title ?? ""}`);
}

/**
 * node-ical parses DATE-only values as midnight in the *machine's* timezone, so the
 * UTC instant differs between a laptop in Sydney and a UTC CI runner. Read the local
 * date parts back out and pin it to 01:00Z, which is 11am/12pm the same day in Sydney.
 */
const sydneyAllDayStart = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 1)).toISOString();

export const luma: Adapter = {
  name: "Luma",
  rank: 1,

  fetch: () => fetchAllText(FEEDS.map((f) => f.url)),

  normalise(raw) {
    const listings: SourceListing[] = [];
    for (const [i, body] of raw.entries()) {
      for (const component of Object.values(ical.sync.parseICS(body))) {
        if (component?.type !== "VEVENT") continue;

        const title = text(component.summary);
        if (!title) continue;

        // LOCATION is a URL when the address is hidden or the event lives elsewhere.
        const location = text(component.location);
        if (!inSydney(component.geo, location, title)) continue;

        const allDay = component.datetype === "date";

        // UID is "evt-xxxx@events.lu.ma"; Luma's canonical event URL uses the evt- id.
        const eventId = component.uid.split("@")[0];

        listings.push({
          source: "Luma",
          title,
          start: allDay ? sydneyAllDayStart(component.start) : component.start.toISOString(),
          allDay,
          end: component.end?.toISOString(),
          venue: location && !location.startsWith("http") ? location : undefined,
          url: `https://luma.com/event/${eventId}`,
          curated: FEEDS[i].curated,
        });
      }
    }
    return listings;
  },
};
