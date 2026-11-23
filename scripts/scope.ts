/**
 * What counts as a "Sydney tech event in the window". Shared by ingest (final filter)
 * and adapters that pre-filter before expensive detail fetches.
 */

export const TZ = "Australia/Sydney";

/** Window end: end of 2026 in Sydney (AEDT, UTC+11). */
export const WINDOW_END = new Date("2026-12-31T23:59:59+11:00");
export const WINDOW_END_DATE = "2026-12-31";

/** Sydney calendar date as YYYY-MM-DD. */
const sydneyDateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
export const sydneyDate = (d: Date) => sydneyDateFormat.format(d);

// Tech scoping. Matched as whole words, case-insensitive.
const ALLOW = [
  "ai",
  "ml",
  "llm",
  "grok",
  "bot",
  "bots",
  "agent",
  "agents",
  "agentic",
  "neurips",
  "codex",
  "claude",
  "openai",
  "nvidia",
  "aws",
  "cloud",
  "devfest",
  "android",
  "ios",
  "web",
  "javascript",
  "typescript",
  "react",
  "python",
  "rust",
  "data",
  "devops",
  "security",
  "cyber",
  "hackathon",
  "build night",
  "coding",
  "code",
  "developer",
  "developers",
  "engineering",
  "engineer",
  "tech",
  "startup",
  "startups",
  "founder",
  "founders",
  "vc",
  "saas",
  "product",
  "design",
  "designer",
  "red teaming",
  "research",
  "researchers",
  "frontier",
  "fintech",
  "notion",
  "robotics",
  "semiconductors",
  "agile",
];
const BLOCK = [
  "run club",
  "book club",
  "padel",
  "philosophy",
  "bday",
  "birthday",
  "surf",
  // Eventbrite's Science & Tech category is full of these.
  "seniors",
  "yrs+",
  "kids",
  "school holidays",
  "rtms",
  "ages",
  "tech help",
  "tech connect",
  "tea & tech",
  "copy of",
];

const toPattern = (words: string[]) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
const ALLOW_RE = toPattern(ALLOW);
const BLOCK_RE = toPattern(BLOCK);

export const isAllowed = (title: string) => ALLOW_RE.test(title);
export const isBlocked = (title: string) => BLOCK_RE.test(title);

// Rough Greater Sydney bounding box (Penrith–coast, Hornsby–Sutherland).
const SYDNEY = { latMin: -34.2, latMax: -33.4, lonMin: 150.5, lonMax: 151.4 };

export function inSydney(
  geo: { lat: number; lon: number } | undefined,
  ...text: (string | undefined)[]
) {
  if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
    return (
      geo.lat >= SYDNEY.latMin &&
      geo.lat <= SYDNEY.latMax &&
      geo.lon >= SYDNEY.lonMin &&
      geo.lon <= SYDNEY.lonMax
    );
  }
  // No coordinates (often online or hidden address): only keep if it says Sydney/NSW.
  return /\b(sydney|nsw)\b/i.test(text.join(" "));
}
