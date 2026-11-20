// Coarse geography helpers for the pricing adapter.
//
// The polygons below are deliberately SHRUNK a little inside the real borders: a stop right on the
// border (Słubice, Zgorzelec, Frankfurt (Oder), Görlitz...) resolves to `null`, and "country unknown"
// always ends as "price unconfirmed". They are a stop-gap until the geo module of the core/ port
// lands (it works from the Python oracle's border logic); do not use them for anything but gating
// which tariff may be applied.

export type Country = "PL" | "DE";
type Ring = readonly (readonly [lon: number, lat: number])[];

const PL: Ring = [
  [14.4, 53.9], [14.3, 53.4], [14.5, 52.95], [14.65, 52.45], [14.85, 52.1], [14.85, 51.6], [15.1, 51.3],
  [15.2, 51.0], [15.9, 50.85], [16.5, 50.55], [16.75, 50.3], [17.3, 50.2], [18.0, 50.1], [18.6, 49.95],
  [19.3, 49.55], [19.8, 49.4], [20.4, 49.4], [21.3, 49.5], [22.3, 49.2], [22.7, 49.5], [22.6, 50.4],
  [23.5, 50.4], [23.9, 51.6], [23.5, 52.2], [23.4, 52.7], [23.6, 53.1], [23.4, 54.2], [22.8, 54.3],
  [22.0, 54.3], [19.7, 54.35], [18.9, 54.45], [18.4, 54.75], [17.5, 54.7], [16.5, 54.55], [15.5, 54.25],
];

const DE: Ring = [
  [7.3, 53.55], [8.6, 54.0], [8.9, 54.5], [9.4, 54.7], [10.3, 54.65], [11.0, 54.35], [12.0, 54.2],
  [13.0, 54.4], [13.7, 54.2], [13.9, 53.9], [14.1, 53.5], [14.1, 52.8], [14.4, 52.4], [14.5, 51.9],
  [14.6, 51.5], [14.85, 51.0], [14.2, 50.9], [13.2, 50.5], [12.4, 50.3], [12.2, 50.2], [12.5, 49.7],
  [13.5, 49.15], [13.3, 48.6], [12.8, 48.2], [12.9, 47.75], [12.2, 47.65], [11.0, 47.55], [10.3, 47.55],
  [9.7, 47.6], [9.2, 47.7], [8.6, 47.7], [7.7, 47.6], [7.65, 48.2], [7.8, 48.7], [8.1, 49.05],
  [7.2, 49.1], [7.0, 49.4], [6.7, 49.6], [6.5, 49.9], [6.4, 50.3], [6.3, 50.85], [6.2, 51.1],
  [6.3, 51.5], [6.5, 51.8], [7.1, 51.95], [7.2, 52.3], [7.3, 52.6], [7.3, 53.3],
];

function inside(ring: Ring, lat: number, lon: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** "PL" / "DE" when the point is clearly inside that country, otherwise null (unknown or ambiguous). */
export function countryOf(lat: number, lon: number): Country | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (inside(PL, lat, lon)) return "PL";
  if (inside(DE, lat, lon)) return "DE";
  return null;
}

/** Great-circle distance in km (the same measure the Python oracle feeds to the tariff tables). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
