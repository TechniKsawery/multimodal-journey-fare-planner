// Port of the rail constants of routing/demo_route.py: fixed intermediate hubs, given as StopRef (name + coordinates)
// because MOTIS stop ids change with every refresh of the GTFS data; the id is resolved at run time by findStopId.
// Flight hubs (airports + access stations) are not ported: flights have no live prices here.
import type { StopRef } from "./transitousClient";
import type { AlternativeStop } from "./variants";

export const LUBLIN_GLOWNY_STOP: StopRef = { name: "Lublin Główny", lat: 51.2314, lon: 22.5692 };
export const GELSENKIRCHEN_HBF_STOP: StopRef = { name: "Gelsenkirchen Hbf", lat: 51.5049, lon: 7.1022 };
export const POZNAN_GLOWNY_STOP: StopRef = { name: "Poznań Główny", lat: 52.4019, lon: 16.9125 };
export const ESSEN_HBF_STOP: StopRef = { name: "Essen Hbf", lat: 51.4515, lon: 7.0131 };

/** Explicitly tried intermediate nodes (rail only). */
export const VIA_HUB_STOPS: readonly AlternativeStop[] = [{ label: "Poznań Główny", stop_id: POZNAN_GLOWNY_STOP }];

/**
 * A fixed alternative destination station. Only for requests whose destination is already a station (station vs station
 * comparison): for an address -> address search it would cut off the real address, so `search()` does NOT use it.
 */
export const ALTERNATIVE_DESTINATION_STOPS: readonly AlternativeStop[] = [{ label: "Essen Hbf", stop_id: ESSEN_HBF_STOP }];
