// SYNTHETIC fixture shaped like a Transitous /api/v6/plan response (field names from the MOTIS 2
// API). It is NOT a live recording: Transitous is blocked from the cloud container where this was
// written. Replace/extend it with real recordings once taken from a machine with access (see PR).
import type { Itinerary, Leg } from "../../transitous";

const stop = (name: string, lat: number, lon: number, tz = "Europe/Berlin") => ({ name, lat, lon, tz });

const leg = (p: Partial<Leg> & Pick<Leg, "mode" | "from" | "to" | "startTime" | "endTime">): Leg => ({
  duration: (Date.parse(p.endTime) - Date.parse(p.startTime)) / 1000,
  ...p,
});

export const POZNAN = stop("Poznań Główny", 52.4017, 16.9114, "Europe/Warsaw");
export const RZEPIN = stop("Rzepin", 52.3454, 14.8303, "Europe/Warsaw");
export const FFO = stop("Frankfurt (Oder)", 52.3359, 14.5459);
export const BERLIN = stop("Berlin Ostbahnhof", 52.5105, 13.4348);
export const WARSZAWA = stop("Warszawa Centralna", 52.2288, 21.0033, "Europe/Warsaw");
export const GDANSK = stop("Gdańsk Główny", 54.3555, 18.6439, "Europe/Warsaw");
export const KOLN = stop("Köln Hbf", 50.9432, 6.9587);
export const BERLIN_HBF = stop("Berlin Hbf", 52.5251, 13.3694);

/** IC Poznań -> Rzepin, regional train over the border to Berlin: the typical mixed PL-DE trip. */
export const mixed: Itinerary = {
  startTime: "2026-11-23T06:10:00Z",
  endTime: "2026-11-23T09:40:00Z",
  duration: 12600,
  transfers: 2,
  legs: [
    leg({ mode: "REGIONAL_FAST_RAIL", from: POZNAN, to: RZEPIN, startTime: "2026-11-23T06:10:00Z", endTime: "2026-11-23T07:45:00Z", agencyName: "PKP Intercity", routeShortName: "IC 5304" }),
    leg({ mode: "WALK", from: RZEPIN, to: RZEPIN, startTime: "2026-11-23T07:45:00Z", endTime: "2026-11-23T07:50:00Z" }),
    leg({ mode: "REGIONAL_RAIL", from: RZEPIN, to: FFO, startTime: "2026-11-23T08:05:00Z", endTime: "2026-11-23T08:30:00Z", agencyName: "POLREGIO", routeShortName: "R" }),
    leg({ mode: "REGIONAL_RAIL", from: FFO, to: BERLIN, startTime: "2026-11-23T08:36:00Z", endTime: "2026-11-23T09:40:00Z", agencyName: "DB Regio AG", routeShortName: "RE1" }),
  ],
};

/** One direct domestic IC, one EIC (premium), one German ICE. */
export const icDomestic: Itinerary = {
  startTime: "2026-11-23T07:00:00Z",
  endTime: "2026-11-23T09:00:00Z",
  duration: 7200,
  transfers: 0,
  legs: [leg({ mode: "HIGHSPEED_RAIL", from: WARSZAWA, to: GDANSK, startTime: "2026-11-23T07:00:00Z", endTime: "2026-11-23T09:00:00Z", agencyName: "PKP Intercity", routeShortName: "IC 1310" })],
};
export const eicDomestic: Itinerary = {
  startTime: "2026-11-23T08:00:00Z",
  endTime: "2026-11-23T09:50:00Z",
  duration: 6600,
  transfers: 0,
  legs: [leg({ mode: "HIGHSPEED_RAIL", from: WARSZAWA, to: GDANSK, startTime: "2026-11-23T08:00:00Z", endTime: "2026-11-23T09:50:00Z", agencyName: "PKP Intercity", routeShortName: "EIC 1604" })],
};
export const iceDomestic: Itinerary = {
  startTime: "2026-11-23T10:00:00Z",
  endTime: "2026-11-23T14:00:00Z",
  duration: 14400,
  transfers: 0,
  legs: [leg({ mode: "HIGHSPEED_RAIL", from: BERLIN_HBF, to: KOLN, startTime: "2026-11-23T10:00:00Z", endTime: "2026-11-23T14:00:00Z", agencyName: "DB Fernverkehr AG", routeShortName: "ICE 945" })],
};

/** Transfer of 3 minutes between two stops: physically impossible, must be dropped. */
export const impossible: Itinerary = {
  startTime: "2026-11-23T06:00:00Z",
  endTime: "2026-11-23T09:00:00Z",
  duration: 10800,
  transfers: 1,
  legs: [
    leg({ mode: "REGIONAL_RAIL", from: RZEPIN, to: FFO, startTime: "2026-11-23T06:00:00Z", endTime: "2026-11-23T06:30:00Z", agencyName: "POLREGIO" }),
    leg({ mode: "WALK", from: FFO, to: BERLIN, startTime: "2026-11-23T06:30:00Z", endTime: "2026-11-23T06:31:00Z" }),
    leg({ mode: "REGIONAL_RAIL", from: BERLIN, to: BERLIN_HBF, startTime: "2026-11-23T06:32:00Z", endTime: "2026-11-23T09:00:00Z", agencyName: "DB Regio AG" }),
  ],
};
