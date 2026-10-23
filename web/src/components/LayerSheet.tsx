import type { ReactNode } from "react";
import { List, X } from "lucide-react";
import { CITY_LAYERS, fiDate, type CityLayerId } from "../lib/cityLayers";
import { AGE_COLORS, AGE_LABELS, HEL_PRIORITY_LABEL, STATE_ROADS_NOTE } from "../lib/plough";
import { CATEGORIES } from "../lib/mapThemes";
import { FINE_CLASSES } from "../lib/fines";
import type { LayerState, LoadStatus } from "../hooks/useCityLayers";
import { EMPTY_HINT } from "./CityPanel";

/** Colours of the secondary layers (shared with the map so the sheet is the legend). */
export const LAYER_COLORS = {
  violations: "#f87171",
  signs: "#e2e8f0",
  newSigns: "#22d3ee",
  roadworks: "#facc15",
  reservations: "#f97316",
  liipi: "#2dd4bf",
  plough: "#38bdf8",
} as const;

/** "#f87171" + 0.3 → "rgba(248,113,113,0.3)" for legend swatches that match the map's fill opacity. */
function hexAlpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const CITY_COLOR = (id: CityLayerId) => CITY_LAYERS.find((l) => l.id === id)?.color ?? "#94a3b8";
const CITY_LABEL = (id: CityLayerId) => CITY_LAYERS.find((l) => l.id === id)?.label ?? id;

export function statusText(s: LoadStatus | "ok" | undefined, count?: number): string {
  if (s === "loading") return "ladataan…";
  if (s === "error") return "ei saatu";
  if (s === "empty") return "ei kohteita";
  if ((s === "ready" || s === "ok") && typeof count === "number") return String(count);
  return "";
}

