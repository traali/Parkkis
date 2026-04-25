import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const DATA_URL = `${import.meta.env.BASE_URL}data/risk.geojson`;

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const RISK_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'risk_score'],
  1, '#22c55e',
  5, '#eab308',
  10, '#ef4444',
];

export function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/meta.json`)
      .then((r) => r.json())
      .then((d) => setUpdatedAt(d.updated_at))
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLE_URL,
      center: [25.0, 60.17],
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.addSource('risk', { type: 'geojson', data: DATA_URL });

      map.addLayer({
        id: 'risk-fill',
        type: 'fill',
        source: 'risk',
        paint: {
          'fill-color': RISK_COLOR,
          'fill-opacity': 0.55,
        },
      });

      map.addLayer({
        id: 'risk-outline',
        type: 'line',
        source: 'risk',
        paint: {
          'line-color': '#ffffff',
          'line-width': 0.5,
          'line-opacity': 0.25,
        },
      });

      map.on('click', 'risk-fill', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties as Record<string, unknown>;
        const name = p['name'] ? `<div><strong>${escapeHtml(p['name'])}</strong></div>` : '';
        new maplibregl.Popup({ maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:sans-serif;font-size:13px;line-height:1.6">
              ${name}
              <div>Risk score: <strong>${escapeHtml(p['risk_score'])}/10</strong></div>
              <div>Violations nearby: ${escapeHtml(p['violation_count'])}</div>
              <div>Source: ${escapeHtml(p['source'] ?? p['provider'] ?? 'Unknown')}</div>
            </div>`,
          )
          .addTo(map);
      });

      map.on('mouseenter', 'risk-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'risk-fill', () => {
        map.getCanvas().style.cursor = '';
      });
    });

    return () => map.remove();
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          background: 'rgba(10,12,20,0.82)',
          color: '#f0f0f0',
          padding: '14px 18px',
          borderRadius: 10,
          backdropFilter: 'blur(6px)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
          minWidth: 180,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, letterSpacing: '-0.3px' }}>🅿️ Parkkisakko</h1>
        <p style={{ margin: '3px 0 12px', fontSize: 12, opacity: 0.6 }}>
          Helsinki Parking Risk Map
        </p>

        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          Risk Score
        </div>
        {[
          { color: '#22c55e', label: 'Low (1–3)' },
          { color: '#eab308', label: 'Medium (4–7)' },
          { color: '#ef4444', label: 'High (8–10)' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
            {label}
          </div>
        ))}

        {updatedAt && (
          <p style={{ margin: '12px 0 0', fontSize: 10, opacity: 0.4 }}>
            Updated {new Date(updatedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}
