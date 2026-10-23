/**
 * Finnish names for the traffic signs and additional plates in the Digiroad sign data.
 * Names follow the official sign list (Tieliikennelaki 729/2018, Väylävirasto).
 */
export const SIGN_NAMES: Record<string, string> = {
  C32: "Nopeusrajoitus",
  C33: "Nopeusrajoitus päättyy",
  C34: "Nopeusrajoitusalue",
  C35: "Nopeusrajoitusalue päättyy",
  C37: "Pysäyttäminen kielletty",
  C38: "Pysäköinti kielletty",
  C39: "Pysäköintikieltoalue",
  C40: "Pysäköintikieltoalue päättyy",
  C41: "Taksiasema-alue",
  C42: "Taksin pysäyttämispaikka",
  C43: "Kuormauspaikka",
  "C44.1": "Vuoropysäköinti",
  "C44.2": "Vuoropysäköinti",
  E2: "Pysäköintipaikka",
  "E3.1": "Liityntäpysäköintipaikka",
  "E3.2": "Liityntäpysäköintipaikka",
  "E3.3": "Liityntäpysäköintipaikka",
  "E3.4": "Liityntäpysäköintipaikka",
  "E3.5": "Liityntäpysäköintipaikka",
  "E4.1": "Ajoneuvojen sijoitus pysäköintipaikalla",
  "E4.2": "Ajoneuvojen sijoitus pysäköintipaikalla",
  "E4.3": "Ajoneuvojen sijoitus pysäköintipaikalla",
  E22: "Taajama",
  E23: "Taajama päättyy",
  E24: "Pihakatu",
  E25: "Pihakatu päättyy",
  E26: "Kävelykatu",
  E27: "Kävelykatu päättyy",
  E28: "Pyöräkatu",
  E29: "Pyöräkatu päättyy",
};

/** Additional plates (lisäkilvet). */
export const PLATE_NAMES: Record<string, string> = {
  H1: "Kohde risteävässä suunnassa",
  "H2.1": "Kohde nuolen suunnassa",
  "H2.2": "Kohde nuolen suunnassa",
  "H2.3": "Kohde nuolen suunnassa",
  H3: "Vaikutusalueen pituus",
  H4: "Etäisyys kohteeseen",
  H5: "Etäisyys pakolliseen pysäyttämiseen",
  "H9.1": "Vaikutusalue molempiin suuntiin",
  "H9.2": "Vaikutusalue molempiin suuntiin",
  H10: "Vaikutusalue nuolen suuntaan",
  H11: "Vaikutusalue päättyy",
  "H12.1": "Henkilöauto",
  "H12.2": "Linja-auto",
  "H12.3": "Kuorma-auto",
  "H12.4": "Pakettiauto",
  "H12.5": "Matkailuperävaunu",
  "H12.6": "Matkailuauto",
  "H12.7": "Invalidin ajoneuvo",
  "H12.8": "Moottoripyörä",
  "H12.9": "Mopo",
  "H12.10": "Polkupyörä",
  "H13.1": "Pysäköintitapa",
  "H13.2": "Pysäköintitapa",
  H14: "Kielletty vaarallisten aineiden kuljetukselta",
  H15: "Kielletty vaarallisten aineiden kuljetukselta",
  "H17.1": "Voimassa arkisin (ma–pe)",
  "H17.2": "Voimassa lauantaisin",
  "H17.3": "Voimassa sunnuntaisin ja pyhinä",
  H18: "Aikarajoitus",
  "H19.1": "Pysäköintikiekko pakollinen",
  "H19.2": "Pysäköintikiekko pakollinen",
  H20: "Maksullinen pysäköinti",
  H21: "Latauspaikka",
  "H23.1": "Kaksisuuntainen pyörätie",
  "H23.2": "Kaksisuuntainen pyörätie",
  H24: "Tekstillinen lisäkilpi",
  H25: "Huoltoajo sallittu",
};

const SPEED_SIGNS = new Set(["C32", "C33", "C34", "C35"]);

const clean = (v: unknown) => String(v ?? "").trim();

/** "C38" → "Pysäköinti kielletty"; "C32" with arvo 30 → "Nopeusrajoitus 30 km/h". Unknown codes stay as codes. */
export function signLabel(type: unknown, arvo?: unknown): string {
  const t = clean(type).toUpperCase();
  const name = SIGN_NAMES[t] ?? PLATE_NAMES[t] ?? t;
  const v = clean(arvo);
  return SPEED_SIGNS.has(t) && v && v !== "0" ? `${name} ${v} km/h` : name;
}

/** Hyphen between numbers → en dash, as in Finnish time ranges ("8-17" → "8–17"). */
export function fiRange(text: string): string {
  return text.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
}

export interface PlateRow {
  /** Plate slot 1–5 in the source data. */
  slot: number;
  code: string;
  label: string;
  text: string;
}

/**
 * The additional plates of one sign, in plate order, each with its Finnish name and the text on it.
 * Plate text is shown as written; nothing is inferred from a missing plate.
 */
export function plateRows(sign: Record<string, unknown>): PlateRow[] {
  const rows: PlateRow[] = [];
  for (let n = 1; n <= 5; n++) {
    const code = clean(sign[`kilpityyp${n}`]).toUpperCase();
    const text = fiRange(clean(sign[`kilpi_txt${n}`]));
    if (!code && !text) continue;
    rows.push({ slot: n, code, label: code ? (PLATE_NAMES[code] ?? `Lisäkilpi ${code}`) : "Lisäkilpi", text });
  }
  return rows;
}

/** Times in parentheses on Finnish parking plates apply on Saturdays. */
export function hasSaturdayTimes(rows: PlateRow[]): boolean {
  return rows.some((r) => /\(\s*\d/.test(r.text));
}

/** Sign colour group on the map: prohibitions, parking places, street types, everything else. */
export const PROHIBITION_SIGNS = ["C37", "C38", "C39", "C44.1", "C44.2"];
export const PARKING_SIGNS = ["E2", "E3.1", "E3.2", "E3.3", "E3.4", "E3.5"];
