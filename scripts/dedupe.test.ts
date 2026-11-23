import { describe, expect, it } from "vite-plus/test";
import { dedupe, likelySameEvent, listingKey } from "./dedupe.ts";
import type { SourceListing } from "./types.ts";

const rank = new Map([
  ["Luma", 1],
  ["Meetup", 1],
  ["Eventbrite", 1],
]);

const listing = (over: Partial<SourceListing>): SourceListing => ({
  source: "Luma",
  title: "Untitled",
  start: "2026-12-08T07:00:00.000Z",
  url: `https://example.com/${Math.random()}`,
  ...over,
});

// Cases taken from real ingest output.
describe("likelySameEvent", () => {
  it("does not merge similar titles from the same source (different NeurIPS parties)", () => {
    const a = listing({ title: "Turing @ NeurIPS: After Hours" });
    const b = listing({
      title: "Cartesia x NeurIPS: After Hours",
      start: "2026-12-08T09:00:00.000Z",
    });
    expect(likelySameEvent(a, b)).toBe(false);
  });

  it("does not merge them across sources either: 0.73 similarity is below the bar", () => {
    const a = listing({ title: "Turing @ NeurIPS: After Hours" });
    const b = listing({ source: "Meetup", title: "Cartesia x NeurIPS: After Hours" });
    expect(likelySameEvent(a, b)).toBe(false);
  });

  it("merges the same meetup listed with and without punctuation", () => {
    const a = listing({ source: "Meetup", title: "Sydney Monthly Social Tech Meetup!" });
    const b = listing({ source: "Eventbrite", title: "Sydney Monthly Social Tech Meetup" });
    expect(likelySameEvent(a, b)).toBe(true);
  });

  it("merges when one title is a word-subset of the other", () => {
    const a = listing({ title: "DevFest Extended: Android for the Agentic Era" });
    const b = listing({
      source: "Meetup",
      title: "GDG Sydney DevFest Extended: Android for the Agentic Era 2026",
    });
    expect(likelySameEvent(a, b)).toBe(true);
  });

  it("does not merge same-ish titles hours apart (a different session)", () => {
    const a = listing({
      source: "Meetup",
      title: "AI & Tech Community Monthly Meet up",
      start: "2026-11-26T02:00:00.000Z",
    });
    const b = listing({
      source: "Eventbrite",
      title: "AI & Tech Community Monthly Meetup",
      start: "2026-11-26T06:30:00.000Z",
    });
    expect(likelySameEvent(a, b)).toBe(false);
  });
});

describe("dedupe", () => {
  it("merges on an explicit cross-link and puts both sources on one event", () => {
    const eb = listing({
      source: "Eventbrite",
      title: "FUN Sydney",
      url: "https://www.eventbrite.com.au/e/2003645208756",
    });
    const luma = listing({
      title: "FUN Sydney: The Failures Behind The Headlines",
      links: ["https://eventbrite.com.au/e/2003645208756/"],
    });
    const events = dedupe([luma, eb], rank);
    expect(events).toHaveLength(1);
    expect(events[0].sources.map((s) => s.name)).toEqual(["Luma", "Eventbrite"]);
    expect(events[0].mergedFrom).toHaveLength(2);
  });

  it("shows a cross-link as a source even when the linked listing was filtered out", () => {
    const luma = listing({
      title: "FUN Sydney",
      links: ["https://www.eventbrite.com.au/e/2003645208756"],
    });
    const [event] = dedupe([luma], rank);
    expect(event.sources).toEqual([
      { name: "Luma", url: luma.url },
      { name: "Eventbrite", url: "https://www.eventbrite.com.au/e/2003645208756" },
    ]);
  });

  it("shows one pill per source when a source lists the same event twice", () => {
    const first = listing({
      title: "FUN Sydney: The Failures Behind The Headlines",
      url: "https://luma.com/event/evt-a",
    });
    const second = listing({
      title: "FUN Sydney: The Failures Behind The Headlines",
      url: "https://luma.com/event/evt-b",
    });
    const [event] = dedupe([first, second], rank);
    expect(event.sources).toEqual([{ name: "Luma", url: "https://luma.com/event/evt-a" }]);
    expect(event.primaryUrl).toBe("https://luma.com/event/evt-a");
  });

  it("respects a 'separate' override", () => {
    const a = listing({ source: "Meetup", title: "Sydney Monthly Social Tech Meetup!" });
    const b = listing({ source: "Eventbrite", title: "Sydney Monthly Social Tech Meetup" });
    // Same normalised title → same key, so 'separate' on identical keys can't split them;
    // use titles that only fuzzy-match.
    const c = listing({ source: "Eventbrite", title: "Sydney Monthly Social Tech Meetup (Nov)" });
    expect(dedupe([a, c], rank)).toHaveLength(1);
    expect(dedupe([a, c], rank, { separate: [[listingKey(a), listingKey(c)]] })).toHaveLength(2);
    expect(dedupe([a, b], rank)).toHaveLength(1);
  });

  it("applies a 'merge' override across different dates", () => {
    const a = listing({ title: "HarbourHack", start: "2027-01-29T01:00:00.000Z" });
    const b = listing({
      source: "Eventbrite",
      title: "Harbour Hack 2027",
      start: "2027-01-30T01:00:00.000Z",
    });
    expect(dedupe([a, b], rank)).toHaveLength(2);
    expect(dedupe([a, b], rank, { merge: [[listingKey(a), listingKey(b)]] })).toHaveLength(1);
  });
});
