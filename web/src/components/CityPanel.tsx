import { CITY_LAYERS, FMI_CREDIT, HEL_CREDIT, BUSY_RADIUS_M, fiDate, forecastText, type CityLayerId, type Contractor, type ForecastHour } from "../lib/cityLayers";
import type { LayerState, LoadStatus } from "../hooks/useCityLayers";

const STATUS_FI: Record<LoadStatus, string> = { idle: "", loading: "ladataan…", ready: "", empty: "ei kohteita", error: "lataus epäonnistui" };

export const EMPTY_HINT: Partial<Record<CityLayerId, string>> = {
  events: "Ei kaupungin tapahtuma-alueita tälle päivälle.",
  leases: "Ei voimassa olevia lyhyitä maanvuokrauksia tälle päivälle.",
};

export function CityLayerToggles({ layers, shown, onToggle, date, dateFromLink }: {
  layers: Record<CityLayerId, LayerState>; shown: Set<CityLayerId>; onToggle: (id: CityLayerId) => void; date: string; dateFromLink: boolean;
}) {
  return (
    <div data-testid="city-layers" className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {CITY_LAYERS.map((l) => {
          const st = layers[l.id];
          const on = shown.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              data-testid={`city-toggle-${l.id}`}
              aria-pressed={on}
              onClick={() => onToggle(l.id)}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-2xl text-[11px] font-bold border flex items-center gap-1.5 ${on ? "bg-white/10" : "text-nc-text-dim border-nc-border"}`}
              style={on ? { borderColor: l.color, color: l.color } : undefined}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
              {l.label}
              {on && st.status !== "ready" && STATUS_FI[st.status] && (
                <span data-testid={`city-status-${l.id}`} className={st.status === "error" ? "text-nc-danger" : "font-normal"}>({STATUS_FI[st.status]})</span>
              )}
              {on && st.status === "ready" && <span data-testid={`city-status-${l.id}`} className="font-normal">({st.data?.features.length})</span>}
            </button>
          );
        })}
      </div>
      {(["events", "leases"] as const).filter((id) => shown.has(id) && layers[id].status === "empty").map((id) => (
        <span key={id} className="text-[10px]">{EMPTY_HINT[id]} ({fiDate(date)})</span>
      ))}
      <span className="text-[10px] text-nc-text-dim">
        Tapahtumat ja vuokraukset {dateFromLink ? "ottelupäivälle" : "tälle päivälle"} {fiDate(date)}. Lähde: {HEL_CREDIT}.
      </span>
    </div>
  );
}

export interface BusyEvent { title: string; address: string; phase: string; period: string; distanceM: number }

export function VenueInfo({ name, date, dateFromLink, inHelsinki, events, eventsStatus, zones, zonesStatus, contractors, contractorStatus, forecast, forecastStatus, forecastFor }: {
  name: string; date: string; dateFromLink: boolean; inHelsinki: boolean;
  events: BusyEvent[]; eventsStatus: LoadStatus;
  zones: Record<string, string>[]; zonesStatus: LoadStatus;
  contractors: Contractor[]; contractorStatus: LoadStatus;
  forecast: ForecastHour | null; forecastStatus: LoadStatus; forecastFor: "match" | "now";
}) {
  const day = dateFromLink ? `ottelupäivänä ${fiDate(date)}` : `tänään ${fiDate(date)}`;
  const link = (u: string) => (u ? (u.startsWith("http") ? u : `https://${u}`) : "");
  return (
    <div data-testid="venue-info" className="flex flex-col gap-1 text-[11px]">
      {inHelsinki && (
        <div data-testid="busy-day" role="status">
          {eventsStatus === "loading" && "Tarkistetaan tapahtumia…"}
          {eventsStatus === "error" && <span className="text-nc-danger">Tapahtumatietojen lataus epäonnistui.</span>}
          {(eventsStatus === "ready" || eventsStatus === "empty") && (events.length ? (
            <b className="text-pink-300">
              ⚠️ Vilkas päivä: {events.length} tapahtuma{events.length > 1 ? "a" : ""} {Math.round(BUSY_RADIUS_M / 100) / 10} km säteellä {day} –{" "}
              {events.slice(0, 2).map((e) => `${e.title} (${e.phase.toLowerCase()}, ${e.period}, noin ${(e.distanceM / 1000).toFixed(1).replace(".", ",")} km)`).join("; ")}.
            </b>
          ) : (
            `Ei kaupungin tapahtuma-alueita ${Math.round(BUSY_RADIUS_M / 100) / 10} km säteellä ${day}.`
          ))}
        </div>
      )}
      {inHelsinki && (
        <div data-testid="venue-zones">
          {zonesStatus === "loading" && "Ladataan pysäköintivyöhykkeitä…"}
          {zonesStatus === "error" && <span className="text-nc-danger">Vyöhyketietojen lataus epäonnistui.</span>}
          {(zonesStatus === "ready" || zonesStatus === "empty") && (zones.length ? zones.map((z) => (
            <span key={z.title} className="block">
              <b>{z.title}</b>{z.info ? `: ${z.info.trim()}` : ""}{" "}
              {z.link && <a className="underline inline-flex min-h-[44px] items-center" href={link(z.link)} target="_blank" rel="noopener noreferrer">Lisätietoja</a>}
            </span>
          )) : "Kohde ei ole maksu- tai asukaspysäköintivyöhykkeellä (kaupungin vyöhykerajat ovat suuntaa-antavia).")}
        </div>
      )}
      {inHelsinki && (
        <div data-testid="venue-contractor">
          {contractorStatus === "loading" && "Haetaan ylläpitourakoitsijaa…"}
          {contractorStatus === "error" && <span className="text-nc-danger">Ylläpitourakoitsijan haku epäonnistui.</span>}
          {contractorStatus === "empty" && "Ylläpitourakoitsijaa ei löytynyt tälle kohteelle."}
          {contractorStatus === "ready" && (
            <span>Kadun ja viheralueiden ylläpito: {contractors.map((c) => `${c.contractor} (${c.area}, ${c.period})`).join("; ")}.</span>
          )}
        </div>
      )}
      {!inHelsinki && <span className="text-nc-text-dim">Tapahtumat, vyöhykkeet ja urakoitsija ovat saatavilla vain Helsingin kohteille.</span>}
      <div data-testid="venue-forecast">
        {forecastStatus === "loading" && "Ladataan sääennustetta…"}
        {forecastStatus === "error" && <span className="text-nc-danger">Sääennusteen lataus epäonnistui.</span>}
        {forecastStatus === "empty" && "Sääennustetta ei saatu tälle kohteelle."}
        {forecastStatus === "ready" && (forecast ? (
          <span>🌤 Sää {forecastFor === "match" ? "otteluaikaan" : "nyt"} ({name}): {forecastText(forecast)}.</span>
        ) : (
          "Ottelupäivä on sääennusteen ulkopuolella (ennuste noin 10 vrk eteenpäin)."
        ))}
        <span className="block text-[10px] text-nc-text-dim">Sääennuste: {FMI_CREDIT}. Muut: {HEL_CREDIT}.</span>
      </div>
    </div>
  );
}
