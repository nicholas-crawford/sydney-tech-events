# Spec: Sydney tech events aggregator

Status: ready-for-human

## Context

Hackathon prototype, built now. A single page that aggregates Sydney tech events from many sources, deduplicates them, and links back to every source. The user writes the code; Claude reviews and unblocks.

## Problem

Sydney tech events are spread across Luma, Eventbrite, Meetup, Humanitix and organiser sites. There is no single place to see them all. This aggregates them into one deduplicated, date-sorted list.

## Scope

- Events from ingest run time through **2026-12-31 23:59 Australia/Sydney**.
- Sydney + tech only.
- Single page, no accounts, no filters/search in v1.

## Architecture

Build-time ETL ("git scraping" pattern). No runtime server; browser-side fetching is ruled out (CORS, exposed keys).

```
weekly cron (GitHub Actions)
  → vpx ./scripts/ingest.ts
      → adapters (fetch + normalise) → filter → dedupe → write outputs
  → commit public/events.json, public/events.csv, public/summary.json
  → deploy to GitHub Pages
page loads public/events.json
```

## Sources (adapter pattern)

Each source is an adapter behind one interface:

- `fetch()` → raw records
- `normalise()` → `SourceListing[]` (one listing per source, pre-dedupe)

Build in this order; demo with however many work:

1. **Luma**: Sydney city iCal feed (no auth). Parse `VEVENT`s per RFC 5545; mind `DTSTART` with `TZID` vs `Z`.
2. **Eventbrite**: scrape "Sydney + technology" search pages. Public search API was shut down in 2019–2020.
3. **Meetup**: scrape Sydney tech search/groups. API is Meetup Pro only.
4. **Humanitix**: scrape Sydney tech search. Its API covers only your own organiser account.

### Scraping rules

- Prefer embedded structured data: `<script type="application/ld+json">` schema.org `Event`, or `__NEXT_DATA__`. Fall back to CSS selectors. Use a headless browser (Playwright) only if a source forces it.
- Respect `robots.txt`.
- Send a User-Agent that names the project (no personal details).
- One request at a time per host, ~1s delay between requests.

## Filtering

- Luma feeds: Sydney city discover feed (general-interest, keyword-filtered) and the ANZ Startup Events Calendar (`cal-BExqrda4iPuEqSg`, `curated: true`, skips the allowlist; national, so a Greater Sydney geo bounding box on `GEO` is applied, falling back to "Sydney/NSW" text when there are no coordinates).
- Eventbrite: scrape `/d/australia--sydney/science-and-tech--events/` (allowed by robots.txt). Two-phase crawl: list pages' JSON-LD (date-only) → pre-filter (window, Sydney geo, keywords) → detail pages' JSON-LD for the real start time with offset. Empty list pages are retried once (Eventbrite serves inconsistent variants); stop after two empty in a row. HTTP 429 → back off per `Retry-After` (cap 60s), retry once; a failing later list page keeps the pages already collected.
- Shared scoping (window, allow/block lists, Sydney bounding box) lives in `scripts/scope.ts`; JSON-LD extraction in `scripts/jsonld.ts` (reuse for Meetup/Humanitix).
- Note for later dedupe: in the ANZ calendar, `LOCATION` is sometimes an Eventbrite/Humanitix URL, a free cross-source link.

- Scope at query level per source (category/location/specific groups).
- One shared keyword allowlist/blocklist filter step.
- Drop events outside the date window. All date comparisons in `Australia/Sydney`.

## Data model

```ts
type SourceListing = {
  source: string; // "luma" | "eventbrite" | "meetup" | "humanitix" | ...
  title: string;
  start: string; // UTC ISO 8601 (store UTC, convert to Sydney at the edges)
  end?: string;
  venue?: string;
  url: string;
};

type Event = {
  id: string; // hash(normalisedTitle + sydneyDate), deterministic across runs
  title: string;
  start: string; // UTC ISO 8601 (store UTC, convert to Sydney at the edges)
  end?: string;
  venue?: string;
  primaryUrl: string;
  sources: { name: string; url: string }[];
};
```

## Deduplication (entity resolution)

- Two listings are the same event if they fall on the **same Sydney calendar date** and their **normalised titles** match closely (lowercase, strip punctuation, strip noise like "meetup", "#12").
- `overrides.json` forces a merge or a split by event `id`.
- `primaryUrl` comes from a fixed source priority: organiser's own site > RSVP platform (Luma, Meetup) > aggregators. The highest-ranked source in a merged group wins; the rest become source icons.

## Failure handling (graceful degradation)

- If an adapter throws: log it and carry that source's events forward from the previous `events.json`.
- The run fails only if **every** source fails.

## Outputs

- `public/events.json`: `Event[]`, sorted by `start`.
- `public/events.csv`: one row per unique event. Columns: `title, start, venue, primary_url, sources, source_count`. `sources` is `;`-separated names. **No total row.**
- `public/summary.json`: `{ uniqueEvents, sources, generatedAt }`.
- The unique count is also printed in the ingest log.

## Page

- Vanilla TypeScript (current Vite+ scaffold).
- Heading: "N unique events from M sources".
- `<ol>` grouped by date headings; one `<article>` per event; `<time datetime>` for dates.
- Primary link first, then small named source icons linking to each source.
- `start` stored as UTC; Sydney date used for window, dedupe id and rendering. Dates rendered with `Intl.DateTimeFormat`, `timeZone: 'Australia/Sydney'`.
- Move to React only when interactive state (filters, search, saved list) appears.

## Scheduling and deploy

- GitHub Actions `on: schedule` (weekly) plus `workflow_dispatch` for manual runs.
- The workflow runs ingest, commits the outputs, and deploys to GitHub Pages.

## Known limits

- After 2026-12-31 the window is empty; the cron produces an empty list.
- Scrapers break when site markup changes; structured data first reduces this.

## Suggested first step

Luma adapter end to end (fetch → parse → filter → write `events.json`), no dedupe. Proves the whole pipeline on the easiest source.

## Comments
