// Digiroad parking-related traffic signs for Helsinki (91), Espoo (49),
// Vantaa (92) and Kauniainen (235). Väylävirasto / Digiroad, CC BY 4.0.
import { writeDataset, runMain } from "./lib/cache";
import { fetchWfsJsonAll } from "./lib/http";

const DIGIROAD_WFS = "https://avoinapi.vaylapilvi.fi/vaylatiedot/digiroad/ows";

export const SIGN_TYPES = [
  "C37", "C38", "C39", "C40", "C44.1", "C44.2",
  "E2", "E3.1", "E3.2", "E3.3", "E3.4", "E3.5",
  "E4.1", "E4.2", "E4.3", "E22", "E23", "E24", "E26", "E28",
  "C32", "C34",
  "H12.1", "H12.2", "H17.1", "H17.2", "H17.3", "H18", "H19", "H20", "H21", "H24", "H25",
];

if (require.main === module) {
  runMain("Digiroad sign harvest", async () => {
    const cql = `kuntakoodi IN (91, 49, 92, 235) AND tyyppi IN (${SIGN_TYPES.map((t) => `'${t}'`).join(",")})`;
    const features = await fetchWfsJsonAll(DIGIROAD_WFS, "dr_liikennemerkit", { cql_filter: cql });
    await writeDataset("signs", features, { source: `${DIGIROAD_WFS} (dr_liikennemerkit)`, licence: "CC BY 4.0, Väylävirasto / Digiroad" });
  });
}
