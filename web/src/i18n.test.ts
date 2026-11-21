import { describe, expect, it } from 'vitest';
import { LANGS, RAW, dict, detectLang, fmtDuration } from './i18n';

const keys = (l: (typeof LANGS)[number]) => Object.keys(RAW[l]);
const baseKeys = (l: (typeof LANGS)[number]) => keys(l).filter((k) => !/_(few|many|zero|two)$/.test(k));
const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('i18n', () => {
  it('every language has the same base keys as English', () => {
    for (const l of LANGS) expect(baseKeys(l).sort(), l).toEqual(baseKeys('en').sort());
  });
  it('placeholders match English and no value is empty', () => {
    for (const l of LANGS)
      for (const k of keys(l)) {
        expect(RAW[l][k].trim(), `${l}.${k}`).not.toBe('');
        if (RAW.en[k] !== undefined && !/_(few|many)$/.test(k))
          expect(ph(RAW[l][k]), `${l}.${k}`).toBe(ph(RAW.en[k]));
      }
  });
  it('plural forms resolve in all languages', () => {
    for (const l of LANGS)
      for (const n of [0, 1, 2, 5, 22]) {
        expect(dict[l].resultsCount(n)).toContain(String(n));
        expect(dict[l].transfersN(n).length).toBeGreaterThan(0);
      }
    expect(dict.pl.resultsCount(3)).toBe('3 warianty');
    expect(dict.pl.transfersN(2)).toBe('2 przesiadki');
    expect(dict.en.transfersN(0)).toBe('Direct');
  });
  it('detects browser language with English fallback', () => {
    expect(detectLang(['de-AT', 'en'])).toBe('de');
    expect(detectLang(['ja', 'nl-BE'])).toBe('nl');
    expect(detectLang(['ja'])).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
  it('formats duration', () => {
    expect(fmtDuration(125, 'en')).toBe('2 h 05 min');
    expect(fmtDuration(45, 'de')).toBe('45 Min.');
  });
});
