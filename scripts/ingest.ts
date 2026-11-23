import { readFile, writeFile } from "node:fs/promises";
import { eventbrite } from "./adapters/eventbrite.ts";
import { humanitix } from "./adapters/humanitix.ts";
import { luma } from "./adapters/luma.ts";
import { meetup } from "./adapters/meetup.ts";
import { dedupe, type Overrides } from "./dedupe.ts";
import { isAllowed, isBlocked, WINDOW_END } from "./scope.ts";
import type { Adapter, Event, SourceListing } from "./types.ts";

const ADAPTERS: Adapter[] = [luma, meetup, eventbrite, humanitix];
const OUT = new URL("../public/", import.meta.url);

function inScope(l: SourceListing, now: Date) {
  const start = new Date(l.start);
  return (
    start >= now && start <= WINDOW_END && (l.curated || isAllowed(l.title)) && !isBlocked(l.title)
  );
}

async function readOverrides(): Promise<Overrides> {
  try {
    return JSON.parse(
      await readFile(new URL("./overrides.json", import.meta.url), "utf8"),
    ) as Overrides;
  } catch {
    return {};
  }
}

async function readPrevious(): Promise<Event[]> {
  try {
    return JSON.parse(await readFile(new URL("events.json", OUT), "utf8")) as Event[];
  } catch {
    return [];
  }
}

const csvCell = (v: string | number | undefined) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

function toCsv(events: Event[]) {
  const header = ["title", "start", "venue", "primary_url", "sources", "source_count"];
  const rows = events.map((e) =>
    [
      e.title,
      e.start,
      e.venue,
      e.primaryUrl,
      e.sources.map((s) => s.name).join(";"),
      e.sources.length,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

async function main() {
  const now = new Date();
  const previous = await readPrevious();
  const listings: SourceListing[] = [];
  let succeeded = 0;

  for (const adapter of ADAPTERS) {
    try {
      const found = adapter.normalise(await adapter.fetch());
      listings.push(...found);
      succeeded++;
      console.log(`✓ ${adapter.name}: ${found.length} listings`);
    } catch (err) {
      // Graceful degradation: carry this source's events forward from last run.
      const carried = previous.flatMap((e) =>
        e.sources
          .filter((s) => s.name === adapter.name)
          .map((s) => ({
            source: s.name,
            title: e.title,
            start: e.start,
            end: e.end,
            venue: e.venue,
            allDay: e.allDay,
            url: s.url,
            curated: true,
          })),
      );
      listings.push(...carried);
      console.warn(
        `✗ ${adapter.name} failed (${String(err)}); carried ${carried.length} from last run`,
      );
    }
  }

  if (succeeded === 0) throw new Error("Every source failed");

  const rankOf = new Map(ADAPTERS.map((a) => [a.name, a.rank]));
  const events = dedupe(
    listings.filter((l) => inScope(l, now)),
    rankOf,
    await readOverrides(),
  ).toSorted((a, b) => a.start.localeCompare(b.start));

  const sourceNames = [...new Set(events.flatMap((e) => e.sources.map((s) => s.name)))];
  const summary = {
    uniqueEvents: events.length,
    sources: sourceNames,
    generatedAt: now.toISOString(),
  };

  await writeFile(new URL("events.json", OUT), JSON.stringify(events, null, 2) + "\n");
  await writeFile(new URL("events.csv", OUT), toCsv(events));
  await writeFile(new URL("summary.json", OUT), JSON.stringify(summary, null, 2) + "\n");

  console.log(`${events.length} unique events from ${sourceNames.length} source(s)`);
}

await main();
