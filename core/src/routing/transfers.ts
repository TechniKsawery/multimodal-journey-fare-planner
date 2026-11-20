// Port of routing/transfers.py: safety of transfers between consecutive legs.
// The minimum times are ESTIMATES (not official carrier guidance).
import { formatFixed, truthy } from "../pyCompat";
import { msg } from "../i18n/msg";
import { LegMode, type Leg, type TransferWarning } from "./model";

export const MIN_TRANSFER_MINUTES_SAME_PLATFORM = 20; // rail->rail, no platform/station change
export const MIN_TRANSFER_MINUTES_WALK = 30; // rail->rail, with a platform/station change
export const MIN_TRANSFER_MINUTES_RAIL_TO_FLIGHT = 120; // walk to the terminal, check-in, security
export const MIN_TRANSFER_MINUTES_FLIGHT_TO_RAIL = 60; // leave the plane, reach the station
export const MIN_TRANSFER_MINUTES_FLIGHT_TO_RAIL_CHECKED = 90; // same, collecting checked baggage

// ABSOLUTE feasibility minima: below them a person physically cannot make it (variant rejected).
export const FEASIBLE_MIN_MINUTES_SAME_PLATFORM = 3;
export const FEASIBLE_MIN_MINUTES_WALK = 8;
export const FEASIBLE_MIN_MINUTES_RAIL_TO_FLIGHT = 60;
export const FEASIBLE_MIN_MINUTES_FLIGHT_TO_RAIL = 45;

// Stop complexes that GTFS/MOTIS names differently but that are physically one building/hub.
export const KNOWN_STATION_COMPLEX_ALIASES: readonly ReadonlySet<string>[] = [
  new Set(["Dworzec Lublin - Kunickiego", "Dworzec Lublin", "Lublin Główny"]),
  new Set(["Berlin-Lichtenberg", "S+U Lichtenberg Bhf (Berlin)"]),
];

/** MOTIS flagged the transfer as needing a walk, but it is really the same stop complex. */
function sameStop(prev: Leg, next: Leg): boolean {
  const origin = prev.destination_name;
  const destination = next.origin_name;
  if (!origin || !destination) return false;
  if (origin === destination) return true;
  return KNOWN_STATION_COMPLEX_ALIASES.some((alias) => alias.has(origin) && alias.has(destination));
}

export function feasibleMinimumMinutes(prevMode: LegMode, nextMode: LegMode, requiresWalk: boolean, same = false): number {
  if (prevMode === LegMode.FLIGHT && nextMode === LegMode.FLIGHT) return FEASIBLE_MIN_MINUTES_RAIL_TO_FLIGHT;
  if (nextMode === LegMode.FLIGHT) return FEASIBLE_MIN_MINUTES_RAIL_TO_FLIGHT;
  if (prevMode === LegMode.FLIGHT) return FEASIBLE_MIN_MINUTES_FLIGHT_TO_RAIL;
  if (requiresWalk && same) return FEASIBLE_MIN_MINUTES_SAME_PLATFORM;
  return requiresWalk ? FEASIBLE_MIN_MINUTES_WALK : FEASIBLE_MIN_MINUTES_SAME_PLATFORM;
}

export function minimumTransferMinutes(prevMode: LegMode, nextMode: LegMode, requiresWalk: boolean, same = false): number {
  if (prevMode === LegMode.RAIL && nextMode === LegMode.FLIGHT) return MIN_TRANSFER_MINUTES_RAIL_TO_FLIGHT;
  if (prevMode === LegMode.FLIGHT && nextMode === LegMode.RAIL) return MIN_TRANSFER_MINUTES_FLIGHT_TO_RAIL;
  if (prevMode === LegMode.FLIGHT && nextMode === LegMode.FLIGHT) return MIN_TRANSFER_MINUTES_RAIL_TO_FLIGHT;
  if (requiresWalk && same) return MIN_TRANSFER_MINUTES_SAME_PLATFORM;
  return requiresWalk ? MIN_TRANSFER_MINUTES_WALK : MIN_TRANSFER_MINUTES_SAME_PLATFORM;
}

/** Flight -> rail threshold: longer when checked baggage has to be collected. */
export const flightToRailMinimum = (checkedBaggage: boolean): number =>
  checkedBaggage ? MIN_TRANSFER_MINUTES_FLIGHT_TO_RAIL_CHECKED : MIN_TRANSFER_MINUTES_FLIGHT_TO_RAIL;

export function checkTransfer(prev: Leg, next: Leg, afterLegIndex: number): TransferWarning | null {
  const gapMinutes = (next.depart.getTime() - prev.arrive.getTime()) / 60000;
  const same = next.requires_walk && sameStop(prev, next);
  let minimum = minimumTransferMinutes(prev.mode, next.mode, next.requires_walk, same);
  if (prev.mode === LegMode.FLIGHT && next.mode === LegMode.RAIL) {
    const checked = prev.extra["checked_baggage"];
    minimum = flightToRailMinimum(checked === undefined ? true : truthy(checked));
  }
  if (gapMinutes >= minimum) return null;

  const infeasible = gapMinutes < feasibleMinimumMinutes(prev.mode, next.mode, next.requires_walk, same);
  const why = same ? msg("transfer.why_same_stop") : next.requires_walk ? msg("transfer.why_walk") : msg("transfer.why_same_platform");
  return {
    after_leg_index: afterLegIndex,
    gap_minutes: gapMinutes,
    minimum_required_minutes: minimum,
    reason: msg("transfer.reason", {
      gap: formatFixed(gapMinutes, 0),
      prev: msg(`mode.${prev.mode}`),
      next: msg(`mode.${next.mode}`),
      why,
      origin: prev.destination_name,
      destination: next.origin_name,
      minimum: formatFixed(minimum, 0),
    }),
    infeasible,
  };
}

export function checkAllTransfers(legs: Leg[]): TransferWarning[] {
  const warnings: TransferWarning[] = [];
  // Walking legs (to/from an address) are not transfers: skipped, but original indices are kept.
  const indexed = legs.map((leg, i) => [i, leg] as const).filter(([, leg]) => leg.mode !== LegMode.WALK);
  for (let k = 0; k + 1 < indexed.length; k++) {
    const w = checkTransfer(indexed[k][1], indexed[k + 1][1], indexed[k][0]);
    if (w !== null) warnings.push(w);
  }
  return warnings;
}
