export interface NavLink { label: string; href: string }

/** Navigation deep links to a destination. Coordinates are rounded to ~1 m. */
export function navLinks(lat: number, lon: number): NavLink[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return [
    { label: "Google Maps", href: `https://www.google.com/maps/dir/?api=1&destination=${ll}` },
    { label: "Waze", href: `https://waze.com/ul?ll=${ll}&navigate=yes` },
    { label: "Apple Maps", href: `https://maps.apple.com/?daddr=${ll}` },
  ];
}
