/** Status ceny: odpowiada zasadzie projektu "nigdy nie zgaduj cen". */
export type PriceStatus = 'official' | 'estimate' | 'unconfirmed';

export type Mode = 'rail' | 'bus' | 'flight' | 'walk';

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
}

export interface Profile {
  status: 'none' | 'student' | 'pupil';
  idCountry: 'pl' | 'de';
  age: number;
  bahncard: 'none' | '25' | '50';
}
