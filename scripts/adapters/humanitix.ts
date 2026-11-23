import { fetchText } from "../http.ts";
import { extractJsonLdEvents, type JsonLdEvent } from "../jsonld.ts";
import { inSydney } from "../scope.ts";
import type { Adapter, SourceListing } from "../types.ts";

/**
 * Humanitix: its public API only covers your own organiser account, so this reads the
 * Sydney category pages (robots.txt allows everything). The server only renders the
 * featured events (~4 per page) as JSON-LD; the rest load client-side through an
 * undocumented search API, which this deliberately doesn't use.
 *
 * - curated: Science & Technology is tech-scoped; Business & Professional needs the
 *   keyword filter.
 */
const PAGES = [
  { url: "https://humanitix.com/au/events/au--nsw--sydney/scienceandtechnology", curated: true },
  {
    url: "https://humanitix.com/au/events/au--nsw--sydney/businessandprofessional",
    curated: false,
  },
];

type Raw = { events: JsonLdEvent[]; curated: boolean }[];

export const humanitix: Adapter<Raw> = {
  name: "Humanitix",
  rank: 1,

  async fetch() {
    const raw: Raw = [];
    for (const page of PAGES) {
      raw.push({ events: extractJsonLdEvents(await fetchText(page.url)), curated: page.curated });
    }
    return raw;
  },

  normalise(raw) {
    const listings: SourceListing[] = [];
    for (const { events, curated } of raw) {
      for (const e of events) {
        if (!e.name || !e.url || !e.startDate) continue;
        if (e.eventAttendanceMode?.includes("Online")) continue;
        const address = e.location?.address?.streetAddress;
        // No coordinates in Humanitix JSON-LD; the address text includes "NSW".
        if (!inSydney(undefined, address, e.location?.name)) continue;

        const allDay = !e.startDate.includes("T");
        listings.push({
          source: "Humanitix",
          title: e.name.trim(),
          start: allDay
            ? new Date(`${e.startDate.slice(0, 10)}T01:00:00Z`).toISOString()
            : new Date(e.startDate).toISOString(),
          end: e.endDate?.includes("T") ? new Date(e.endDate).toISOString() : undefined,
          allDay,
          // Address often already starts with the venue name ("UTS Startups, UTS Startups, …").
          venue:
            address && e.location?.name && !address.startsWith(e.location.name)
              ? `${e.location.name}, ${address}`
              : (address ?? e.location?.name),
          url: e.url.split("?")[0],
          curated,
        });
      }
    }
    return listings;
  },
};
