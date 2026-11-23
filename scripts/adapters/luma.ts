import { fetchAllText } from "../http.ts";
import { parseIcs } from "../ical.ts";
import { inSydney } from "../scope.ts";
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

export const luma: Adapter<string[]> = {
  name: "Luma",
  rank: 1,

  fetch: () => fetchAllText(FEEDS.map((f) => f.url)),

  normalise(raw) {
    const listings: SourceListing[] = [];
    for (const [i, body] of raw.entries()) {
      for (const e of parseIcs(body)) {
        if (e.cancelled) continue;
        // LOCATION is a URL when the address is hidden or the event lives elsewhere.
        if (!inSydney(e.geo, e.location, e.title)) continue;

        // UID is "evt-xxxx@events.lu.ma"; Luma's canonical event URL uses the evt- id.
        const eventId = e.uid.split("@")[0];

        listings.push({
          source: "Luma",
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          venue: e.location && !e.location.startsWith("http") ? e.location : undefined,
          url: `https://luma.com/event/${eventId}`,
          // A non-Luma URL in LOCATION is the same event on another platform: a free,
          // exact cross-source match for dedupe.
          links:
            e.location?.startsWith("http") && !/luma\.com|lu\.ma/.test(e.location)
              ? [e.location]
              : undefined,
          curated: FEEDS[i].curated,
        });
      }
    }
    return listings;
  },
};
