// Minimal UI strings for the prototype. English is the default, Polish the second language.
// The full 6-language catalogue (pl/en/de/es/fr/nl) is converted from i18n/*.py in a later step.
export type Lang = "en" | "pl";

const messages = {
  en: {
    title: "Multimodal Fare Planner",
    tagline: "Compare rail, bus and flight connections — and see what you would actually pay.",
    from: "From",
    to: "To",
    when: "Departure",
    search: "Search",
    searching: "Searching…",
    pick: "Pick a place",
    noResults: "No connections found.",
    transfers: "transfers",
    priceNote: "Prices are not shown yet: the fare engine is being ported (no price is ever guessed without a source and a verification date).",
    budgetLeft: "Routing requests left today",
    errBudget: "Daily routing request budget reached. Try again tomorrow.",
    errBusy: "The public routing service is busy or unavailable. Try again later.",
    errGeneric: "Something went wrong while searching.",
    attribution: "Routing: Transitous · Map data © OpenStreetMap contributors (ODbL)",
    sources: "Data sources",
    contact: "Contact / issues",
    disclaimer: "BETA. Free, non-commercial open-source project. Not affiliated with any carrier. Connection data may be incomplete or outdated; always check with the operator.",
  },
  pl: {
    title: "Multimodalna wyszukiwarka połączeń",
    tagline: "Porównaj połączenia koleją, autobusem i samolotem — i zobacz, ile faktycznie zapłacisz.",
    from: "Skąd",
    to: "Dokąd",
    when: "Odjazd",
    search: "Szukaj",
    searching: "Szukam…",
    pick: "Wybierz miejsce",
    noResults: "Nie znaleziono połączeń.",
    transfers: "przesiadek",
    priceNote: "Ceny jeszcze się nie wyświetlają: silnik taryf jest w trakcie portowania (żadna cena nie jest zgadywana bez źródła i daty weryfikacji).",
    budgetLeft: "Pozostałe dziś zapytania o trasę",
    errBudget: "Wyczerpano dzienny limit zapytań o trasę. Spróbuj jutro.",
    errBusy: "Publiczna usługa wyszukiwania tras jest zajęta lub niedostępna. Spróbuj później.",
    errGeneric: "Coś poszło nie tak podczas wyszukiwania.",
    attribution: "Routing: Transitous · Dane map © współtwórcy OpenStreetMap (ODbL)",
    sources: "Źródła danych",
    contact: "Kontakt / zgłoszenia",
    disclaimer: "BETA. Darmowy, niekomercyjny projekt open-source. Niepowiązany z żadnym przewoźnikiem. Dane o połączeniach mogą być niekompletne lub nieaktualne; zawsze sprawdź u przewoźnika.",
  },
} as const;

export type MsgKey = keyof (typeof messages)["en"];
export const t = (lang: Lang, key: MsgKey): string => messages[lang][key];

export function detectLang(nav: { language?: string } | undefined = globalThis.navigator): Lang {
  return nav?.language?.toLowerCase().startsWith("pl") ? "pl" : "en";
}
