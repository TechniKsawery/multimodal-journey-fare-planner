// Coverage matrix for the leg pricing: realistic (SYNTHETIC, not recorded) legs of the typical PL<->DE routes, with the
// carrier module and the confirmation status core/ gives them today. It documents where a price is missing and why
// (see core/PRICING_GAPS.md); it is not a source of prices. Agency names/modes follow the Transitous (MOTIS 2) format.
// When a tariff module is added (or a detection is fixed), the expected row changes here on purpose.
import { describe, expect, it } from "vitest";
import { itineraryToLegs } from "../src/routing/motis";
import { priceLeg } from "../src/routing/pricing";
import { LegMode, priceVerified } from "../src/routing/model";
import { defaultProfile } from "../src/fares/model";

type S = [string, number, number, string];
const P: Record<string, S> = {

  LUB: ["Lublin Główny", 51.2314, 22.5692, "pl_1"], WAW: ["Warszawa Zachodnia", 52.2203, 20.9657, "pl_2"], WWS: ["Warszawa Wschodnia", 52.2518, 21.0525, "pl_3"],
  BER: ["Berlin Hbf", 52.5251, 13.3694, "defv_1"], HAM: ["Hamm(Westf)Hbf", 51.6781, 7.8083, "derv_1"], GEL: ["Gelsenkirchen Hbf", 51.5049, 7.1022, "derv_2"],
  KRK: ["Kraków Główny", 50.0678, 19.9475, "pl_4"], WRO: ["Wrocław Główny", 51.0988, 17.0364, "pl_5"], HH: ["Hamburg Hbf", 53.553, 10.0063, "defv_2"],
  GOR: ["Görlitz", 51.1493, 14.9855, "defv_3"], ZGO: ["Zgorzelec", 51.1500, 15.0040, "pl_6"], DRE: ["Dresden Hbf", 51.0403, 13.7324, "defv_4"],
  POZ: ["Poznań Główny", 52.4019, 16.9125, "pl_7"], FFO: ["Frankfurt (Oder)", 52.3359, 14.5459, "defv_5"], KOS: ["Kostrzyn", 52.5909, 14.6538, "pl_8"],
  BERO: ["Berlin Ostbahnhof", 52.5107, 13.4346, "defv_6"], BERZ: ["Berlin Zoologischer Garten", 52.5069, 13.3326, "defv_7"], BERL: ["Berlin-Lichtenberg", 52.5107, 13.4964, "defv_8"],
  HAN: ["Hannover Hbf", 52.3766, 9.7410, "defv_9"], DOR: ["Dortmund Hbf", 51.5172, 7.4595, "derv_3"], ESS: ["Essen Hbf", 51.4515, 7.0131, "derv_4"],
  HAMS: ["Hamburg Dammtor", 53.5606, 9.9894, "defv_10"], LEI: ["Leipzig Hbf", 51.3455, 12.3813, "defv_11"], KAT: ["Katowice", 50.2594, 19.0171, "pl_9"],
  SZC: ["Szczecin Główny", 53.4192, 14.5517, "pl_10"], ANG: ["Angermünde", 53.0161, 14.0003, "defv_12"],
};
const ep = (k: string) => ({ name: P[k][0], lat: P[k][1], lon: P[k][2], stopId: P[k][3] });

