import { fetchText } from "../http.ts";
import { extractJsonLdEvents, type JsonLdEvent } from "../jsonld.ts";
import { inSydney, isAllowed, isBlocked, sydneyDate, WINDOW_END_DATE } from "../scope.ts";
import type { Adapter, SourceListing } from "../types.ts";

/**
 * Eventbrite has no public search API (shut down 2019–20), so this scrapes the
 * "Sydney · Science & Tech" browse pages. robots.txt allows /d/ pages.
 *
 * Two-phase crawl:
 *  1. List pages: JSON-LD ItemList of Events. Has name/url/geo but startDate is date-only.
 *  2. Detail pages: only for events that pass the cheap filters, to get the real start
 *     time (JSON-LD startDate with offset). Keeps request count (and politeness) down.
 */
const LIST_URL = "https://www.eventbrite.com.au/d/australia--sydney/science-and-tech--events/";
const MAX_PAGES = 15;

type Raw = { listing: JsonLdEvent; detail?: JsonLdEvent }[];

const num = (v: string | number | undefined) => (v === undefined ? NaN : Number(v));

function venueOf(e: JsonLdEvent) {
  const loc = e.location;
  if (!loc || loc["@type"] === "VirtualLocation") return undefined;
  const parts = [loc.name, loc.address?.streetAddress, loc.address?.addressLocality];
  // Drop repeats like name "345 George St" + street "345 George Street".
  return [...new Set(parts.filter(Boolean))].join(", ") || undefined;
}

/** Cheap pre-filter on list data, before spending a detail request. */
function worthFetching(e: JsonLdEvent, today: string) {
  if (!e.name || !e.url || !e.startDate) return false;
  const date = e.startDate.slice(0, 10);
  if (date < today || date > WINDOW_END_DATE) return false;
  if (e.eventAttendanceMode?.includes("Online")) return false;
  const geo = e.location?.geo;
  return (
    inSydney(
      geo && { lat: num(geo.latitude), lon: num(geo.longitude) },
      e.location?.address?.addressLocality,
    ) &&
    isAllowed(e.name) &&
    !isBlocked(e.name)
  );
}

export const eventbrite: Adapter<Raw> = {
  name: "Eventbrite",
  rank: 1,

  async fetch() {
    // Phase 1: walk list pages. Eventbrite sometimes serves a page with no events
    // (a different cached variant), so retry an empty page once and only stop after
    // two empty pages in a row.
    const byUrl = new Map<string, JsonLdEvent>();
    const listPage = async (page: number) =>
      extractJsonLdEvents(await fetchText(page === 1 ? LIST_URL : `${LIST_URL}?page=${page}`));
    let emptyStreak = 0;
    for (let page = 1; page <= MAX_PAGES && emptyStreak < 2; page++) {
      let found;
      try {
        found = await listPage(page);
        if (found.length === 0) found = await listPage(page);
      } catch (err) {
        // Page 1 failing means Eventbrite is unusable this run: let ingest carry forward.
        // A later page failing: keep what we have rather than throwing it all away.
        if (page === 1) throw err;
        console.warn(`  Eventbrite list page ${page} failed (${String(err)}); stopping here`);
        break;
      }
      emptyStreak = found.length === 0 ? emptyStreak + 1 : 0;
      for (const e of found) if (e.url) byUrl.set(e.url.split("?")[0], e);
    }

    const today = sydneyDate(new Date());
    const candidates = [...byUrl.values()].filter((e) => worthFetching(e, today));
    console.log(`  Eventbrite: ${byUrl.size} listed, ${candidates.length} worth a detail fetch`);

    // Phase 2: detail pages. One failure shouldn't drop the rest; fall back to list data.
    const raw: Raw = [];
    for (const listing of candidates) {
      try {
        const detail = extractJsonLdEvents(await fetchText(listing.url!))[0];
        raw.push({ listing, detail });
      } catch (err) {
        console.warn(`  Eventbrite detail failed: ${String(err)}`);
        raw.push({ listing });
      }
    }
    return raw;
  },

  normalise(raw) {
    const listings: SourceListing[] = [];
    for (const { listing, detail } of raw) {
      if (detail?.eventStatus?.includes("Cancelled")) continue;
      const startText = detail?.startDate ?? listing.startDate!;
      // Date-only (no "T") means we never got a time: treat as all-day, pinned to 01:00Z
      // so the Sydney date is stable (same convention as the Luma adapter).
      const allDay = !startText.includes("T");
      const start = allDay ? new Date(`${startText.slice(0, 10)}T01:00:00Z`) : new Date(startText);
      const endText = detail?.endDate;
      const end = endText?.includes("T") ? new Date(endText).toISOString() : undefined;

      listings.push({
        source: "Eventbrite",
        title: (detail?.name ?? listing.name!).trim(),
        start: start.toISOString(),
        end,
        allDay,
        venue: venueOf(detail ?? listing),
        url: listing.url!.split("?")[0],
      });
    }
    return listings;
  },
};
