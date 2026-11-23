const USER_AGENT = "sydney-tech-events/0.1 (hackathon aggregator)";
const DELAY_MS = 1000;
const TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Last request time per host, so politeness holds across adapters and call sites.
const lastRequest = new Map<string, number>();

/** Polite fetch: one request at a time per host, ~1s apart, honest User-Agent, timeout. */
export async function fetchText(url: string, retries = 1): Promise<string> {
  const host = new URL(url).host;
  const wait = (lastRequest.get(host) ?? 0) + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest.set(host, Date.now());

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // 429 Too Many Requests: back off as the server asks (capped), then retry once.
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Math.min(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000,
      60_000,
    );
    console.warn(`  429 from ${host}; waiting ${backoff / 1000}s`);
    await sleep(backoff);
    return fetchText(url, retries - 1);
  }

  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

/** Fetch several URLs in sequence; any failure fails the whole batch. */
export async function fetchAllText(urls: string[]): Promise<string[]> {
  const bodies: string[] = [];
  for (const url of urls) bodies.push(await fetchText(url));
  return bodies;
}
