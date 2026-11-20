import type { Itinerary } from './types';

/**
 * DANE PRZYKŁADOWE do prototypu UI. Kwoty NIE pochodzą z cenników
 * i nie wolno ich pokazywać jako prawdziwych (UI wyświetla baner "dane przykładowe").
 * Podłączenie prawdziwego core/ (port Pythona) jest zadaniem osobnego wątku.
 */
export const SAMPLE_VERIFIED = '2026-11-01';

export const sample: Itinerary[] = [
  {
    id: 'a',
    tag: 'cheapest',
    legs: [
      { mode: 'rail', carrier: 'PKP Intercity', from: 'Poznań Główny', to: 'Rzepin', depart: '07:15', arrive: '08:52', price: 40, currency: 'PLN', status: 'official', source: 'Cennik PKP IC (przykład)', sourceUrl: 'https://www.intercity.pl', verified: SAMPLE_VERIFIED, note: 'Ulga ustawowa 51% (student, polska legitymacja)' },
      { mode: 'rail', carrier: 'Polregio', from: 'Rzepin', to: 'Frankfurt (Oder)', depart: '09:14', arrive: '09:41', price: 17, currency: 'PLN', status: 'official', source: 'Cennik Polregio (przykład)', sourceUrl: 'https://polregio.pl', verified: SAMPLE_VERIFIED },
      { mode: 'rail', carrier: 'DB Regio (RE1)', from: 'Frankfurt (Oder)', to: 'Berlin Alexanderplatz', depart: '09:52', arrive: '10:33', price: 20, currency: 'PLN', status: 'estimate', source: 'Taryfa VBB (przykład)', sourceUrl: 'https://www.vbb.de', verified: SAMPLE_VERIFIED, note: 'Widełki ceny zależą od taryfy; niemiecka kolej nie honoruje polskiej ulgi.' },
    ],
    transfers: [
      { place: 'Rzepin', minutes: 22, risk: 'ok' },
      { place: 'Frankfurt (Oder)', minutes: 11, risk: 'tight' },
    ],
    totalPln: 77,
    totalPlnHigh: 95,
    regularPln: 140,
    durationMin: 198,
    status: 'estimate',
  },
  {
    id: 'b',
    tag: 'fastest',
    legs: [
      { mode: 'rail', carrier: 'PKP Intercity (EC)', from: 'Poznań Główny', to: 'Berlin Hbf', depart: '08:05', arrive: '10:50', price: 110, currency: 'PLN', status: 'estimate', source: 'Oferta PL–DE (przykład)', sourceUrl: 'https://www.intercity.pl', verified: SAMPLE_VERIFIED, note: 'Cena dynamiczna: zależy od puli promocyjnej w dniu zakupu.' },
    ],
    transfers: [],
    totalPln: 110,
    totalPlnHigh: 190,
    regularPln: 190,
    durationMin: 165,
    status: 'estimate',
  },
  {
    id: 'c',
    tag: 'safest',
    legs: [
      { mode: 'bus', carrier: 'FlixBus', from: 'Poznań ZDK', to: 'Berlin ZOB', depart: '09:30', arrive: '13:10', price: 65, currency: 'PLN', status: 'estimate', source: 'FlixBus (przykład)', sourceUrl: 'https://www.flixbus.pl', verified: SAMPLE_VERIFIED },
    ],
    transfers: [],
    totalPln: 65,
    durationMin: 220,
    status: 'estimate',
  },
  {
    id: 'd',
    legs: [
      { mode: 'rail', carrier: 'PKP Intercity', from: 'Poznań Główny', to: 'Rzepin', depart: '11:15', arrive: '12:52', price: 40, currency: 'PLN', status: 'official', source: 'Cennik PKP IC (przykład)', sourceUrl: 'https://www.intercity.pl', verified: SAMPLE_VERIFIED },
      { mode: 'rail', carrier: 'Regionalny przewoźnik', from: 'Rzepin', to: 'Berlin Ostbahnhof', depart: '13:20', arrive: '15:10', status: 'unconfirmed', note: 'Brak cennika dla tego odcinka w bazie. Sprawdź cenę u przewoźnika.' },
    ],
    transfers: [{ place: 'Rzepin', minutes: 28, risk: 'ok' }],
    totalPln: 40,
    durationMin: 235,
    status: 'unconfirmed',
    partial: true,
  },
];
