// SYNTHETIC itineraries for five reference relations: real station coordinates, plausible operators
// and times, but NOT recorded from Transitous (it is unreachable from the build environment).
// They exist to compare price coverage of the pricing adapters and to guard against regressions;
// replace with real recordings when somebody with access takes them.
import type { Itinerary, Leg } from "../../transitous";

const S = (name: string, lat: number, lon: number, tz = "Europe/Berlin") => ({ name, lat, lon, tz });
const LUBLIN = S("Lublin Główny", 51.2316, 22.5662, "Europe/Warsaw");
const WAW = S("Warszawa Centralna", 52.2288, 21.0033, "Europe/Warsaw");
const KRK = S("Kraków Główny", 50.0647, 19.945, "Europe/Warsaw");
const WRO = S("Wrocław Główny", 51.0986, 17.0368, "Europe/Warsaw");
const ZGO = S("Zgorzelec", 51.1523, 15.0069, "Europe/Warsaw");
const GOR = S("Görlitz", 51.1494, 14.9818);
const DRE = S("Dresden Hbf", 51.0405, 13.732);
const BER = S("Berlin Hbf", 52.5251, 13.3694);
const HAM = S("Hamburg Hbf", 53.5528, 10.0069);
const GEL = S("Gelsenkirchen Hbf", 51.5047, 7.1018);

const L = (mode: string, from: Leg["from"], to: Leg["to"], a: string, b: string, agencyName: string, routeShortName: string): Leg => ({
  mode, from, to, startTime: `2026-11-24T${a}:00Z`, endTime: `2026-11-24T${b}:00Z`, duration: 0, agencyName, routeShortName,
});
const I = (legs: Leg[]): Itinerary => ({
  startTime: legs[0].startTime, endTime: legs[legs.length - 1].endTime, duration: 0, transfers: legs.length - 1, legs,
});

export const referenceRoutes: Record<string, Itinerary> = {
  "Lublin-Gelsenkirchen": I([
    L("LONG_DISTANCE", LUBLIN, WAW, "04:30", "06:40", "PKP Intercity", "IC 3500"),
    L("LONG_DISTANCE", WAW, BER, "07:30", "13:00", "PKP Intercity", "EC 45"),
    L("HIGHSPEED_RAIL", BER, GEL, "13:40", "18:15", "DB Fernverkehr AG", "ICE 945"),
  ]),
  "Lublin-Berlin": I([
    L("LONG_DISTANCE", LUBLIN, WAW, "04:30", "06:40", "PKP Intercity", "IC 3500"),
    L("LONG_DISTANCE", WAW, BER, "07:30", "13:00", "PKP Intercity", "EC 45"),
  ]),
  "Warszawa-Berlin": I([L("LONG_DISTANCE", WAW, BER, "07:30", "13:00", "PKP Intercity", "EC 45")]),
  "Krakow-Hamburg": I([
    L("LONG_DISTANCE", KRK, WAW, "05:00", "07:30", "PKP Intercity", "IC 5304"),
    L("LONG_DISTANCE", WAW, BER, "08:30", "14:00", "PKP Intercity", "EC 45"),
    L("HIGHSPEED_RAIL", BER, HAM, "14:40", "16:45", "DB Fernverkehr AG", "ICE 1"),
  ]),
  "Wroclaw-Drezno": I([
    L("REGIONAL_RAIL", WRO, ZGO, "06:00", "08:30", "Koleje Dolnośląskie", "KD 35"),
    L("REGIONAL_RAIL", GOR, DRE, "08:50", "10:25", "trilex", "RB 60"),
  ]),
};
