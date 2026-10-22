// Pages Function: Fintraffic park-and-ride live utilisation (parking.fintraffic.fi, CC BY 4.0).
// Upstream rejects browser CORS requests, so it is fetched here and cached for 60 s.
const UPSTREAM = "https://parking.fintraffic.fi/api/v1/utilizations";

export const onRequestGet = async () => {
  const up = await fetch(UPSTREAM, { headers: { accept: "application/json" }, cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit);
  if (!up.ok) return new Response(`upstream ${up.status}`, { status: 502 });
  return new Response(up.body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" },
  });
};
