// Fintraffic park-and-ride facilities (CC BY 4.0). The facility id is kept so the
// web app can join live utilizations (/api/v1/utilizations) to each facility.
import { writeDataset, runMain } from "./lib/cache";
import { getWithRetry, USER_AGENT } from "./lib/http";

const LIIPI_API = "https://parking.fintraffic.fi/api/v1/facilities.geojson";

runMain("Fintraffic facilities harvest", async () => {
  const data: any = await getWithRetry(LIIPI_API, { headers: { "Digitraffic-User": USER_AGENT } });
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("Fintraffic: invalid GeoJSON response");
  }
  const features = data.features.map((f: any) => ({
    ...f,
    properties: { ...f.properties, facility_id: f.id ?? f.properties?.id ?? null },
  }));
  await writeDataset("liipi", features, { source: LIIPI_API, licence: "CC BY 4.0, Fintraffic" });
});
