import React from "react";
import { Navigation, Shield } from "lucide-react";
import { parseJsonSafe, getCategoryLabel, getSignVisuals, getSignLabel } from "../lib/mapThemes";
import { renderTextWithLinks } from "../lib/helsinkiCaseParser";

export interface HoverInfo {
  longitude: number;
  latitude: number;
  properties: Record<string, string | number | boolean | null>;
  isRoadworkConflict: boolean;
  stackedSigns?: Record<string, string | number | boolean | null>[];
  layerId?: string;
}

interface ParkingPopupProps {
  hoverInfo: HoverInfo;
  selectedAddress: { name: string } | null;
  distance: string | null;
  walkTime: (meters: string) => number;
}

export const ParkingPopup: React.FC<ParkingPopupProps> = ({
  hoverInfo,
  selectedAddress,
  distance,
  walkTime,
}) => {
  return (
    <div className="p-3 bg-nc-void text-nc-text rounded-lg border border-nc-border shadow-xl min-w-[240px]">
      {hoverInfo.layerId === "liipi-points" ? (
        <>
          <div className="flex justify-between items-start mb-2 border-b border-nc-border pb-2">
            <h3 className="font-bold text-nc-neon-teal leading-tight flex items-center gap-1.5">
              🚲 Park & Ride
            </h3>
            <span className="bg-nc-neon-teal/20 text-nc-neon-teal font-black px-2 py-0.5 rounded text-[10px] uppercase">
              {String(hoverInfo.properties.status || "").replace("_", " ")}
            </span>
          </div>
          <div className="space-y-2 mt-2">
            <p className="text-sm font-bold text-nc-text leading-snug">
              {(() => {
                const nameObj = parseJsonSafe(hoverInfo.properties.name);
                return nameObj?.fi || nameObj?.en || nameObj?.sv || String(hoverInfo.properties.name || "");
              })()}
            </p>
            <div className="bg-nc-text/5 border border-nc-border/40 rounded-xl p-3 space-y-1.5">
              <span className="block text-[9px] text-nc-text-dim uppercase font-black tracking-wider">
                Commuter Capacity
              </span>
              {(() => {
                const capObj = parseJsonSafe(hoverInfo.properties.builtCapacity);
                return capObj ? (
                  Object.entries(capObj).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="text-nc-text-muted capitalize font-medium">
                        {key === "CAR" ? "🚗 Car Spaces" : key === "BICYCLE" ? "🚲 Bicycle Spaces" : `🔌 ${key}`}
                      </span>
                      <span className="font-bold text-nc-text">{String(val)} slots</span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-nc-text-muted italic">Capacity not specified</span>
                );
              })()}
            </div>
          </div>
        </>
      ) : hoverInfo.layerId === "hubi-lines" ? (
        <>
          <div className="flex justify-between items-start mb-2 border-b border-nc-border pb-2">
            <h3 className="font-bold text-nc-neon-teal leading-tight flex items-center gap-1.5">
              🏢 Public Facility
            </h3>
            <span className="bg-nc-neon-teal/20 text-nc-neon-teal font-black px-2 py-0.5 rounded text-[10px] uppercase">
              Parkkihubi
            </span>
          </div>
          <div className="space-y-2 mt-2">
            <p className="text-[10px] text-nc-text-dim uppercase font-black">Facility ID</p>
            <p className="text-xs font-mono text-nc-text leading-tight truncate">{String(hoverInfo.properties.id || "")}</p>
            <div className="bg-nc-text/5 border border-nc-border/40 rounded-xl p-3 flex justify-between items-center">
              <div>
                <span className="block text-[9px] text-nc-text-dim uppercase font-black tracking-wider">
                  Estimated Capacity
                </span>
                <span className="text-xs font-medium text-nc-text-muted">Public Hub</span>
              </div>
              <span className="text-sm font-black text-nc-text">
                {hoverInfo.properties.capacity_estimate ? `${hoverInfo.properties.capacity_estimate} slots` : "Open space"}
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between items-start mb-2 border-b border-nc-border pb-2">
            <h3 className="font-bold text-nc-text leading-tight">
              {hoverInfo.properties.tyyppi || "Parking Area"}
            </h3>
            {hoverInfo.properties.is_new && (
              <span className="bg-nc-neon-teal text-nc-deep font-black px-2 py-0.5 rounded text-[10px] ml-2 animate-pulse">
                NEW RULE
              </span>
            )}
            {hoverInfo.properties.asukaspysakointitunnus && (
              <span className="bg-nc-purple text-nc-text font-black px-2 py-0.5 rounded text-xs ml-2 shrink-0 shadow-[0_0_10px_rgba(168,85,247,0.5)]">
                Zone {hoverInfo.properties.asukaspysakointitunnus}
              </span>
            )}
          </div>

          {/* Parking Risk & Violation count */}
          <div className="flex items-center justify-between mb-4 bg-nc-text/5 rounded-xl p-3 border border-nc-border">
            <div className="flex flex-col">
              <span className="text-[10px] text-nc-text-dim uppercase font-black tracking-wider">
                Parking Risk
              </span>
              <span
                className={`text-xl font-black ${
                  hoverInfo.isRoadworkConflict ||
                  Number(hoverInfo.properties.risk_score ?? 0) > 7
                    ? "text-nc-danger"
                    : Number(hoverInfo.properties.risk_score ?? 0) > 3
                      ? "text-nc-gold"
                      : "text-nc-neon-teal"
                }`}
              >
                {hoverInfo.isRoadworkConflict
                  ? "Restricted"
                  : Number(hoverInfo.properties.risk_score ?? 0) > 7
                    ? "High Risk"
                    : Number(hoverInfo.properties.risk_score ?? 0) > 3
                      ? "Moderate Risk"
                      : "Low Risk"}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-nc-text-dim uppercase font-black block">
                Tickets Mapped
              </span>
              <span className="text-sm font-bold text-nc-text">
                {hoverInfo.properties.fine_count !== undefined
                  ? `${hoverInfo.properties.fine_count} fines`
                  : "0 fines"}
              </span>
            </div>
          </div>

          {hoverInfo.isRoadworkConflict && (
            <div className="bg-nc-danger/20 border border-nc-danger/50 rounded p-2 mb-3 animate-pulse">
              <span className="block text-xs text-nc-danger font-black uppercase mb-1">
                ⚠️ ROADWORK CONFLICT
              </span>
              <p className="text-[10px] text-nc-text-muted leading-tight">
                This spot is currently restricted due to active street works.
              </p>
            </div>
          )}

          {/* Traffic Sign Data */}
          {hoverInfo.stackedSigns ? (
            <div className="space-y-3">
              <p className="text-xs text-nc-neon-teal font-black uppercase tracking-wider border-b border-nc-neon-teal/20 pb-1.5 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Sign Pole Stack ({hoverInfo.stackedSigns.length} Signs)
              </p>

              <div className="relative pl-4 space-y-3 before:content-[''] before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[2px] before:bg-nc-text-dim/30">
                {[...hoverInfo.stackedSigns]
                  .sort((a, b) => {
                    const typeA = String(a.tyyppi || "").toUpperCase();
                    const typeB = String(b.tyyppi || "").toUpperCase();
                    const isMainA = !typeA.startsWith("H");
                    const isMainB = !typeB.startsWith("H");
                    if (isMainA && !isMainB) return -1;
                    if (!isMainA && isMainB) return 1;
                    return typeA.localeCompare(typeB);
                  })
                  .map((sign) => {
                    const visuals = getSignVisuals(String(sign.tyyppi));
                    return (
                      <div
                        key={String(sign.id)}
                        className={`relative space-y-1.5 p-2.5 rounded-lg border border-nc-border/40 hover:border-nc-border transition-all duration-200 shadow-md ${visuals.colorClass}`}
                      >
                        <div className={`absolute left-[-16px] top-4 w-2 h-2 rounded-full border border-nc-void ${
                          visuals.textClass === "text-nc-neon-red" ? "bg-nc-neon-red" :
                          visuals.textClass === "text-nc-neon-teal" ? "bg-nc-neon-teal" : "bg-nc-gold"
                        }`} />

                        <div className="flex justify-between items-center gap-1">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-sm select-none">{visuals.emoji}</span>
                            <span className={`text-[11px] font-black uppercase tracking-wider ${visuals.textClass}`}>
                              {sign.tyyppi}
                            </span>
                          </div>
                          <span
                            className="text-[10px] text-nc-text font-black uppercase text-right leading-none truncate max-w-[160px]"
                            title={`${getSignLabel(String(sign.tyyppi))}${sign.arvo ? ` (${sign.arvo} km/h)` : ""}`}
                          >
                            {getSignLabel(String(sign.tyyppi))}
                            {sign.arvo ? ` (${sign.arvo} km/h)` : ""}
                          </span>
                        </div>

                        {/* Subtexts */}
                        <div className="flex flex-col gap-1">
                          {[1, 2, 3, 4, 5].map((n) => {
                            const txt = sign[`kilpi_txt${n}`];
                            return txt ? (
                              <div
                                key={n}
                                className="text-[9px] bg-nc-text/5 border border-nc-border/30 rounded px-2 py-0.5 text-nc-text-muted font-medium italic leading-tight"
                              >
                                {txt}
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : hoverInfo.properties.licence_identifier ? (
            <div className="space-y-2">
              {hoverInfo.properties.rental_subject ? (
                <>
                  <p className="text-sm text-orange-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    🔶 Temporary Reservation
                  </p>
                  <div className="bg-orange-400/10 border border-orange-400/30 rounded p-2">
                    <p className="text-xs text-orange-300 font-bold mb-1">{hoverInfo.properties.rental_subject}</p>
                    {hoverInfo.properties.licence_description && hoverInfo.properties.licence_description !== "N/A" && (
                      <p className="text-[10px] text-nc-text-muted italic">{renderTextWithLinks(String(hoverInfo.properties.licence_description))}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-nc-gold font-bold uppercase tracking-wider flex items-center gap-1.5">
                  🚧 Street Work
                </p>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-nc-text/5 rounded p-2">
                  <span className="block text-[9px] text-nc-text-dim uppercase font-bold">From</span>
                  <span className="text-[11px] font-bold text-nc-text">{hoverInfo.properties.event_startdate_txt || hoverInfo.properties.lic_startdate_txt || "?"}</span>
                </div>
                <div className="bg-nc-text/5 rounded p-2">
                  <span className="block text-[9px] text-nc-text-dim uppercase font-bold">Until</span>
                  <span className="text-[11px] font-bold text-nc-text">{hoverInfo.properties.event_endtdate_txt || hoverInfo.properties.lic_enddate_txt || "Open"}</span>
                </div>
              </div>
              {hoverInfo.properties.event_description && (
                <div className="bg-nc-gold/10 border border-nc-gold/30 rounded p-2 text-xs text-nc-gold">
                  {renderTextWithLinks(String(hoverInfo.properties.event_description))}
                </div>
              )}
              {hoverInfo.properties.location_description && (
                <p className="text-[10px] text-nc-text-muted italic">{hoverInfo.properties.location_description}</p>
              )}
              <div className="text-[9px] text-nc-text-dim">
                Permit: {hoverInfo.properties.licence_identifier}
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-nc-text-muted mb-3 leading-tight font-bold">
                {getCategoryLabel(String(hoverInfo.properties.category || ""), String(hoverInfo.properties.luokka_nimi || ""))}
              </p>

              {hoverInfo.properties.asukaspysakointitunnus && (
                <div className="bg-nc-purple/10 border border-nc-purple/30 rounded p-2 mb-3">
                  <p className="text-[10px] text-nc-purple font-bold uppercase mb-1">
                    Resident Privilege
                  </p>
                  <p className="text-[10px] text-nc-text-muted leading-tight">
                    Requires permit for Zone {hoverInfo.properties.asukaspysakointitunnus}. Others must follow time rules below.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="bg-nc-text/5 rounded p-2">
                  <span className="block text-xs text-nc-text-dim uppercase">
                    Time Rules
                  </span>
                  <span className="font-bold text-nc-text text-sm">
                    {hoverInfo.properties.voimassaolo || "-"}
                    {hoverInfo.properties.kesto ? ` (${hoverInfo.properties.kesto})` : ""}
                  </span>
                </div>
                <div className="bg-nc-text/5 rounded p-2">
                  <span className="block text-xs text-nc-text-dim uppercase">
                    Capacity
                  </span>
                  <span className="font-bold text-nc-text text-sm">
                    {hoverInfo.properties.paikat_ala || "?"} slots
                  </span>
                </div>
              </div>

              {Number(hoverInfo.properties.risk_score ?? 0) >= 3 && hoverInfo.properties.top_violation_reason && (
                <div className="bg-nc-danger/10 border border-nc-danger/30 rounded p-2 mt-2">
                  <span className="block text-xs text-nc-danger uppercase mb-1 font-bold">
                    ⚠️ Top Violation Cause
                  </span>
                  <span className="text-xs text-nc-text-muted leading-tight block">
                    {String(hoverInfo.properties.top_violation_reason || "").replace(/^\d+\s+/, "")}
                  </span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {distance && (
        <div className="mt-4 pt-4 border-t border-nc-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-nc-neon-teal" />
            <div>
              <div className="text-[10px] text-nc-text-dim uppercase font-black">
                Target Destination
              </div>
              <div className="text-xs text-nc-text font-bold truncate max-w-[120px]">
                {selectedAddress?.name}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-nc-neon-teal font-black">
              {distance}m
            </div>
            <div className="text-[10px] text-nc-text-dim uppercase">
              ~{walkTime(distance)} min walk
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
