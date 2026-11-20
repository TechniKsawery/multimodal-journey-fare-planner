// Port of fares/db.py: Deutsche Bahn Flexpreis (upper bound) x BahnCard multiplier + age rules.
// The optional unofficial price lookup (_unofficial_estimate, disabled by default in Python) is NOT
// ported: the app has no server and must not call unofficial APIs from the browser.
import table from "../../../data/fares/db_flexpreis.json";
import { ValueError, fileOrderKeys, pyFloatStr, pyList, pyRepr, round2 } from "../pyCompat";
import { Carrier, PriceType, type PriceEstimate, type Segment, type Table } from "./model";

const TABLE: Table = table;

export function flexpreisUpperBound(distanceKm: number): number {
  for (const pasmo of TABLE["pasma_odleglosci_km"]) {
    if (pasmo["do_km"] === null || distanceKm <= pasmo["do_km"]) return pasmo["cena"];
  }
  throw new ValueError("brak pasma cenowego dla podanej odległości");
}

function isInfantFree(age: number | null): boolean {
  return age !== null && age < (TABLE["dziecko_bezplatnie_wiek_max"] ?? 6);
}

function isChildAge(age: number | null): boolean {
  const min = TABLE["dziecko_wiek_min"] ?? 6;
  const max = TABLE["dziecko_wiek_max"] ?? 14;
  return age !== null && min <= age && age <= max;
}

export function estimate(segment: Segment): PriceEstimate {
  if (segment.carrier !== Carrier.DB) {
    throw new ValueError(`nieprawidłowy przewoźnik dla kalkulatora DB: ${segment.carrier}`);
  }
  if (segment.distance_km === null) throw new ValueError("DB: distance_km jest wymagane");

  const bahncard = segment.discounts.bahncard || "brak";
  const mnozniki: Record<string, number> = TABLE["bahncard_mnoznik"];
  if (!Object.hasOwn(mnozniki, bahncard)) {
    throw new ValueError(`nieznana BahnCard: ${pyRepr(bahncard)}, dostępne: ${pyList(fileOrderKeys(mnozniki))}`);
  }

  const upperBound = flexpreisUpperBound(segment.distance_km);
  const mnoznik = mnozniki[bahncard];
  const mnoznikNiepotwierdzony = ((TABLE["bahncard_mnoznik_niepotwierdzone"] ?? []) as string[]).includes(bahncard);

  const age = segment.discounts.age;
  const childWithGuardian = segment.discounts.child_with_guardian;
  const mnoznikNote = mnoznikNiepotwierdzony
    ? `Mnożnik BahnCard ${bahncard} (${pyFloatStr(mnoznik)}) jest NIEPOTWIERDZONY źródłem na bahn.de.`
    : "Mnożnik BahnCard jest oficjalny (bahn.de/faq).";

  if (isInfantFree(age)) {
    return {
      carrier: Carrier.DB,
      amount: 0.0,
      currency: TABLE["waluta"],
      price_type: PriceType.ESTIMATE,
      breakdown: {
        flexpreis_gorna_granica: upperBound,
        bahncard,
        mnoznik,
        klasa: TABLE["klasa"],
        mnoznik_potwierdzony: !mnoznikNiepotwierdzony,
        wiek: age,
        kategoria_wiekowa: "dziecko_do_5_lat",
      },
      notes:
        "Flexpreis DB (krajowy): dziecko poniżej 6 lat podróżuje bezpłatnie i bez biletu: " +
        "'Kinder im Alter von 0 bis inklusive 5 Jahre reisen innerhalb Deutschlands immer " +
        "kostenfrei und ohne eigene Fahrkarte' (bahn.de, zweryfikowano 2026-10-14).",
    };
  }

  if (isChildAge(age) && childWithGuardian) {
    return {
      carrier: Carrier.DB,
      amount: 0.0,
      currency: TABLE["waluta"],
      price_type: PriceType.ESTIMATE,
      breakdown: {
        flexpreis_gorna_granica: upperBound,
        bahncard,
        mnoznik,
        klasa: TABLE["klasa"],
        mnoznik_potwierdzony: !mnoznikNiepotwierdzony,
        wiek: age,
        child_with_guardian: true,
        kategoria_wiekowa: "dziecko_6_14_z_opiekunem",
      },
      notes:
        "Flexpreis DB (krajowy): dziecko 6–14 lat podróżujące w towarzystwie osoby od 15 lat " +
        "podróżuje bezpłatnie: 'Kinder im Alter von 6 bis inklusive 14 Jahre fahren in " +
        "Begleitung von Reisenden ab 15 Jahre kostenfrei' (bahn.de, zweryfikowano 2026-10-14).",
    };
  }

  if (isChildAge(age) && !childWithGuardian) {
    const childDiscountPct = Number(TABLE["dziecko_samodzielnie_rabat_procent"] ?? 50);
    const childMultiplier = 1.0 - childDiscountPct / 100.0;
    const effectiveMultiplier = childMultiplier * mnoznik;
    const amount = round2(upperBound * effectiveMultiplier);
    return {
      carrier: Carrier.DB,
      amount,
      currency: TABLE["waluta"],
      price_type: PriceType.ESTIMATE,
      breakdown: {
        flexpreis_gorna_granica: upperBound,
        bahncard,
        mnoznik,
        ulga_dziecieca_rabat_procent: childDiscountPct,
        ulga_dziecieca_mnoznik: childMultiplier,
        efektywny_mnoznik: effectiveMultiplier,
        klasa: TABLE["klasa"],
        mnoznik_potwierdzony: !mnoznikNiepotwierdzony,
        wiek: age,
        child_with_guardian: false,
        kategoria_wiekowa: "dziecko_6_14_samodzielnie",
      },
      notes:
        "Flexpreis to górna granica z tabeli pasm odległości (szacunek). Dziecko 6–14 lat " +
        "podróżujące SAMODZIELNIE otrzymuje 50% rabatu na Flexpreis: 'Allein reisende Kinder " +
        "erhalten bis zu ihrem 15. Geburtstag 50 % Rabatt auf Flexpreis- oder Sparpreis-Tickets' " +
        "(bahn.de, zweryfikowano 2026-10-14). " +
        mnoznikNote,
    };
  }

  const amount = round2(upperBound * mnoznik);
  const breakdown: Record<string, unknown> = {
    flexpreis_gorna_granica: upperBound,
    bahncard,
    mnoznik,
    klasa: TABLE["klasa"],
    mnoznik_potwierdzony: !mnoznikNiepotwierdzony,
  };
  if (age !== null) breakdown["wiek"] = age;

  return {
    carrier: Carrier.DB,
    amount,
    currency: TABLE["waluta"],
    price_type: PriceType.ESTIMATE,
    breakdown,
    notes:
      "Flexpreis to górna granica z tabeli pasm odległości (nadal szacunek, patrz " +
      "_uwaga w danych) — rzeczywista cena DB może być niższa i zależy od konkretnej " +
      "trasy/pociągu. " +
      mnoznikNote,
  };
}
