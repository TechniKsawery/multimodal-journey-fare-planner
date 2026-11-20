// Shared by the distance-band rail tariffs (POLREGIO, SKM, Koleje Małopolskie, Koleje Mazowieckie).
import { ValueError, formatFixed, truthy } from "../pyCompat";
import type { Table } from "./model";

/** Band for a distance; tariff km are whole numbers, so a fraction rounds UP (5.4 km is already band 6-10). */
export function bandFor(table: Table, distanceKm: number, errorPrefix: string, errorSuffix = ""): Table {
  const tariffKm = Math.ceil(distanceKm);
  for (const band of table["pasma_odleglosci_km"] as Table[]) {
    if (tariffKm <= band["do_km"]) return band;
  }
  throw new ValueError(`${errorPrefix} ${formatFixed(distanceKm, 0)} km${errorSuffix}`);
}

/** Confirmation of a band, only when it has a source URL and a date; otherwise null. */
export function confirmationOf(band: Table): Table | null {
  const c = band["potwierdzone"];
  if (truthy(c) && String(c["zrodlo_url"] ?? "").startsWith("http") && truthy(c["data"])) return c;
  return null;
}
