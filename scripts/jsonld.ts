/**
 * Pull schema.org Event objects out of a page's JSON-LD blocks.
 * JSON-LD exists so search engines can read events, which makes it far more stable
 * than CSS selectors. Handles single objects, arrays, @graph and ItemList wrappers.
 */

export type JsonLdEvent = {
  "@type": string;
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  eventStatus?: string;
  eventAttendanceMode?: string;
  location?: {
    "@type"?: string;
    name?: string;
    address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string };
    geo?: { latitude?: string | number; longitude?: string | number };
  };
};

/** Some sites HTML-escape text inside JSON-LD ("&amp;"). Decode the common entities. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? m;
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });

const BLOCK_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function extractJsonLdEvents(html: string): JsonLdEvent[] {
  const events: JsonLdEvent[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && t.endsWith("Event"))) {
      const event = obj as JsonLdEvent;
      if (event.name) event.name = decodeEntities(event.name);
      events.push(event);
      return;
    }
    // Wrappers: ItemList → itemListElement[].item, and @graph.
    for (const key of ["@graph", "itemListElement", "item"]) {
      if (key in obj) visit(obj[key]);
    }
  };

  for (const [, json] of html.matchAll(BLOCK_RE)) {
    try {
      visit(JSON.parse(json));
    } catch {
      // A malformed block on the page shouldn't take down the others.
    }
  }
  return events;
}