/** [label, MOTIS mode, agencyName, routeShortName, from, to, minutes, expected carrier module, expected "price confirmed"] */
type Row = [string, string, string, string, string, string, number, string | null, boolean];
const ROWS: Row[] = [
  ["PKP IC Lublin-Warszawa", "RAIL", "PKP Intercity", "IC 1234", "LUB", "WAW", 120, "pkp_intercity", true],
  ["PKP IC Lublin-Warszawa", "HIGHSPEED_RAIL", "PKP Intercity", "IC 1234", "LUB", "WAW", 120, "pkp_intercity", true],
  ["PKP IC Lublin-Warszawa", "LONG_DISTANCE", "PKP Intercity", "IC 1234", "LUB", "WAW", 120, "pkp_intercity", true],
  ["PKP IC Lublin-Warszawa", "NIGHT_RAIL", "PKP Intercity", "IC 1234", "LUB", "WAW", 120, "pkp_intercity", true],
  ["PKP IC Lublin-Warszawa", "REGIONAL_FAST_RAIL", "PKP Intercity", "IC 1234", "LUB", "WAW", 120, "pkp_intercity", true],
  ["PKP IC Lublin-Warszawa", "REGIONAL_RAIL", "PKP Intercity", "IC 1234", "LUB", "WAW", 120, "pkp_intercity", true],
  ["EC Warszawa-Berlin", "LONG_DISTANCE", "PKP Intercity", "EC 45", "WWS", "BER", 330, "international_pl_de", false],
  ["EC Warszawa-Berlin (spółka)", "LONG_DISTANCE", "PKP Intercity S.A.", "EC 45", "WWS", "BER", 330, "international_pl_de", false],
  ["ICE Berlin-Hamm", "HIGHSPEED_RAIL", "DB Fernverkehr AG", "ICE 845", "BER", "HAM", 240, "db", false],
  ["IC Berlin-Hamm", "LONG_DISTANCE", "DB Fernverkehr AG", "IC 2", "BER", "HAM", 240, "db", false],
  ["IC Berlin-Hamm (DB Fernv. nazwa)", "LONG_DISTANCE", "DB Fernverkehr", "IC 2", "BER", "HAM", 240, "db", false],
  ["RE Hamm-Gelsenkirchen", "REGIONAL_FAST_RAIL", "DB Regio AG NRW", "RE 3", "HAM", "GEL", 50, "vrr", true],
  ["RE Hamm-Gelsenkirchen (Abellio)", "REGIONAL_FAST_RAIL", "Abellio Rail NRW", "RE 1", "HAM", "GEL", 50, "vrr", true],
  ["RE Hamm-Gelsenkirchen (National Express)", "REGIONAL_FAST_RAIL", "National Express Rail", "RE 7", "DOR", "ESS", 50, "vrr", true],
  ["S Essen-Gelsenkirchen", "SUBURBAN", "DB Regio AG NRW", "S2", "ESS", "GEL", 25, "vrr", true],
  ["RB Hamm-Dortmund", "REGIONAL_RAIL", "DB Regio AG NRW", "RB 53", "HAM", "DOR", 35, "vrr", true],
  ["Flix Lublin-Berlin", "COACH", "FlixBus", "N120", "LUB", "BER", 900, null, false],
  ["Flix Warszawa-Berlin", "COACH", "FlixBus", "N120", "WAW", "BER", 600, null, false],
  ["Berlin S-Bahn", "SUBURBAN", "S-Bahn Berlin GmbH", "S5", "BERO", "BERZ", 25, "bvg_berlin", true],
  ["Berlin RE w obrębie miasta", "REGIONAL_FAST_RAIL", "DB Regio AG Nordost", "RE1", "BERO", "BERZ", 15, "bvg_berlin", true],
  ["Berlin RE do Frankfurtu/O (ODEG)", "REGIONAL_FAST_RAIL", "ODEG", "RE1", "BERO", "FFO", 80, null, false],
  ["Berlin RE do Frankfurtu/O (DB Regio)", "REGIONAL_FAST_RAIL", "DB Regio AG Nordost", "RE1", "BERO", "FFO", 80, null, false],
  ["Frankfurt/O-Kostrzyn-Berlin przesiadka", "REGIONAL_RAIL", "ODEG", "RB26", "FFO", "BERL", 70, null, false],
  ["Szczecin-Angermünde DB Regio", "REGIONAL_FAST_RAIL", "DB Regio AG Nordost", "RE66", "SZC", "ANG", 60, null, false],
  ["Warszawa-Berlin EC Kraków", "LONG_DISTANCE", "PKP Intercity", "EC 55", "KRK", "BER", 700, "international_pl_de", false],
  ["Kraków-Katowice IC", "LONG_DISTANCE", "PKP Intercity", "IC 5", "KRK", "KAT", 100, "pkp_intercity", true],
  ["Kraków-Wrocław IC", "LONG_DISTANCE", "PKP Intercity", "TLK 3", "KRK", "WRO", 240, "pkp_intercity", true],
  ["Wrocław-Poznań Polregio", "REGIONAL_RAIL", "POLREGIO", "R", "WRO", "POZ", 180, "polregio_taryfa_podstawowa", true],
  ["Poznań-Berlin EC", "LONG_DISTANCE", "PKP Intercity", "EC", "POZ", "BER", 200, "international_pl_de", false],
  ["Berlin-Hamburg ICE", "HIGHSPEED_RAIL", "DB Fernverkehr AG", "ICE 28", "BER", "HH", 100, "db", false],
  ["Hamburg S-Bahn", "SUBURBAN", "S-Bahn Hamburg GmbH", "S1", "HH", "HAMS", 8, "hvv", true],
  ["Hamburg-Hannover metronom", "REGIONAL_FAST_RAIL", "metronom Eisenbahngesellschaft", "RE 3", "HH", "HAN", 100, null, false],
  ["Wrocław-Görlitz KD", "REGIONAL_RAIL", "Koleje Dolnośląskie", "KD", "WRO", "GOR", 150, null, false],
  ["Wrocław-Zgorzelec KD", "REGIONAL_RAIL", "Koleje Dolnośląskie", "KD", "WRO", "ZGO", 150, null, false],
  ["Görlitz-Dresden trilex", "REGIONAL_FAST_RAIL", "trilex", "RE 1", "GOR", "DRE", 90, null, false],
  ["Görlitz-Dresden Ostdeutsche", "REGIONAL_FAST_RAIL", "Die Länderbahn GmbH DLB", "RE 1", "GOR", "DRE", 90, null, false],
  ["Wrocław-Dresden EC/IC (DB)", "LONG_DISTANCE", "DB Fernverkehr AG", "EC", "WRO", "DRE", 280, "international_pl_de", false],
  ["Koleje Wielkopolskie Poznań", "REGIONAL_RAIL", "Koleje Wielkopolskie", "KW", "POZ", "WRO", 120, null, false],
  ["Przewozy Regionalne", "REGIONAL_RAIL", "Przewozy Regionalne", "R", "WRO", "POZ", 180, null, false],
  ["Leipzig-Dresden IC", "LONG_DISTANCE", "DB Fernverkehr AG", "IC", "LEI", "DRE", 90, "db", false],
  ["Leipzig-Dresden FlixTrain", "LONG_DISTANCE", "FlixTrain", "FLX", "BER", "HH", 100, null, false],
];

