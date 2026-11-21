/** Status ceny: odpowiada zasadzie projektu "nigdy nie zgaduj cen". */
export type PriceStatus = 'official' | 'ceiling' | 'estimate' | 'unconfirmed';

export type Mode = 'rail' | 'bus' | 'local' | 'flight' | 'walk';

export interface Leg {
  mode: Mode;
  carrier: string;
  from: string;
  to: string;
  depart: string; // HH:MM
  arrive: string; // HH:MM
  /** brak kwoty = nie znamy ceny (nie wliczamy do sumy) */
  price?: number;
  currency?: 'PLN' | 'EUR';
  status: PriceStatus;
  /** wymagane gdy status !== unconfirmed */
  source?: string;
  sourceUrl?: string;
  verified?: string; // YYYY-MM-DD
  note?: string;
  /** klucz powodu braku/niepewności ceny (tekst w i18n); gdy brak, cena jest w pełni potwierdzona */
  reason?: string;
}

export interface Transfer {
  place: string;
  minutes: number;
  risk: 'ok' | 'tight';
}

export interface Itinerary {
  id: string;
  tag?: 'cheapest' | 'fastest' | 'safest';
  legs: Leg[];
  transfers: Transfer[];
  totalPln: number;
  /** górna granica, gdy któryś odcinek ma widełki */
  totalPlnHigh?: number;
  regularPln?: number;
  durationMin: number;
  /** najsłabszy status spośród odcinków */
  status: PriceStatus;
  /** true = suma obejmuje tylko odcinki ze znaną ceną */
  partial?: boolean;
  /** true = żaden odcinek nie ma znanej ceny (nie pokazujemy sumy 0) */
  noPrice?: boolean;
  /** ile odcinków ma znaną cenę / ile jest wszystkich (bez dojść pieszo) */
  pricedLegs?: number;
  totalLegs?: number;
  /** Set when the connection is NOT on the requested day (shown only when nothing runs that day). */
  otherDay?: { date: string; offset: number };
}

export interface Profile {
  status: 'none' | 'student' | 'pupil';
  idCountry: 'pl' | 'de';
  age: number;
  bahncard: 'none' | '25' | '50' | '100';
  /** Holds a Deutschlandticket (optional: profiles saved earlier have no such field). */
  deutschlandticket?: boolean;
  /** Manual choices from "More options": DiscountProfile field -> value; they win over defaults derived from age/status. */
  overrides?: Record<string, boolean | string>;
}
