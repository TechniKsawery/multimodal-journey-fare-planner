import { describe, expect, it } from 'vitest';
import { rankSuggestions } from './service';
import { localQuery, placeText } from '../../../core/src/places/aliases';

const g = (name: string) => ({ lat: 50, lon: 7, name, type: 'STOP' });

describe('places', () => {
  it('typed names in other languages become local ones for the geocoder', () => {
    expect(localQuery('Cologne')).toBe('Köln');
    expect(localQuery('Krakau')).toBe('Kraków');
  });
  it('results are shown with the interface-language city name and the original', () => {
    expect(placeText('Köln Hbf', 'en')).toContain('Köln Hbf');
    expect(placeText('Köln Hbf', 'pl')).toContain('Kolonia');
  });
  it('exact name first, then prefix, then the rest (stable)', () => {
    const r = rankSuggestions('Köln', [g('Bahnhof Köln Messe'), g('Köln Hbf'), g('Köln'), g('Köln Süd')]);
    expect(r.map((x) => x.name)).toEqual(['Köln', 'Köln Hbf', 'Köln Süd', 'Bahnhof Köln Messe']);
  });
});
