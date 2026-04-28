import { useEffect, useState, useCallback } from 'react';
import Map, { Source, Layer, NavigationControl, GeolocateControl, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getDuckDB, loadParquet } from './lib/duckdb';
import { Shield, Info, Map as MapIcon, Sliders, Filter } from 'lucide-react';

const INITIAL_VIEW_STATE = {
  longitude: 24.941,
  latitude: 60.169,
  zoom: 13,
  pitch: 45
};

const CATEGORIES = [
  { id: 'all', label: 'All Slots', color: 'bg-nc-neon-teal' },
  { id: 'residential', label: 'Residential', color: 'bg-nc-gold' },
  { id: 'paid', label: 'Paid', color: 'bg-blue-500' },
  { id: 'free', label: 'Free', color: 'bg-green-500' },
  { id: 'special', label: 'Special (EV/Inva)', color: 'bg-purple-500' }
];

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [riskData, setRiskData] = useState<any>(null);
  const [loadingMsg, setLoadingMsg] = useState('Initializing Analytical Engine...');
  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    const initData = async () => {
      console.log('🏗️ ParkkiS Build Info:', {
        version: '2.1.0',
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
        const result = await conn.query(`
          SELECT 
            ST_AsGeoJSON(s.geom) as geometry, 
            to_json({
              'id': s.id, 
              'luokka_nimi': s.luokka_nimi, 
              'tyyppi': s.tyyppi, 
              'paikat_ala': s.paikat_ala,
              'category': CASE 
                WHEN s.luokka_nimi ILIKE '%asukas%' THEN 'residential'
                WHEN s.luokka_nimi ILIKE '%maksullinen%' THEN 'paid'
                WHEN s.luokka_nimi ILIKE '%ilmainen%' THEN 'free'
                WHEN s.tyyppi IS NOT NULL AND s.tyyppi != '' AND s.tyyppi != '0' AND s.tyyppi != '9' THEN 'special'
                ELSE 'other'
              END
            }) as properties,
            (SELECT count(*) FROM violations v WHERE ST_Intersects(ST_Buffer(s.geom, 0.0002), v.geom)) as fine_count
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

  const onMouseMove = useCallback((event: any) => {
    const { features } = event;
    const hoveredFeature = features && features[0];
    
    if (hoveredFeature) {
      setHoverInfo({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        properties: hoveredFeature.properties
      });
    } else {
      setHoverInfo(null);
    }
  }, []);

  const mapFilter = activeFilter === 'all' ? ['has', 'category'] : ['==', ['get', 'category'], activeFilter];

  return (
    <div className="relative w-full h-screen bg-nc-deep">
      {/* Nova HUD: Intelligence Layer */}
      <div className="nv-hud top-0 left-0 w-full flex flex-col gap-4">
        <div className="flex justify-between items-start w-full">
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

        {/* Intelligence Filter: Dynamic Categories */}
        {dbReady && (
          <div className="nv-glass rounded-3xl p-2 flex items-center gap-2 pointer-events-auto overflow-x-auto no-scrollbar max-w-fit self-start">
            <div className="px-3 py-2 border-r border-white/10 mr-1">
              <Filter className="w-4 h-4 text-white/40" />
            </div>
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveFilter(cat.id)}
                className={`px-4 py-2 rounded-2xl text-nv-text-xs font-bold transition-all whitespace-nowrap ${
                  activeFilter === cat.id 
                    ? 'bg-nc-neon-teal text-nc-deep shadow-[0_0_15px_rgba(0,242,255,0.4)]' 
                    : 'text-white/40 hover:bg-white/5'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Map Visualization */}
      <Map
        initialViewState={INITIAL_VIEW_STATE}
        style={{ width: '100%', height: '100%' }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        interactiveLayerIds={['parking-lines']}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverInfo(null)}
      >
        <NavigationControl position="bottom-right" />
        <GeolocateControl position="bottom-right" trackUserLocation={true} showAccuracyCircle={false} />
        
        {riskData && (
          <Source id="risk-data" type="geojson" data={riskData}>
            <Layer
              id="parking-lines"
              type="line"
              filter={mapFilter as any}
              paint={{
                'line-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'risk_score'],
                  1, '#00f2ff',
                  5, '#ffcf4b',
                  10, '#ff3e3e'
                ],
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 18, 8],
                'line-opacity': 0.8
              }}
            />
            <Layer
              id="parking-glow"
              type="line"
              filter={mapFilter as any}
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

        {hoverInfo && (
          <Popup
            longitude={hoverInfo.longitude}
            latitude={hoverInfo.latitude}
            closeButton={false}
            className="nv-popup"
            maxWidth="300px"
          >
            <div className="p-3">
              <h3 className="font-bold text-white mb-1 border-b border-white/10 pb-2">
                {hoverInfo.properties.tyyppi || 'Parking Area'}
              </h3>
              <p className="text-sm text-white/70 mb-3 leading-tight">{hoverInfo.properties.luokka_nimi || 'No restriction data'}</p>
              
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="bg-white/5 rounded p-2">
                  <span className="block text-xs text-white/50 uppercase">Capacity</span>
                  <span className="font-bold text-white">{hoverInfo.properties.paikat_ala || '?'} slots</span>
                </div>
                <div className="bg-white/5 rounded p-2">
                  <span className="block text-xs text-white/50 uppercase">Risk Level</span>
                  <span className="font-bold" style={{ color: hoverInfo.properties.risk_score >= 5 ? '#ff3e3e' : '#00f2ff' }}>
                    {hoverInfo.properties.risk_score} / 10
                  </span>
                </div>
              </div>
              <div className="bg-white/5 rounded p-2 mt-2 text-center border border-white/5">
                  <span className="block text-xs text-white/50 uppercase mb-1">Total Violations Recorded</span>
                  <span className="font-bold text-lg" style={{ color: hoverInfo.properties.risk_score >= 5 ? '#ff3e3e' : '#00f2ff' }}>{hoverInfo.properties.fine_count}</span>
              </div>
            </div>
          </Popup>
        )}
      </Map>

      {/* Bento Stats Footer */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-6 grid grid-cols-3 gap-4 pointer-events-none">
        <div className="nv-bento-card pointer-events-auto">
          <div className="flex items-center gap-3 mb-2">
            <MapIcon className="w-4 h-4 text-nc-neon-teal" />
            <span className="text-nv-text-xs font-bold text-white/40 uppercase">Coverage</span>
          </div>
          <p className="text-nv-text-xl font-bold">
            {riskData?.features.filter((f: any) => activeFilter === 'all' || f.properties.category === activeFilter).length || 0}
          </p>
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
