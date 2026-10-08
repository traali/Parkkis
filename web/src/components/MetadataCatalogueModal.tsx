import React from "react";
import { Database, ExternalLink, X } from "lucide-react";
import type { DataFacts } from "../hooks/useParkingLayers";

interface MetadataCatalogueModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataFacts: DataFacts | null;
}

interface SourceRow {
  name: string;
  what: string;
  freshness: string;
  owner: string;
  license: string;
  url: string;
}

const fiDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("fi-FI") : "ei tiedossa";

/** Every dataset the map really uses, with where it comes from and how fresh it is. */
export const MetadataCatalogueModal: React.FC<MetadataCatalogueModalProps> = ({
  isOpen,
  onClose,
  dataFacts,
}) => {
  if (!isOpen) return null;

  const sources: SourceRow[] = [
    {
      name: "Pysäköintipaikat (avoindata:Pysakointipaikat_alue)",
      what: "Kantakaupungin ja asukaspysäköintivyöhykkeiden kadunvarsipaikat: maksullisuus, aikarajat ja vyöhykkeet. Muualla Helsingissä ja naapurikunnissa paikkoja ei ole tässä aineistossa.",
      freshness: `Tallenne, päivitetty ${fiDate(dataFacts?.slotsUpdated)}`,
      owner: "Helsingin kaupunki",
      license: "CC BY 4.0",
      url: "https://hri.fi/data/fi/dataset/helsingin-kantakaupungin-ja-asukaspysakointivyohykkeiden-pysakointipaikat",
    },
    {
      name: "Pysäköintivirheet (avoindata:Pysakointivirheet)",
      what: `Annetut pysäköintivirhemaksut${dataFacts?.fineYears ? ` vuodelta ${dataFacts.fineYears}` : ""}. Mukana vain ne, joiden sijainti on todellinen${dataFacts ? ` (${dataFacts.fineCount.toLocaleString("fi-FI")} kpl)` : ""}.`,
      freshness: "Tallenne. Kaupunki on julkaissut vain tämän vuoden.",
      owner: "Helsingin kaupunki",
      license: "CC BY 4.0",
      url: "https://hri.fi/data/fi/dataset/pysakointivirheet-helsingissa",
    },
    {
      name: "Kaivuilmoitukset ja tilapäiset liikennejärjestelyt",
      what: "Tänään voimassa olevat katutyöt",
      freshness: "Haetaan suoraan kaupungilta joka kerta",
      owner: "Helsingin kaupunki",
      license: "CC BY 4.0",
      url: "https://kartta.hel.fi/",
    },
    {
      name: "Katualueen vuokraukset (avoindata:Winkki_rents_audiences)",
      what: "Tänään voimassa olevat katualueen vuokra-alueet",
      freshness: "Haetaan suoraan kaupungilta joka kerta",
      owner: "Helsingin kaupunki",
      license: "CC BY 4.0",
      url: "https://kartta.hel.fi/",
    },
    {
      name: "Liikennemerkit (Digiroad)",
      what: "Pysäköintiin liittyvät liikennemerkit pääkaupunkiseudulla",
      freshness: `Tallenne, uusin muutos ${fiDate(dataFacts?.signsUpdated)}`,
      owner: "Väylävirasto",
      license: "CC BY 4.0",
      url: "https://vayla.fi/vaylista/aineistot/avoindata/digiroad",
    },
    {
      name: "Liityntäpysäköinti",
      what: "Liityntäpysäköintipaikat, paikkamäärät ja tila",
      freshness: "Tallenne",
      owner: "Fintraffic",
      license: "CC BY 4.0",
      url: "https://parking.fintraffic.fi/",
    },
    {
      name: "Pysäköintialueet (Parkkihubi)",
      what: "Pysäköintialueiden rajat ja arvioitu paikkamäärä",
      freshness: "Tallenne",
      owner: "Helsingin kaupunki / Parkkihubi",
      license: "Avoin rajapinta",
      url: "https://pubapi.parkkiopas.fi/public/v1/",
    },
    {
      name: "Osoitehaku (Palvelukartta)",
      what: "Osoitteiden haku",
      freshness: "Haetaan suoraan joka haulla",
      owner: "Helsingin kaupunki",
      license: "CC BY 4.0",
      url: "https://api.hel.fi/servicemap/v2/",
    },
    {
      name: "Taustakartta",
      what: "Kartan pohja",
      freshness: "Suora",
      owner: "© OpenStreetMap-tekijät, © CARTO",
      license: "ODbL",
      url: "https://www.openstreetmap.org/copyright",
    },
  ];

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Sulje tietolähteet"
        className="fixed inset-0 bg-nc-void/80 backdrop-blur-md animate-in fade-in duration-300 w-full h-full cursor-default border-none"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sources-title"
        className="nv-glass border border-nc-border/60 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-300 z-10"
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-nc-border/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-nc-neon-teal" />
            <div className="text-left">
              <h2 id="sources-title" className="text-sm md:text-base font-black text-nc-text uppercase tracking-wider leading-none mb-1">
                Tietolähteet
              </h2>
              <p className="text-[10px] text-nc-text-muted font-bold">
                Kaikki kartan tiedot tulevat näistä avoimista lähteistä. Kyltti kadulla on aina oikeassa.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sulje"
            className="p-1.5 hover:bg-nc-text/10 rounded-full border border-nc-border transition-colors group cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-4 h-4 text-nc-text-muted group-hover:text-nc-neon-red transition-colors" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-3 text-sm leading-relaxed text-nc-text text-left">
          {sources.map((src) => (
            <div key={src.name} className="border border-nc-border/40 rounded-2xl p-4 space-y-1">
              <div className="flex justify-between items-start gap-2 flex-wrap">
                <h3 className="text-xs font-black text-nc-neon-teal">{src.name}</h3>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-nc-neon-teal hover:underline"
                >
                  Lähde <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-xs text-nc-text">{src.what}</p>
              <p className="text-[10px] text-nc-text-muted">
                {src.owner} · {src.license} · {src.freshness}
              </p>
            </div>
          ))}
          <p className="text-[10px] text-nc-text-dim">
            Sakkoriski (1–10) lasketaan suoraan sakkoaineistosta: paikan lähellä (noin 20 m) annettujen sakkojen määrä.
            Se kertoo menneestä, ei takaa mitään tänään.
          </p>
        </div>

        <div className="p-4 bg-nc-text/5 border-t border-nc-border/30 flex justify-end items-center shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 min-h-[44px] bg-nc-neon-teal/10 hover:bg-nc-neon-teal/20 border border-nc-neon-teal/40 hover:border-nc-neon-teal text-nc-neon-teal text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
          >
            Sulje
          </button>
        </div>
      </div>
    </div>
  );
};
