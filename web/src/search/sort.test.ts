import { describe, expect, it } from 'vitest';
import { comparePrice } from './sort';

const it_ = (totalPln: number, pricedLegs: number, totalLegs: number, durationMin = 600) => ({
  totalPln,
  durationMin,
  partial: pricedLegs < totalLegs,
  noPrice: pricedLegs === 0,
});

describe('comparePrice', () => {
  it('the reported case: partial sums are never ordered by coverage ratio', () => {
    // Lublin -> Buerer Strasse 8, student + BahnCard 25: 566 (5/6), 563 (4/5), 422 (3/4), 483 (4/6), 500 (4/6)
    const reported = [it_(566, 5, 6), it_(563, 4, 5), it_(422, 3, 4), it_(483, 4, 6), it_(500, 4, 6)];
    const sorted = [...reported].sort(comparePrice).map((x) => x.totalPln);
    expect(sorted).toEqual([422, 483, 500, 563, 566]);
  });
  it('fully priced routes come before partial ones, even when more expensive', () => {
    const list = [it_(300, 2, 3), it_(900, 3, 3), it_(100, 0, 3), it_(500, 3, 3)];
    expect([...list].sort(comparePrice).map((x) => x.totalPln)).toEqual([500, 900, 300, 100]);
  });
  it('without any price: by duration', () => {
    expect(comparePrice(it_(0, 0, 2, 300), it_(0, 0, 2, 200))).toBeGreaterThan(0);
  });
});
