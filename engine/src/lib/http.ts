import axios, { type ResponseType } from "axios";

export const USER_AGENT = "Parkkis/2.7 (+https://github.com/traali/Parkkis; arto.oinonen@gmail.com)";

/** Exponential backoff with jitter: ~5 s, 10 s, 20 s, 40 s (capped at 60 s). */
export function backoffMs(attempt: number, base = 5000, cap = 60000): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.round(exp * (0.75 + Math.random() * 0.5));
}

/** GET with retries and backoff. Throws after the last attempt so callers fail loudly. */
export async function getWithRetry<T = any>(
  url: string,
  opts: { retries?: number; timeoutMs?: number; responseType?: ResponseType; headers?: Record<string, string> } = {},
): Promise<T> {
  const { retries = 5, timeoutMs = 90000, responseType = "json", headers = {} } = opts;
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        timeout: timeoutMs,
        responseType,
      });
      return res.data as T;
    } catch (err: any) {
      lastErr = err;
      console.warn(`[RETRY ${i + 1}/${retries}] ${url.slice(0, 100)}: ${err.message}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, backoffMs(i)));
    }
  }
  throw lastErr;
}

/** Fetch every page of a GeoServer WFS 2.0 JSON layer. */
export async function fetchWfsJsonAll(
  baseUrl: string,
  typeName: string,
  extra: Record<string, string> = {},
  // Helsinki GeoServer times out on 5000-row pages at busy hours; smaller pages finish.
  pageSize = 1000,
): Promise<any[]> {
  const all: any[] = [];
  for (let startIndex = 0; ; startIndex += pageSize) {
    const params = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeName,
      outputFormat: "application/json",
      srsName: "EPSG:4326",
      count: String(pageSize),
      startIndex: String(startIndex),
      ...extra,
    });
    const data = await getWithRetry(`${baseUrl}?${params}`);
    if (!data || !Array.isArray(data.features)) {
      throw new Error(`${typeName}: response is not a GeoJSON FeatureCollection`);
    }
    all.push(...data.features);
    console.log(`  ${typeName}: +${data.features.length} (total ${all.length})`);
    if (data.features.length < pageSize) return all;
  }
}
