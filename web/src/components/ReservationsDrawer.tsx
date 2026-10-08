import React from "react";
import { Search, X, Calendar, MapPin } from "lucide-react";
import { parseHelCaseTypo, renderTextWithLinks } from "../lib/helsinkiCaseParser";
import type { LiveStatus } from "../hooks/useParkingLayers";

interface ReservationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: any[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  category: string;
  onCategoryChange: (cat: string) => void;
  sortBy: string;
  onSortByChange: (sort: string) => void;
  onSelectReservation: (feat: any) => void;
  status: LiveStatus;
}

export const ReservationsDrawer: React.FC<ReservationsDrawerProps> = ({
  isOpen,
  onClose,
  reservations,
  searchQuery,
  onSearchChange,
  category,
  onCategoryChange,
  sortBy,
  onSortByChange,
  onSelectReservation,
  status,
}) => {
  return (
    <div
      className={`fixed right-6 top-24 bottom-32 w-96 z-55 transition-all duration-500 transform flex flex-col pointer-events-auto ${
        isOpen ? "translate-x-0 opacity-100 scale-100" : "translate-x-full opacity-0 scale-95 pointer-events-none"
      }`}
    >
      <div className="nv-glass border border-nc-border rounded-3xl p-4 flex flex-col h-full overflow-hidden shadow-2xl relative">
        {/* Header */}
        <div className="flex justify-between items-center pb-3 border-b border-nc-border">
          <div>
            <h2 className="text-nv-text-sm font-black text-nc-text flex items-center gap-1.5 uppercase">
              📋 Katualueen vuokraukset
            </h2>
            <span className="text-[10px] text-nc-text-muted uppercase font-bold tracking-wider">
              {status === "loading"
                ? "Haetaan Helsingin kaupungilta..."
                : status === "error"
                  ? "Tietoja ei saatu juuri nyt"
                  : `${reservations.length} voimassa tänään · Lähde: Helsingin kaupunki`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-nc-text/10 rounded-full border border-nc-border transition-colors group cursor-pointer"
          >
            <X className="w-4 h-4 text-nc-text-muted group-hover:text-nc-neon-red transition-colors" />
          </button>
        </div>

        {/* Filtering & Sorting Controls */}
        <div className="space-y-3 py-3 border-b border-nc-border shrink-0">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-3 text-nc-neon-teal" />
            <input
              type="text"
              placeholder="Hae varausta, hakijaa tai tunnusta"
              className="w-full pl-9 pr-8 py-2 bg-nc-void/60 border border-nc-border/60 rounded-2xl text-xs text-nc-text placeholder:text-nc-text-dim focus:outline-none focus:border-nc-neon-teal transition-colors"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-3 p-0.5 hover:bg-nc-text/10 rounded-full cursor-pointer"
              >
                <X className="w-3.5 h-3.5 text-nc-text-dim" />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
            {[
              { id: "all", label: "Kaikki" },
              { id: "paid", label: "🅿️ Pysäköinti" },
              { id: "lisapihat", label: "🔶 Lisäpihat" },
              { id: "other", label: "Muut" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onCategoryChange(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap border cursor-pointer ${
                  category === tab.id
                    ? "border-orange-400 text-orange-400 bg-orange-400/10 shadow-[0_0_10px_rgba(251,146,60,0.1)]"
                    : "border-nc-border/40 text-nc-text-dim hover:bg-nc-text/5"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sorting controls */}
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-nc-text-dim">
            <span>Sort by</span>
            <div className="flex gap-1.5">
              {[
                { id: "start", label: "Uusimmat" },
                { id: "end", label: "Päättyvät" },
                { id: "id", label: "Lupanumero" },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSortByChange(s.id)}
                  className={`px-2 py-0.5 rounded-lg border text-[9px] transition-all cursor-pointer ${
                    sortBy === s.id
                      ? "border-nc-neon-teal text-nc-neon-teal bg-nc-neon-teal/10 font-black"
                      : "border-transparent text-nc-text-dim hover:text-nc-text"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Reservations Cards List */}
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-2.5 pt-3 pr-1">
          {reservations.length > 0 ? (
            reservations.map((feat: any, idx) => {
              const props = feat.properties || {};
              const start = props.event_startdate_txt || props.lic_startdate_txt || "?";
              const end = props.event_endtdate_txt || props.lic_enddate_txt || "?";
              const subject = props.rental_subject || "Vuokraus";
              const desc = props.event_description || props.licence_description || "";
              const applicant = props.licence_applicant_company && props.licence_applicant_company !== "N/A" ? props.licence_applicant_company : null;
              const loc = props.location_description && props.location_description !== "N/A" ? props.location_description : null;
              const isParking = String(subject).toLowerCase().includes("pysäköinti") || String(subject).toLowerCase().includes("pysakoiti");

              const allText = `${subject} ${desc} ${props.licence_identifier || ""}`;
              const caseDetails = parseHelCaseTypo(allText);

              return (
                <button
                  type="button"
                  key={props.licence_identifier || idx}
                  onClick={() => onSelectReservation(feat)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectReservation(feat);
                    }
                  }}
                  className="w-full p-3 bg-nc-void/40 border border-nc-border/40 hover:border-orange-400/50 hover:bg-nc-void/70 rounded-2xl cursor-pointer transition-all duration-200 shadow-md group space-y-2 relative overflow-hidden text-left"
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${isParking ? "bg-orange-400" : "bg-orange-300/60"}`} />

                  {/* Subject & Status */}
                  <div className="flex justify-between items-start gap-1 pl-1">
                    <h4 className="text-xs font-black text-nc-text group-hover:text-orange-400 transition-colors uppercase leading-tight">
                      {isParking ? "🅿️" : "🔶"} {subject}
                    </h4>
                    <span className="bg-orange-400/20 text-orange-400 border border-orange-400/30 font-black px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider shrink-0">
                      Voimassa
                    </span>
                  </div>

                  {/* Description */}
                  {desc && (
                    <p className="text-[11px] text-nc-text-muted leading-snug pl-1">
                      {renderTextWithLinks(desc)}
                    </p>
                  )}

                  {/* Decision Link Badge & Live Fetcher */}
                  {caseDetails && (
                    <div className="pl-1 pt-0.5 flex flex-wrap items-center gap-2">
                      <a
                        href={`https://paatokset.hel.fi/fi/asia/${caseDetails.caseCode}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 border rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
                          caseDetails.hasTypo
                            ? "bg-nc-gold/10 hover:bg-nc-gold/20 border-nc-gold/40 text-nc-gold"
                            : "bg-nc-neon-teal/10 hover:bg-nc-neon-teal/20 border-nc-neon-teal/30 text-nc-neon-teal hover:border-nc-neon-teal/50"
                        }`}
                        onClick={(e) => e.stopPropagation()}
                        title={caseDetails.hasTypo ? `Alkuperäinen merkintä: ${caseDetails.original}` : undefined}
                      >
                        📜 Päätös: {caseDetails.normalized}
                      </a>

                    </div>
                  )}

                  {/* Applicant & Dates */}
                  <div className="flex flex-col gap-1 text-[10px] text-nc-text-dim border-t border-nc-border/20 pt-1.5 pl-1">
                    {applicant && (
                      <div className="font-bold text-nc-text-muted truncate">
                        🏢 {applicant}
                      </div>
                    )}
                    <div className="flex justify-between items-center text-[9px]">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-nc-neon-teal/70" />
                        <span>{start} → {end}</span>
                      </div>
                      {loc && (
                        <div className="flex items-center gap-1 max-w-[150px] truncate">
                          <MapPin className="w-3.5 h-3.5 text-orange-400/70" />
                          <span title={loc}>{loc}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <p className="text-xs font-bold text-nc-text-muted">
                {status === "error" ? "Vuokraustietoja ei saatu Helsingin kaupungilta" : status === "loading" ? "Haetaan..." : "Ei osumia"}
              </p>
              {status === "ok" && (
                <p className="text-[10px] text-nc-text-dim max-w-[200px]">Kokeile toista hakusanaa tai luokkaa.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
