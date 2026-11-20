// Ports of fares/ztm_warszawa.py, mpk_krakow.py and ztm_poznan.py. The three Python files are
// copies of one template (age rules for children + free/reduced flags), so one parameterised
// implementation serves all of them; the golden vectors prove each keeps its own wording.
import krakow from "../../../data/fares/mpk_krakow.json";
import poznan from "../../../data/fares/ztm_poznan.json";
import warszawa from "../../../data/fares/ztm_warszawa.json";
import { ValueError, formatFixed, parseIsoDate } from "../pyCompat";
import { Carrier, PriceType, type DiscountProfile, type PriceEstimate, type Segment, type Table } from "./model";
import { pickTicket, sortedTickets } from "./timed";

interface Config {
  carrier: Carrier;
  table: Table;
  label: string; // used in error messages
  freeFlag: keyof DiscountProfile;
  reducedFlag: keyof DiscountProfile;
  defaultZone: string;
  headline: (table: Table) => string;
}

type AgeRights = [boolean, boolean, boolean, string | null]; // free, reduced, estimate, description

function ageRights(table: Table, segment: Segment): AgeRights {
  const age = segment.discounts.age;
  const dzieciBezplatne: Table | null = table["dzieci_bezplatne"] ?? null;
  const dzieciUlgowe: Table | null = table["dzieci_ulgowe"] ?? null;
  if (age === null || !dzieciBezplatne || Object.keys(dzieciBezplatne).length === 0) {
    return [false, false, false, null];
  }
  const limitBezplatny: number = dzieciBezplatne["do_wieku"];
  const beforeSep30 = (): boolean => {
    const d = parseIsoDate(segment.travel_date as string);
    return d.month < 9 || (d.month === 9 && d.day <= 30);
  };
  if (age < limitBezplatny - 1) {
    return [true, false, false, `dziecko do 30.09 roku ukończenia ${limitBezplatny} lat`];
  }
  if (age === limitBezplatny - 1) {
    if (segment.travel_date) {
      if (beforeSep30()) {
        return [true, false, true, "dziecko w wieku 6 lat przed 30.09 (status bezpłatny/ulgowy zależy od daty urodzenia)"];
      }
      return [false, true, true, "dziecko w wieku 6 lat po 30.09 (status bezpłatny/ulgowy zależy od daty urodzenia)"];
    }
    return [false, true, true, "dziecko w wieku 6 lat (status bezpłatny/ulgowy zależy od daty urodzenia)"];
  }
  if (age === limitBezplatny) {
    if (segment.travel_date) {
      if (beforeSep30()) {
        return [true, false, true, "dziecko w wieku 7 lat do 30.09 (status bezpłatny/ulgowy zależy od daty urodzenia)"];
      }
      return [false, true, false, "dziecko w wieku 7 lat po 30.09 (bilet ulgowy)"];
    }
    return [false, true, true, "dziecko w wieku 7 lat (status bezpłatny/ulgowy zależy od daty urodzenia)"];
  }
  if (dzieciUlgowe && Object.keys(dzieciUlgowe).length > 0) {
    const limitUlgowy: number = dzieciUlgowe["do_wieku"];
    if (limitBezplatny < age && age < limitUlgowy) {
      return [false, true, false, `dziecko od 1.10 roku ukończenia 7 lat do ${limitUlgowy} lat`];
    }
  }
  return [false, false, false, null];
}