describe("pricing coverage on typical PL<->DE routes (synthetic legs)", () => {
  for (const [label, mode, agency, route, a, b, mins, carrier, verified] of ROWS) {
    it(`${label} [${mode}, ${agency}]`, () => {
      const t0 = Date.parse("2026-12-01T06:00:00Z");
      const raw = { legs: [{ mode, agencyName: agency, routeShortName: route, from: ep(a), to: ep(b), startTime: new Date(t0).toISOString(), endTime: new Date(t0 + mins * 60000).toISOString() }] };
      const [leg] = itineraryToLegs(raw as never);
      const pl = priceLeg(leg, defaultProfile());
      expect((pl.carrier as string | null) ?? null).toBe(carrier);
      expect(priceVerified(pl)).toBe(verified);
    });
  }

  it("MOTIS 2 train classes are rail, so IC/EC keep their PKP/DB tariff (LONG_DISTANCE used to fall through as a bus)", () => {
    for (const mode of ["RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_FAST_RAIL", "REGIONAL_RAIL"]) {
      const raw = { legs: [{ mode, agencyName: "PKP Intercity", routeShortName: "IC 1", from: ep("LUB"), to: ep("WAW"), startTime: "2026-12-01T06:00:00Z", endTime: "2026-12-01T08:00:00Z" }] };
      expect(itineraryToLegs(raw as never)[0].mode).toBe(LegMode.RAIL);
    }
    for (const mode of ["BUS", "COACH", "TRAM", "SUBWAY", "SUBURBAN"]) {
      const raw = { legs: [{ mode, agencyName: "X", routeShortName: "1", from: ep("LUB"), to: ep("WAW"), startTime: "2026-12-01T06:00:00Z", endTime: "2026-12-01T08:00:00Z" }] };
      expect(itineraryToLegs(raw as never)[0].mode).toBe(LegMode.BUS);
    }
  });
});
