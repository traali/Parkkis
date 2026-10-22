// Pages Function: same-origin, cached proxy for a fixed list of Helsinki open-data WFS layers
// (Helsingin kaupunki, CC BY 4.0). Read-only GetFeature only; any other layer or request is refused.
const UPSTREAM = "https://kartta.hel.fi/ws/geoserver/avoindata/wfs";
const ALLOWED = new Set([
  "avoindata:Tapahtumat_alue",
  "avoindata:Lyhyt_maanvuokraus_alue",
  "avoindata:Lyhyt_maanvuokraus_piste",
  "avoindata:Matkailuliikenne_pysakointipaikat_piste",
  "avoindata:Pyorailykartta_2026_paapyorareitti",
  "avoindata:Pyorailykartta_2026_muu_pyorareitti",
  "avoindata:Esteettomyysreitti_viiva",
  "avoindata:Vastuualue_rya_urakkarajat",
  "avoindata:Pysakoinnin_maksuvyohykkeet_alue",
  "avoindata:Asukas_ja_yrityspysakointivyohykkeet_alue",
  "avoindata:Talvihoidon_priorisoitu_reitisto",
]);

export const onRequestGet = async ({ request }: { request: Request }) => {
  const q = new URL(request.url).searchParams;
  const typeName = q.get("typeName") ?? "";
  if (!ALLOWED.has(typeName) || (q.get("request") ?? "").toLowerCase() !== "getfeature" || request.url.length > 2000) {
    return new Response("not allowed", { status: 400 });
  }
  const out = new URLSearchParams(q);
  out.set("service", "WFS");
  out.set("outputFormat", "application/json");
  let lastStatus = 0;
  for (let i = 0; i < 2; i++) {
    try {
      const up = await fetch(`${UPSTREAM}?${out}`, { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
      if (up.ok) {
        return new Response(up.body, {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
        });
      }
      lastStatus = up.status;
    } catch {
      lastStatus = 0;
    }
  }
  return new Response(`upstream ${lastStatus || "unreachable"}`, { status: 502 });
};
