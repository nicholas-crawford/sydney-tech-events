const USER_AGENT = "sydney-tech-events/0.1 (hackathon aggregator)";
const DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polite sequential fetch: one request at a time, ~1s apart. */
export async function fetchAllText(urls: string[]): Promise<string[]> {
  const bodies: string[] = [];
  for (const [i, url] of urls.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    bodies.push(await res.text());
  }
  return bodies;
}