export function ToggleRow({ id, label, color, on, onToggle, status, dashed }: {
  id: string; label: string; color: string; on: boolean; onToggle: () => void; status?: string; dashed?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={`layer-toggle-${id}`}
      aria-pressed={on}
      onClick={onToggle}
      className="w-full min-h-[44px] px-3 rounded-xl flex items-center gap-3 text-left text-sm text-nc-text hover:bg-nc-text/5"
    >
      <span
        aria-hidden="true"
        className="inline-block w-4 h-4 rounded-full shrink-0"
        style={dashed ? { border: `2px dashed ${color}` } : { background: color }}
      />
      <span className="flex-1">{label}</span>
      {status && <span className={`text-xs ${status === "ei saatu" ? "text-nc-danger font-bold" : "text-nc-text-muted"}`}>{status}</span>}
      <span aria-hidden="true" className={`w-10 h-6 rounded-full shrink-0 p-0.5 transition-colors ${on ? "bg-nc-neon-teal" : "bg-nc-text/20"}`}>
        <span className={`block w-5 h-5 rounded-full bg-nc-void shadow transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function Group({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-3 pt-2 text-xs font-bold uppercase tracking-wide text-nc-text-muted">{title}</h3>
      {children}
      {note && <div className="px-3 text-xs text-nc-text-muted leading-snug">{note}</div>}
    </section>
  );
}

export interface LayerSheetProps {
  onClose: () => void;
  activeFilter: string;
  onFilter: (id: string) => void;
  venueLink: boolean;
  date: string;
  dateFromLink: boolean;
  // Sakot ja merkit
  showViolations: boolean; setShowViolations: (v: boolean) => void;
  showSigns: boolean; setShowSigns: (v: boolean) => void;
  showNewTraps: boolean; setShowNewTraps: (v: boolean) => void;
  dataReady: boolean;
  fineYears?: string;
  /** Months the fine data covers, from the data ("tammikuu–joulukuu 2023"). */
  finePeriod?: string;
  /** The venue is outside Helsinki, where the open fine data ends. */
  finesOutside?: boolean;
  // Tänään kadulla
  showRoadworks: boolean; setShowRoadworks: (v: boolean) => void; roadworkStatus: "loading" | "ok" | "error"; roadworkCount?: number;
  showReservations: boolean; setShowReservations: (v: boolean) => void; reservationStatus: "loading" | "ok" | "error"; reservationCount?: number;
  onOpenList: () => void;
  // City layers
  cityLayers: Record<CityLayerId, LayerState>;
  cityShown: Set<CityLayerId>;
  onToggleCity: (id: CityLayerId) => void;
  // Park and ride
  showLiipi: boolean; setShowLiipi: (v: boolean) => void; liipiCount?: number;
  // Winter
  showPlough: boolean; onTogglePlough: () => void;
  ploughStatus: string; ploughFailed: ("state" | "espoo")[]; ploughText: string | null;
  helStatus: string; helCount?: number;
  showOsmNote: boolean;
}

export function LayerSheet(p: LayerSheetProps) {
  const city = (id: CityLayerId) => (
    <ToggleRow
      key={id}
      id={id}
      label={CITY_LABEL(id)}
      color={CITY_COLOR(id)}
      on={p.cityShown.has(id)}
      onToggle={() => p.onToggleCity(id)}
      status={p.cityShown.has(id) ? statusText(p.cityLayers[id].status, p.cityLayers[id].data?.features.length) : undefined}
      dashed={id === "zones"}
    />
  );
  const day = `${p.dateFromLink ? "ottelupäivälle" : "tälle päivälle"} ${fiDate(p.date)}`;
  return (
    <div
      data-testid="layer-sheet"
      role="dialog"
      aria-label="Tasot"
      className="nv-sheet pointer-events-auto flex flex-col max-h-[60vh] sm:max-h-[80vh]"
    >
      <div className="flex items-center justify-between pl-4 pr-1 py-1 border-b border-nc-border">
        <h2 className="text-base font-bold text-nc-text">Tasot</h2>
        <button type="button" onClick={p.onClose} aria-label="Sulje tasot" className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center hover:bg-nc-text/10">
          <X className="w-5 h-5 text-nc-text" />
        </button>
      </div>
      <div className="overflow-y-auto overscroll-contain px-1 pb-3 flex flex-col gap-2">
        <Group title="Pysäköinti">
          <div className="flex flex-wrap gap-1.5 px-3 py-1">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.id}
                aria-pressed={p.activeFilter === c.id}
                onClick={() => p.onFilter(c.id)}
                className={`min-h-[44px] px-3 rounded-full text-sm font-semibold border ${p.activeFilter === c.id ? "bg-nc-neon-teal text-nc-deep border-nc-neon-teal" : "border-nc-border text-nc-text"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <ToggleRow id="liipi" label="Liityntäpysäköinti" color={LAYER_COLORS.liipi} on={p.showLiipi} onToggle={() => p.setShowLiipi(!p.showLiipi)} status={p.showLiipi && p.dataReady ? statusText("ok", p.liipiCount) : p.showLiipi ? "ladataan…" : undefined} />
          {city("coach")}
          {city("zones")}
        </Group>

        <Group
          title="Sakot ja merkit"
          note={
            <>
              {p.showViolations && (
                <span data-testid="fine-legend" className="block py-1">
                  <span className="block">Pysäköintivirhemaksuja noin 100 × 100 m ruudussa{p.finePeriod ? `, ${p.finePeriod}` : p.fineYears ? `, ${p.fineYears}` : ""}:</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                    {FINE_CLASSES.map((c) => (
                      <span key={c.label} className="flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          className="inline-block w-4 h-4 rounded-sm"
                          style={{ background: hexAlpha(LAYER_COLORS.violations, c.opacity), border: `1px solid ${hexAlpha(LAYER_COLORS.violations, 0.55)}` }}
                        />
                        {c.label}
                      </span>
                    ))}
                  </span>
                  <span className="block pt-1">Sijainnit ovat osoitteen tarkkuudella, joten kartalla on ruudut, ei tarkkoja paikkoja. Napauta ruutua: määrä ja yleisin syy.</span>
                  {p.finesOutside && (
                    <span data-testid="fine-outside-note" className="block pt-1 font-semibold text-nc-text">Aineistossa ei ole sakkoja 600 m säteellä tästä kohteesta. Sijainnillinen avoin sakkoaineisto on vain Helsingistä.</span>
                  )}
                </span>
              )}
              Sakot: Helsingin kaupungin avoin pysäköintivirheaineisto. Uudet merkit: muokattu viimeisen 60 päivän aikana.
            </>
          }
        >
          <ToggleRow id="violations" label="Sakot alueittain" color={LAYER_COLORS.violations} on={p.showViolations} onToggle={() => p.setShowViolations(!p.showViolations)} status={p.showViolations && !p.dataReady ? "ladataan…" : undefined} />
          <ToggleRow id="signs" label="Liikennemerkit" color={LAYER_COLORS.signs} on={p.showSigns} onToggle={() => p.setShowSigns(!p.showSigns)} status={p.showSigns && !p.dataReady ? "ladataan…" : undefined} />
          <ToggleRow id="new-signs" label="Uudet merkit" color={LAYER_COLORS.newSigns} on={p.showNewTraps} onToggle={() => p.setShowNewTraps(!p.showNewTraps)} status={p.showNewTraps && !p.dataReady ? "ladataan…" : undefined} />
        </Group>

        <Group
          title="Tänään kadulla"
          note={
            <>
              {(["events", "leases"] as const).filter((id) => p.cityShown.has(id) && p.cityLayers[id].status === "empty").map((id) => (
                <span key={id} className="block">{EMPTY_HINT[id]}</span>
              ))}
              Työmaat ja vuokraukset {day}. Lähde: Helsingin kaupunki.
            </>
          }
        >
          <ToggleRow id="roadworks" label="Työmaat" color={LAYER_COLORS.roadworks} on={p.showRoadworks} onToggle={() => p.setShowRoadworks(!p.showRoadworks)} status={statusText(p.roadworkStatus, p.roadworkCount)} />
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <ToggleRow id="reservations" label="Katualueen vuokraukset" color={LAYER_COLORS.reservations} on={p.showReservations} onToggle={() => p.setShowReservations(!p.showReservations)} status={statusText(p.reservationStatus, p.reservationCount)} />
            </div>
            <button type="button" onClick={p.onOpenList} aria-label="Vuokraukset listana" className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center border border-nc-border hover:bg-nc-text/10">
              <List className="w-5 h-5 text-nc-text" />
            </button>
          </div>
          {city("leases")}
          {city("events")}
        </Group>

        <Group
          title="Talvi"
          note={
            <span data-testid="plough-status" role="status">
              {p.ploughFailed.length === 1 && p.ploughStatus !== "loading" && (
                <span className="block text-nc-danger">
                  {p.ploughFailed[0] === "espoo" ? "Espoon katutietojen lataus epäonnistui." : "Valtion teiden tietojen lataus epäonnistui."}
                </span>
              )}
              {p.ploughText && <span className="block">{p.ploughText}</span>}
              {p.showPlough && p.ploughStatus === "ready" && (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                  {(Object.keys(AGE_LABELS) as (keyof typeof AGE_LABELS)[]).map((k) => (
                    <span key={k} className="flex items-center gap-1">
                      <span className="inline-block w-4 h-1.5 rounded" style={{ background: AGE_COLORS[k] }} />
                      {AGE_LABELS[k]}
                    </span>
                  ))}
                </span>
              )}
              {p.showPlough && (
                <span data-testid="hel-priority-status" className="flex items-center gap-1">
                  <span className="inline-block w-4 border-t-2 border-dashed border-emerald-300" />
                  Helsinki: {HEL_PRIORITY_LABEL}
                  {p.helStatus === "loading" ? " – ladataan…" : p.helStatus === "error" ? " – lataus epäonnistui" : p.helStatus === "ready" ? ` – ${p.helCount ?? 0} reittiä` : ""}
                </span>
              )}
              <span className="block">{STATE_ROADS_NOTE}</span>
            </span>
          }
        >
          <ToggleRow id="plough" label="Auraus ja hiekoitus" color={LAYER_COLORS.plough} on={p.showPlough} onToggle={p.onTogglePlough} status={p.ploughStatus === "loading" ? "ladataan…" : p.ploughStatus === "error" ? "ei saatu" : undefined} />
        </Group>

        <Group title="Liikkuminen">
          {city("cycling")}
          {city("access")}
        </Group>

        {p.showOsmNote && (
          <p className="px-3 text-xs text-nc-text-muted leading-snug">
            OpenStreetMapin pysäköintipisteet (harmaa) näkyvät vain, kun kohteen lähellä ei ole kaupungin pysäköintitietoja, ja vain lähelle zoomattuna.
          </p>
        )}
      </div>
    </div>
  );
}
