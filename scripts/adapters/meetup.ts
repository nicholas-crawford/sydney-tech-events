import { fetchText } from "../http.ts";
import { parseIcs } from "../ical.ts";
import type { Adapter, SourceListing } from "../types.ts";

/**
 * Meetup's API is Meetup Pro only, and its search/infinite scroll goes through an
 * internal API that robots.txt disallows. But every group publishes an iCal feed at
 * /<group>/events/ical/ (not disallowed), so:
 *
 *  1. Discover Sydney tech groups from allowed browse/topic pages (best effort).
 *  2. Union with a seed list, so a flaky discovery page doesn't lose known groups.
 *  3. Read each group's iCal feed with the same parser as Luma.
 *
 * Groups are chosen as Sydney tech groups, so listings are `curated` (no keyword
 * allowlist) and skip the geo filter (Meetup feeds rarely include GEO/LOCATION).
 */

/** Known Sydney tech groups (urlnames). Add more as you find them. */
const SEED_GROUPS = [
  "agentic-engineering-meetup-sydney",
  "ai-australia-community-giofai",
  "ailearnersclub",
  "aws-sydney-well-architected-user-group",
  "codelo-time-open-source",
  "data-science-sydney",
  "enterprise-ux-sydney",
  "gdgcloudsydney",
  "ruby-on-rails-oceania-sydney",
  "sydjs-classic",
  "sydney-creative-customer-experience-ccx",
  "sydney-elastic-fantastics",
  "sydney-tech-meetups",
  "sydney-testers",
];

const DISCOVERY_PAGES = [
  "https://www.meetup.com/find/au--sydney/technology/",
  "https://www.meetup.com/topics/web-development/au/sydney/",
  "https://www.meetup.com/topics/software-development/au/sydney/",
  "https://www.meetup.com/topics/artificial-intelligence/au/sydney/",
];

// Event links on the page look like meetup.com/<group>/events/<id>/.
const GROUP_IN_EVENT_URL = /meetup\.com\/([A-Za-z0-9_-]+)\/events\/\d+/g;
// The Next.js Apollo cache also lists groups: "urlname":"<group>".
const GROUP_URLNAME = /"urlname":"([A-Za-z0-9_-]+)"/g;

async function discoverGroups(): Promise<string[]> {
  const found = new Set<string>();
  for (const page of DISCOVERY_PAGES) {
    try {
      const html = await fetchText(page);
      for (const [, name] of html.matchAll(GROUP_IN_EVENT_URL)) found.add(name.toLowerCase());
      for (const [, name] of html.matchAll(GROUP_URLNAME)) found.add(name.toLowerCase());
    } catch (err) {
      console.warn(`  Meetup discovery page failed (${String(err)})`);
    }
  }
  return [...found];
}

export const meetup: Adapter<string[]> = {
  name: "Meetup",
  rank: 1,

  async fetch() {
    const discovered = await discoverGroups();
    // urlnames are case-insensitive; normalise so duplicates collapse.
    const groups = [...new Set([...SEED_GROUPS, ...discovered])];
    const newOnes = discovered.filter((g) => !SEED_GROUPS.includes(g));
    console.log(
      `  Meetup: ${groups.length} groups (${newOnes.length} newly discovered${newOnes.length ? `: ${newOnes.join(", ")}` : ""})`,
    );

    const bodies: string[] = [];
    for (const group of groups) {
      try {
        bodies.push(await fetchText(`https://www.meetup.com/${group}/events/ical/`));
      } catch (err) {
        // A renamed/closed group shouldn't sink the rest.
        console.warn(`  Meetup group ${group} failed (${String(err)})`);
      }
    }
    if (bodies.length === 0) throw new Error("No Meetup group feeds could be fetched");
    return bodies;
  },

  normalise(raw) {
    const listings: SourceListing[] = [];
    for (const body of raw) {
      for (const e of parseIcs(body)) {
        if (e.cancelled || !e.url) continue;
        listings.push({
          source: "Meetup",
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          venue: e.location && !e.location.startsWith("http") ? e.location : undefined,
          url: e.url,
          curated: true,
        });
      }
    }
    return listings;
  },
};
