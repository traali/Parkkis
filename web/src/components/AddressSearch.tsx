import { useEffect, useState } from "react";
import { Navigation, Search, X } from "lucide-react";

export interface SearchResult {
  id?: number;
  name: { fi: string; sv: string };
  municipality?: { name?: { fi?: string; sv?: string } };
  location: {
    coordinates: [number, number];
  };
}

/** Home-view address search (Helsinki Servicemap), debounced. */
export function AddressSearch({ onSelect }: { onSelect: (result: SearchResult) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Debounced Search Logic
  useEffect(() => {
    if (searchQuery.length < 3) return;

    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://api.hel.fi/servicemap/v2/search/?type=address&page_size=5&q=${encodeURIComponent(searchQuery)}&language=fi`,
        );
        if (!response.ok) throw new Error(`Servicemap HTTP ${response.status}`);
        const data = await response.json();
        setSearchResults(Array.isArray(data.results) ? data.results : []);
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const pick = (result: SearchResult) => {
    setSearchQuery("");
    setSearchResults([]);
    onSelect(result);
  };

  const visibleSearchResults = searchQuery.length >= 3 ? searchResults : [];

  return (
    <div data-testid="top-hud" className="absolute top-3 left-3 right-[68px] sm:right-auto sm:w-[420px] z-40 flex flex-col gap-2 pointer-events-none">
      <div className="nv-sheet rounded-full pl-4 pr-1 flex items-center pointer-events-auto">
        <Search className="w-5 h-5 text-nc-text-muted shrink-0" />
        <input
          type="search"
          aria-label="Hae osoite"
          placeholder="Hae osoite"
          className="bg-transparent border-none text-nc-text text-base w-full min-h-[44px] px-2 focus:outline-none placeholder:text-nc-text-muted"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            aria-label="Tyhjennä haku"
            onClick={() => setSearchQuery("")}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-nc-text/10 rounded-full"
          >
            <X className="w-4 h-4 text-nc-text-muted" />
          </button>
        )}
      </div>
      {visibleSearchResults.length > 0 && (
        <div className="nv-sheet rounded-2xl overflow-hidden pointer-events-auto">
          {visibleSearchResults.map((result: SearchResult) => (
            <button
              type="button"
              key={`${result.name.fi}-${result.location.coordinates.join(",")}`}
              onClick={() => pick(result)}
              className="w-full min-h-[44px] text-left px-4 py-2 hover:bg-nc-text/10 border-b border-nc-border last:border-0 flex items-center gap-3"
            >
              <Navigation className="w-4 h-4 text-nc-text-muted" />
              <span>
                <span className="block text-sm font-bold text-nc-text">{result.name.fi || result.name.sv}</span>
                <span className="block text-xs text-nc-text-muted">
                  {result.municipality?.name?.fi || result.municipality?.name?.sv || ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
