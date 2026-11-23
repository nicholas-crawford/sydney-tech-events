import { createHash } from "node:crypto";
import { sydneyDate } from "./scope.ts";
import type { Event, SourceListing } from "./types.ts";

/**
 * Entity resolution: decide which listings from different sources are the same event.
 *
 * Title similarity alone is NOT enough. In real data the most similar same-day pair was
 * "Turing @ NeurIPS: After Hours" vs "Cartesia x NeurIPS: After Hours" (different
 * parties). So a fuzzy merge needs several independent signals to agree:
 *   - different sources (each source already lists an event once),
 *   - same Sydney date, starts within 90 minutes,
 *   - near-identical titles (Dice ≥ 0.8) or one title's words all inside the other's.
 * Exact signals always merge: same normalised title + date, or an explicit cross-link.
 * overrides.json handles whatever the rules get wrong.
 */

export type Overrides = { merge?: [string, string][]; separate?: [string, string][] };

const MAX_START_GAP_MS = 90 * 60 * 1000;
const MIN_DICE = 0.8;
const MIN_CONTAINED_WORDS = 3;

export const normaliseTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/#\d+/g, "")
    .replace(/\bmeet ?up\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Deterministic listing key: same title + Sydney date → same key, across runs. */
export const listingKey = (l: Pick<SourceListing, "title" | "start">) =>
  createHash("sha1")
    .update(`${normaliseTitle(l.title)}|${sydneyDate(new Date(l.start))}`)
    .digest("hex")
    .slice(0, 12);

const normaliseUrl = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

const PLATFORMS: [RegExp, string][] = [
  [/eventbrite\./, "Eventbrite"],
  [/humanitix\./, "Humanitix"],
  [/meetup\.com/, "Meetup"],
  [/luma\.com|lu\.ma/, "Luma"],
];
/** Name a linked URL by its platform, falling back to the bare host. */
const platformOf = (url: string) => {
  const host = (() => {
    try {
      return new URL(url).host.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();
  return PLATFORMS.find(([re]) => re.test(host))?.[1] ?? host;
};

/** Sørensen–Dice coefficient over character bigrams: 1 = identical, 0 = nothing shared. */
export function dice(a: string, b: string) {
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a.replace(/ /g, ""));
  const gb = grams(b.replace(/ /g, ""));
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = [...ga.values(), ...gb.values()].reduce((x, y) => x + y, 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

function wordsContained(a: string, b: string) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const shortWords = short.split(" ").filter(Boolean);
  const longWords = new Set(long.split(" "));
  return shortWords.length >= MIN_CONTAINED_WORDS && shortWords.every((w) => longWords.has(w));
}

/** The fuzzy rule, exported so tests can pin its behaviour on real cases. */
export function likelySameEvent(a: SourceListing, b: SourceListing) {
  if (a.source === b.source) return false;
  if (sydneyDate(new Date(a.start)) !== sydneyDate(new Date(b.start))) return false;
  const gapOk =
    a.allDay || b.allDay || Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= MAX_START_GAP_MS;
  if (!gapOk) return false;
  const ta = normaliseTitle(a.title);
  const tb = normaliseTitle(b.title);
  return dice(ta, tb) >= MIN_DICE || wordsContained(ta, tb);
}

/** Union-find (disjoint set): merges are transitive, so A~B and B~C puts A, B, C together. */
class DisjointSet {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]];
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

export function dedupe(
  listings: SourceListing[],
  rankOf: Map<string, number>,
  overrides: Overrides = {},
): Event[] {
  const keys = listings.map(listingKey);
  const set = new DisjointSet(listings.length);
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const separate = new Set((overrides.separate ?? []).map(([a, b]) => pairKey(a, b)));
  const tryUnion = (i: number, j: number) => {
    if (!separate.has(pairKey(keys[i], keys[j]))) set.union(i, j);
  };

  // 1. Exact: same normalised title + Sydney date.
  const firstByKey = new Map<string, number>();
  keys.forEach((k, i) => {
    const first = firstByKey.get(k);
    if (first === undefined) firstByKey.set(k, i);
    else tryUnion(first, i);
  });

  // 2. Exact: a source explicitly links to another source's listing.
  const byUrl = new Map(listings.map((l, i) => [normaliseUrl(l.url), i]));
  listings.forEach((l, i) => {
    for (const link of l.links ?? []) {
      const j = byUrl.get(normaliseUrl(link));
      if (j !== undefined) tryUnion(i, j);
    }
  });

  // 3. Fuzzy: only compare within the same Sydney date (keeps it ~O(n) in practice).
  const byDate = new Map<string, number[]>();
  listings.forEach((l, i) => {
    const d = sydneyDate(new Date(l.start));
    byDate.set(d, [...(byDate.get(d) ?? []), i]);
  });
  for (const idx of byDate.values()) {
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        if (likelySameEvent(listings[idx[x]], listings[idx[y]])) tryUnion(idx[x], idx[y]);
      }
    }
  }

  // 4. Manual merges (by listing key).
  for (const [a, b] of overrides.merge ?? []) {
    const i = keys.indexOf(a);
    const j = keys.indexOf(b);
    if (i >= 0 && j >= 0) set.union(i, j);
  }

  const groups = new Map<number, number[]>();
  listings.forEach((_, i) => {
    const root = set.find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  return [...groups.values()].map((members) => {
    const sorted = members.toSorted(
      (a, b) => (rankOf.get(listings[a].source) ?? 9) - (rankOf.get(listings[b].source) ?? 9),
    );
    const best = listings[sorted[0]];
    const memberKeys = [...new Set(sorted.map((i) => keys[i]))].sort();
    return {
      id: keys[sorted[0]],
      title: best.title,
      start: best.start,
      end: best.end,
      allDay: best.allDay,
      venue: sorted.map((i) => listings[i].venue).find(Boolean),
      primaryUrl: best.url,
      // Same event can appear in two feeds of one source; keep each URL once.
      // Cross-links count as sources too: if Luma says "this is also on Eventbrite",
      // show that link even when Eventbrite's own listing was filtered out.
      sources: [
        ...new Map([
          ...sorted.map(
            (i) =>
              [
                normaliseUrl(listings[i].url),
                { name: listings[i].source, url: listings[i].url },
              ] as const,
          ),
          ...sorted.flatMap((i) =>
            (listings[i].links ?? []).map(
              (url) => [normaliseUrl(url), { name: platformOf(url), url }] as const,
            ),
          ),
        ]).values(),
      ],
      ...(memberKeys.length > 1 ? { mergedFrom: memberKeys } : {}),
    };
  });
}
