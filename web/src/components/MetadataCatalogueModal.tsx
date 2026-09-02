import React, { useState } from "react";
import { Database, ExternalLink, X } from "lucide-react";

interface MetadataCatalogueModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MetadataCatalogueModal: React.FC<MetadataCatalogueModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeMetaTab, setActiveMetaTab] = useState("siirrot");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Sulje metatiedot"
        className="fixed inset-0 bg-nc-void/80 backdrop-blur-md animate-in fade-in duration-300 w-full h-full cursor-default border-none"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="nv-glass border border-nc-border/60 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-300 z-10"
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-nc-border/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-nc-neon-teal" />
            <div className="text-left">
              <h2 className="text-sm md:text-base font-black text-nc-text uppercase tracking-wider leading-none mb-1">
                Paikkatieto & Metadata Catalogue
              </h2>
              <p className="text-[9px] text-nc-text-muted font-bold uppercase tracking-wide">
                Official Spatial Dataset Registry (Paikkatietohakemisto)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-nc-text/10 rounded-full border border-nc-border transition-colors group cursor-pointer"
          >
            <X className="w-4 h-4 text-nc-text-muted group-hover:text-nc-neon-red transition-colors" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-nc-border/30 px-6 shrink-0 bg-nc-text/5">
          {[
            { id: "siirrot", label: "Ajoneuvojen siirtokehotukset", desc: "Towing Warnings" },
            { id: "winkki", label: "Maanvuokraukset & Työt (WFS)", desc: "WFS Base Layers" }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveMetaTab(tab.id)}
              className={`py-3 px-4 border-b-2 text-left transition-all cursor-pointer flex flex-col justify-center ${
                activeMetaTab === tab.id
                  ? "border-nc-neon-teal text-white bg-nc-neon-teal/5"
                  : "border-transparent text-nc-text-muted hover:text-white"
              }`}
            >
              <span className="text-xs font-black uppercase tracking-wider">{tab.label}</span>
              <span className="text-[9px] text-nc-text-dim/80 font-bold uppercase tracking-widest">{tab.desc}</span>
            </button>
          ))}
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6 text-sm leading-relaxed text-nc-text text-left">
          {activeMetaTab === "siirrot" ? (
            <div className="space-y-6">
              {/* Headline Info */}
              <div className="p-4 bg-nc-neon-teal/5 border border-nc-neon-teal/20 rounded-2xl space-y-2 text-left">
                <div className="flex justify-between items-start flex-wrap gap-2">
                  <h3 className="text-sm font-black text-nc-neon-teal uppercase">
                    📋 Ajoneuvojen siirtokehotukset (Vehicle removal requests)
                  </h3>
                  <a
                    href="https://paikkatietohakemisto.fi"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[9px] font-black text-nc-neon-teal uppercase tracking-wider border border-nc-neon-teal/40 hover:border-nc-neon-teal px-2 py-0.5 rounded-lg hover:bg-nc-neon-teal/10 transition-all cursor-pointer"
                  >
                    Avaa Hakemistoon <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-xs text-nc-text-muted leading-relaxed">
                  Aineisto sisältää ajankohtaiset siirtokehotukset Helsingin alueella. Siirtokehotukset tulee tarkistaa liikennemerkeistä ja kadulla olevat merkit ovat velvoittavia.
                </p>
              </div>

              {/* Metadata Table */}
              <div className="border border-nc-border/40 rounded-2xl overflow-hidden shadow-md">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-nc-text/5 border-b border-nc-border/40">
                      <th className="p-3 font-black uppercase text-nc-text-dim text-[10px] w-1/3">Metadatatieto (Field)</th>
                      <th className="p-3 font-black uppercase text-nc-text-dim text-[10px]">Aineiston tiedot (Registry Value)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-nc-border/20">
                    {[
                      { field: "Nimi suomeksi", value: "Ajoneuvojen siirtokehotukset", highlight: true },
                      { field: "Nimi ruotsiksi", value: "Flyttningsuppmaningar för fordon" },
                      { field: "Nimi englanniksi", value: "Vehicle removal requests" },
                      { field: "Kuvaus", value: "Aineisto sisältää ajankohtaiset siirtokehotukset Helsingin alueella. Siirtokehotukset tulee tarkistaa liikennemerkeistä ja kadulla olevat merkit ovat velvoittavia." },
                      { field: "Käyttötarkoitus", value: "Ajoneuvojen siirrot, katualuevaraukset ja kunnossapitotyöt" },
                      { field: "Alueellinen kattavuus", value: "Helsingin alue" },
                      { field: "Koordinaatisto", value: "ETRS-GK25 (EPSG:3879)" },
                      { field: "Tallennusmuoto", value: "PostGIS-tietokanta" },
                      { field: "Ylläpitävä organisaatio", value: "Helsingin kaupunki, Kaupunkiympäristön toimiala, Palvelut ja luvat, Pysäköinninvalvonta ja pysäköintipalvelut" },
                      { field: "Ylläpitotiheys", value: "Aineistoa ylläpidetään ja päivitetään uusien siirtokehotusten osalta päivittäin" },
                      { field: "Tietolähde", value: "Pystytyspöytäkirjat (Mobilenote)" },
                      { field: "Tiedonkeruumenetelmä", value: "Mobiili- ja selainpohjainen sovellus siirtokehotusliikennemerkkien pystytyspöytäkirjojen dokumentointiin" },
                      { field: "Yhteyshenkilö 1", value: "Anne-Marie Kaksonen (Helsingin kaupunki, Kaupunkiympäristön toimiala, Palvelut ja luvat, Pysäköinninvalvonta ja pysäköintipalvelut)" },
                      { field: "Avainsanat", value: "Siirtokehotukset, ajoneuvojen siirrot, pystytyspöytäkirjat", badge: true },
                    ].map((row) => (
                      <tr key={row.field} className="hover:bg-nc-text/5 transition-colors">
                        <td className="p-3 font-bold text-nc-text-muted">{row.field}</td>
                        <td className="p-3 text-nc-text leading-relaxed">
                          {row.badge ? (
                            <div className="flex flex-wrap gap-1.5">
                              {row.value.split(", ").map((kw) => (
                                <span key={kw} className="px-2 py-0.5 bg-nc-neon-teal/10 border border-nc-neon-teal/20 text-nc-neon-teal text-[9px] uppercase font-bold rounded-lg tracking-wider">
                                  {kw}
                                </span>
                              ))}
                            </div>
                          ) : row.highlight ? (
                            <span className="font-extrabold text-nc-neon-teal">{row.value}</span>
                          ) : (
                            row.value
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* WFS Intro */}
              <div className="p-4 bg-orange-400/5 border border-orange-400/20 rounded-2xl space-y-2 text-left">
                <h3 className="text-sm font-black text-orange-400 uppercase">
                  🔶 Maanvuokraukset & Katuvaraukset (Helsinki WFS Interface)
                </h3>
                <p className="text-xs text-nc-text-muted leading-relaxed">
                  Application processes real-time geographical datasets from the City of Helsinki's public WFS endpoints (avoindata.hel.fi) to map active temporary land leases, street construction works, and parking restrictions.
                </p>
              </div>

              {/* WFS Layers */}
              <div className="border border-nc-border/40 rounded-2xl overflow-hidden shadow-md">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-nc-text/5 border-b border-nc-border/40">
                      <th className="p-3 font-black uppercase text-nc-text-dim text-[10px] w-1/3">WFS Layer Name</th>
                      <th className="p-3 font-black uppercase text-nc-text-dim text-[10px]">Dataset Purpose & Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-nc-border/20">
                    {[
                      { layer: "avoindata:Winkki_rents_audiences", desc: "Real-time active temporary land leases, outdoor terrace permits, container spaces, padel courts, and green yards." },
                      { layer: "avoindata:Winkki_works", desc: "Active street construction zones, pipe works, road maintenance, and temporary closures." },
                      { layer: "avoindata:Pysakointipaikat", desc: "Helsinki municipal public parking space geometries, zone divisions, and time rules." },
                      { layer: "avoindata:Pysakointivirheet", desc: "Historical municipal parking ticket density (165k mapped tickets) parsed to evaluate parking risk index." }
                    ].map((row) => (
                      <tr key={row.layer} className="hover:bg-nc-text/5 transition-colors">
                        <td className="p-3 font-mono font-bold text-nc-neon-teal">{row.layer}</td>
                        <td className="p-3 text-nc-text leading-relaxed">{row.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-nc-text/5 border-t border-nc-border/30 flex justify-between items-center shrink-0">
          <span className="text-[9px] text-nc-text-dim uppercase font-bold tracking-wider">
            Sivun ylläpito: Helsingin kaupunki / Paikkatietopalvelutiimi
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-nc-neon-teal/10 hover:bg-nc-neon-teal/20 border border-nc-neon-teal/40 hover:border-nc-neon-teal text-nc-neon-teal text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
          >
            Sulje
          </button>
        </div>
      </div>
    </div>
  );
};
