import { useEffect, useState } from 'react';
import Map, { Source, Layer, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getDuckDB, loadParquet } from './lib/duckdb';
import { Shield, Info, Map as MapIcon, Sliders } from 'lucide-react';

const INITIAL_VIEW_STATE = {
  longitude: 24.941,
  latitude: 60.169,
  zoom: 13,
  pitch: 45
};

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [riskData, setRiskData] = useState<any>(null);
  const [loadingMsg, setLoadingMsg] = useState('Initializing Analytical Engine...');

  useEffect(() => {
    const initData = async () => {
      console.log('🏗️ ParkkiS Build Info:', {
        version: '2.0.1',
        buildTime: new Date().toISOString(),
        environment: import.meta.env.MODE,
        base: import.meta.env.BASE_URL
      });

      try {
        setLoadingMsg('Loading High-Performance Spatial Assets...');
        
        // Resolve absolute URLs for DuckDB worker
        const slotsUrl = new URL('data/slots.parquet', window.location.href).href;
        const violationsUrl = new URL('data/violations.parquet', window.location.href).href;

        await Promise.all([
          loadParquet('slots', slotsUrl),
          loadParquet('violations', violationsUrl)
        ]);

        setLoadingMsg('Calculating Live Risk Matrix...');
        const db = await getDuckDB();
        const conn = await db.connect();
        
        // 2026 Analytical Join: Calculate risk on-the-fly in the browser!
        // We use a simple bounding box join for speed
        const result = await conn.query(`
          SELECT 
            s.geometry, 
            s.properties,
            (SELECT count(*) FROM violations v WHERE ST_Intersects(s.geometry, v.geometry)) as fine_count
          FROM slots s
        `);
        
        // Convert DuckDB result to GeoJSON for MapLibre
        const features = result.toArray().map((row: any) => ({
          type: 'Feature',
          geometry: JSON.parse(row.geometry),
          properties: {
            ...JSON.parse(row.properties),
            fine_count: Number(row.fine_count),
            risk_score: Math.min(10, Math.ceil(1 + Number(row.fine_count) * 0.5))
          }
        }));

        setRiskData({ type: 'FeatureCollection', features });
        setDbReady(true);
        await conn.close();
      } catch (e) {
        console.error('Data Engine Failure:', e);
        setLoadingMsg('Failed to initialize. Check console.');
      }
    }
    initData();
  }, []);

  return (
    <div className="relative w-full h-screen bg-nc-deep">
      {/* Nova HUD: Intelligence Layer */}
      <div className="nv-hud top-0 left-0 w-full flex justify-between items-start">
        <div className="nv-glass rounded-3xl p-4 flex items-center gap-4 pointer-events-auto">
          <div className="bg-nc-neon-teal/20 p-2 rounded-2xl">
            <Shield className="text-nc-neon-teal w-6 h-6" />
          </div>
          <div>
            <h1 className="text-nv-text-lg font-bold tracking-tighter">PARKKIS</h1>
            <p className="text-nv-text-xs text-white/50 uppercase tracking-widest">Helsinki Risk Engine</p>
          </div>
        </div>

        {!dbReady && (
          <div className="nv-glass rounded-3xl px-6 py-3 flex items-center gap-3 animate-pulse">
            <div className="w-2 h-2 rounded-full bg-nc-neon-teal shadow-[0_0_10px_#00f2ff]" />
            <span className="text-nv-text-sm font-medium">{loadingMsg}</span>
          </div>
        )}
      </div>

      {/* Main Map Visualization */}
      <Map
        initialViewState={INITIAL_VIEW_STATE}
        style={{ width: '100%', height: '100%' }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <NavigationControl position="bottom-right" />
        
        {riskData && (
          <Source id="risk-data" type="geojson" data={riskData}>
            {/* Outline Layer (Reference Reference) */}
            <Layer
              id="parking-lines"
              type="line"
              paint={{
                'line-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'risk_score'],
                  1, '#00f2ff',  // Low Risk: Teal
                  5, '#ffcf4b',  // Med Risk: Gold
                  10, '#ff3e3e'  // High Risk: Neon Red
                ],
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 18, 8],
                'line-opacity': 0.8
              }}
            />
            {/* Subtle Glow Layer */}
            <Layer
              id="parking-glow"
              type="line"
              paint={{
                'line-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'risk_score'],
                  1, '#00f2ff',
                  5, '#ffcf4b',
                  10, '#ff3e3e'
                ],
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 18, 15],
                'line-blur': 5,
                'line-opacity': 0.3
              }}
            />
          </Source>
        )}
      </Map>

      {/* Bento Stats Footer */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-6 grid grid-cols-3 gap-4 pointer-events-none">
        <div className="nv-bento-card pointer-events-auto">
          <div className="flex items-center gap-3 mb-2">
            <MapIcon className="w-4 h-4 text-nc-neon-teal" />
            <span className="text-nv-text-xs font-bold text-white/40 uppercase">Coverage</span>
          </div>
          <p className="text-nv-text-xl font-bold">{riskData?.features.length || 0}</p>
          <p className="text-nv-text-xs text-white/30">Active Parking Slots</p>
        </div>

        <div className="nv-bento-card pointer-events-auto">
          <div className="flex items-center gap-3 mb-2">
            <Info className="w-4 h-4 text-nc-gold" />
            <span className="text-nv-text-xs font-bold text-white/40 uppercase">Intelligence</span>
          </div>
          <p className="text-nv-text-xl font-bold">165.7k</p>
          <p className="text-nv-text-xs text-white/30">Violation Records Join</p>
        </div>

        <div className="nv-bento-card pointer-events-auto border-nc-neon-teal/20">
          <div className="flex items-center gap-3 mb-2">
            <Sliders className="w-4 h-4 text-nc-neon-teal" />
            <span className="text-nv-text-xs font-bold text-white/40 uppercase">Engine</span>
          </div>
          <p className="text-nv-text-xl font-bold">DuckDB</p>
          <p className="text-nv-text-xs text-white/30">Wasm Vector Engine</p>
        </div>
      </div>
    </div>
  );
}