function makeEstimator(cfg: Config): (segment: Segment) => PriceEstimate {
  const bilety = sortedTickets(cfg.table);
  const najdluzszy = bilety[bilety.length - 1];
  return (segment) => {
    if (segment.carrier !== cfg.carrier) {
      throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora ${cfg.label}: ${segment.carrier}`);
    }
    if (segment.ride_duration_min === null) {
      throw new ValueError(`${cfg.label} (taryfa czasowa): ride_duration_min jest wymagane`);
    }
    const duration = segment.ride_duration_min;
    const bilet = pickTicket(bilety, duration);
    const [wiekBezplatny, wiekUlgowy, wiekSzacunek, opisWieku] = ageRights(cfg.table, segment);
    const ownFree = segment.discounts[cfg.freeFlag] as boolean;
    const ownReduced = segment.discounts[cfg.reducedFlag] as boolean;
    const bezplatny = ownFree || wiekBezplatny;
    const ulgowy = ownReduced || wiekUlgowy;
    let amount: number;
    let typBiletu: string;
    if (bezplatny) {
      amount = 0.0;
      typBiletu = "bezpłatny (100%)";
    } else if (ulgowy) {
      amount = bilet["ulgowy"];
      typBiletu = "ulgowy (50%)";
    } else {
      amount = bilet["normalny"];
      typBiletu = "normalny";
    }
    const przekroczono = duration > najdluzszy["wazny_min"];
    const jestSzacunek = przekroczono || (wiekSzacunek && !ownFree);

    const breakdown: Record<string, unknown> = {
      relacja: `${segment.origin} <-> ${segment.destination}`,
      czas_jazdy_min: duration,
      bilet_wazny_min: bilet["wazny_min"],
      typ_biletu: typBiletu,
      strefa: bilet["strefa"] ?? cfg.defaultZone,
      zrodlo_url: cfg.table["zrodlo_url"] ?? null,
      data_weryfikacji: cfg.table["data_weryfikacji"] ?? null,
    };
    if (wiekBezplatny && !ownFree) breakdown["powod_bezplatny"] = opisWieku;
    if (wiekUlgowy && !ownReduced) breakdown["uprawnienie_wiek"] = opisWieku;
    if (wiekSzacunek && !ownFree) breakdown["wiek_status_szacunek"] = true;

    const age = segment.discounts.age;
    let ageNote = "";
    if (wiekSzacunek && !ownFree) {
      if (age === 6) {
        ageNote =
          " Dla dziecka w wieku 6 lat status bezpłatny/ulgowy zależy od daty urodzenia " +
          "(czy 7. urodziny przypadają w roku podróży, czy w następnym) — wynik to szacunek.";
      } else if (age === 7) {
        ageNote =
          " Dla dziecka w wieku 7 lat status bezpłatny/ulgowy zależy od daty urodzenia " +
          "(czy 7. urodziny przypadają w roku podróży, czy w poprzednim) — wynik to szacunek.";
      }
    }
    const notes =
      `${cfg.headline(cfg.table)}: dobrano bilet ${bilet["wazny_min"]}-minutowy.` +
      (wiekBezplatny && !ownFree ? ` Przejazd bezpłatny z wieku: ${opisWieku}.` : "") +
      (wiekUlgowy && !ownReduced ? ` Ulga z wieku: ${opisWieku}.` : "") +
      ageNote +
      (przekroczono
        ? ` Czas jazdy (${formatFixed(duration, 0)} min) przekracza najdłuższy dostępny ` +
          `bilet (${najdluzszy["wazny_min"]} min) — cena to szacunek.`
        : "");

    return {
      carrier: cfg.carrier,
      amount,
      currency: cfg.table["waluta"],
      price_type: jestSzacunek ? PriceType.ESTIMATE : PriceType.OFFICIAL,
      breakdown,
      notes,
    };
  };
}

export const estimateWarszawa = makeEstimator({
  carrier: Carrier.ZTM_WARSZAWA,
  table: warszawa,
  label: "ZTM Warszawa",
  freeFlag: "ztm_warszawa_bezplatny",
  reducedFlag: "ztm_warszawa_ulgowy",
  defaultZone: "1+2",
  headline: (t) => `Taryfa czasowa ZTM Warszawa (${t["nazwa_przewoznika"]})`,
});

export const estimateKrakow = makeEstimator({
  carrier: Carrier.MPK_KRAKOW,
  table: krakow,
  label: "MPK Kraków",
  freeFlag: "mpk_krakow_bezplatny",
  reducedFlag: "mpk_krakow_ulgowy",
  defaultZone: "I+II+III",
  headline: (t) => `Taryfa czasowa MPK Kraków (${t["nazwa_przewoznika"]}, ważna od 2.03.2026)`,
});

export const estimatePoznan = makeEstimator({
  carrier: Carrier.ZTM_POZNAN,
  table: poznan,
  label: "ZTM Poznań",
  freeFlag: "ztm_poznan_bezplatny",
  reducedFlag: "ztm_poznan_ulgowy",
  defaultZone: "A+B+C+D",
  headline: (t) => `Taryfa czasowa ZTM Poznań (${t["nazwa_przewoznika"]}, ważna od 1.09.2025)`,
});
