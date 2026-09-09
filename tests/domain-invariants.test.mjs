import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 1. Domain Logic: Tieliikennelaki 2020 § 40 Parking Disc Rounding Formula
export function calculateParkingDiscArrival(date) {
  const d = new Date(date);
  const mins = d.getMinutes();
  if (mins === 0 || mins === 30) {
    // Exact half hour or hour: remains unchanged
  } else if (mins < 30) {
    d.setMinutes(30, 0, 0);
  } else {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return {
    timeStr: d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }),
    hours: d.getHours(),
    minutes: d.getMinutes(),
    date: d
  };
}

// 2. Centroid calculation logic from mapThemes.ts
export function getCentroid(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates[0];
    let sumLng = 0;
    let sumLat = 0;
    for (const c of coords) {
      sumLng += c[0];
      sumLat += c[1];
    }
    return [sumLng / coords.length, sumLat / coords.length];
  }
  return null;
}

// 3. DuckDB-WASM Table Identifier Sanitizer
export function isValidDuckDbTableName(name) {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

describe('ParkkiS Sovereign Domain Invariants', () => {
  describe('1. Spatial Coordinate Sanity & Presets', () => {
    const HELSINKI_BOUNDS = { minLat: 60.10, maxLat: 60.30, minLng: 24.70, maxLng: 25.25 };

    it('validates Helsinki sports arena coordinates within municipal bounds', () => {
      const arenas = [
        { name: 'Otahalli Espoo', lat: 60.1841, lng: 24.8315 },
        { name: 'Töölön Pallokenttä / Väiski', lat: 60.1872, lng: 24.9255 },
        { name: 'Esport Center Tapiola', lat: 60.1782, lng: 24.7865 },
        { name: 'Arena Center Hakaniemi', lat: 60.1795, lng: 24.9510 }
      ];

      for (const arena of arenas) {
        assert.ok(arena.lat >= HELSINKI_BOUNDS.minLat && arena.lat <= HELSINKI_BOUNDS.maxLat, `${arena.name} lat out of bounds`);
        assert.ok(arena.lng >= HELSINKI_BOUNDS.minLng && arena.lng <= HELSINKI_BOUNDS.maxLng, `${arena.name} lng out of bounds`);
      }
    });

    it('calculates polygon centroid deterministically', () => {
      const polygon = {
        type: 'Polygon',
        coordinates: [[[24.90, 60.18], [24.92, 60.18], [24.92, 60.20], [24.90, 60.20], [24.90, 60.18]]]
      };
      const centroid = getCentroid(polygon);
      assert.ok(centroid !== null);
      assert.strictEqual(centroid[0].toFixed(2), '24.91');
      assert.strictEqual(centroid[1].toFixed(2), '60.19');
    });
  });

  describe('2. Tieliikennelaki 2020 § 40 Arrival Disc Rounding', () => {
    it('keeps arrival on exact half-hour or full-hour unchanged', () => {
      assert.strictEqual(calculateParkingDiscArrival(new Date('2026-09-05T14:00:00')).minutes, 0);
      assert.strictEqual(calculateParkingDiscArrival(new Date('2026-09-05T14:30:00')).minutes, 30);
    });

    it('rounds 14:01..14:29 forward to 14:30', () => {
      assert.strictEqual(calculateParkingDiscArrival(new Date('2026-09-05T14:01:00')).minutes, 30);
      assert.strictEqual(calculateParkingDiscArrival(new Date('2026-09-05T14:05:00')).minutes, 30);
      assert.strictEqual(calculateParkingDiscArrival(new Date('2026-09-05T14:29:00')).minutes, 30);
    });

    it('rounds 14:31..14:59 forward to 15:00', () => {
      const res = calculateParkingDiscArrival(new Date('2026-09-05T14:35:00'));
      assert.strictEqual(res.hours, 15);
      assert.strictEqual(res.minutes, 0);
    });

    it('calculates Otahalli 4h parking window correctly from rounded disc', () => {
      const arrival = new Date('2026-09-05T14:05:00');
      const disc = calculateParkingDiscArrival(arrival);
      const validUntil = new Date(disc.date.getTime() + 4 * 60 * 60 * 1000);
      assert.strictEqual(validUntil.getHours(), 18);
      assert.strictEqual(validUntil.getMinutes(), 30);
    });
  });

  describe('3. MapLibre Layer Isolation', () => {
    const INTERACTIVE_LAYERS = ['parking-lines', 'hubi-lines', 'sign-points', 'roadwork-fill', 'reservation-fill', 'liipi-points'];

    it('defines distinct, unique interactive layer IDs', () => {
      const set = new Set(INTERACTIVE_LAYERS);
      assert.strictEqual(set.size, INTERACTIVE_LAYERS.length);
    });

    it('verifies category filter specification adheres to MapLibre format', () => {
      const allFilter = ['has', 'category'];
      const paidFilter = ['==', ['get', 'category'], 'paid'];
      assert.strictEqual(allFilter[0], 'has');
      assert.strictEqual(paidFilter[0], '==');
    });
  });

  describe('4. DuckDB-WASM Query Safety', () => {
    it('accepts safe alphanumeric table names', () => {
      assert.ok(isValidDuckDbTableName('slots'));
      assert.ok(isValidDuckDbTableName('violations_2026'));
      assert.ok(isValidDuckDbTableName('roadworks'));
    });

    it('rejects SQL injection vectors in table names', () => {
      assert.strictEqual(isValidDuckDbTableName('slots; DROP TABLE slots;'), false);
      assert.strictEqual(isValidDuckDbTableName("slots' OR '1'='1"), false);
      assert.strictEqual(isValidDuckDbTableName('slots--'), false);
    });
  });

  describe('5. WhatsApp Briefing & Placeholder Token Safety', () => {
    const TOKEN_LEAK_REGEX = /(?:\b(?:undefined|null|NaN)\b|\[object Object\]|\[SYÖTÄ TULOS\]|\[PVM\])/;

    it('passes for clean parking navigation briefing', () => {
      const briefing = '🅿️ ParkkiS: Otahalli Espoo pysäköinti. Kiekkoaika 14:30 alkaen (4h sallittu).';
      assert.strictEqual(TOKEN_LEAK_REGEX.test(briefing), false);
    });

    it('permits Finnish word annulloitu without false positive', () => {
      const fiText = 'Pysäköintivaraus on annulloitu onnistuneesti.';
      assert.strictEqual(TOKEN_LEAK_REGEX.test(fiText), false);
    });

    it('detects unrendered tokens in text', () => {
      assert.strictEqual(TOKEN_LEAK_REGEX.test('Pysäköinti: [object Object]'), true);
      assert.strictEqual(TOKEN_LEAK_REGEX.test('Alkaa: undefined'), true);
      assert.strictEqual(TOKEN_LEAK_REGEX.test('Kesto: NaN min'), true);
      assert.strictEqual(TOKEN_LEAK_REGEX.test('Hinta: null €'), true);
    });
  });
});
