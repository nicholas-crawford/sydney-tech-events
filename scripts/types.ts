/** One listing as a single source reports it, before dedupe. */
export type SourceListing = {
  source: string;
  title: string;
  /** UTC ISO 8601, e.g. 2026-12-08T07:00:00.000Z */
  start: string;
  end?: string;
  venue?: string;
  url: string;
  /** Date-only event (no time). start is that Sydney date at 01:00Z. */
  allDay?: boolean;
  /** Source is already tech-scoped (a curated calendar), so skip the keyword allowlist. */
  curated?: boolean;
};

/** A unique event after dedupe. */
export type Event = {
  id: string;
  title: string;
  start: string;
  end?: string;
  venue?: string;
  allDay?: boolean;
  primaryUrl: string;
  sources: { name: string; url: string }[];
};

/** Adapter pattern: every source exposes the same two steps. */
export type Adapter = {
  name: string;
  /** Lower wins when choosing primaryUrl (organiser 0, RSVP platform 1, aggregator 2). */
  rank: number;
  fetch(): Promise<string[]>;
  normalise(raw: string[]): SourceListing[];
};
