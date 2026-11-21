import type { PriceStatus } from '../types';
import type { Dict } from '../i18n';

const ICON: Record<PriceStatus, string> = { official: '✓', ceiling: '≤', estimate: '≈', unconfirmed: '?' };

/** Status ceny: ikona + tekst (nie tylko kolor), więc czytelny też bez rozróżniania barw. */
export function PriceBadge({ status, t }: { status: PriceStatus; t: Dict }) {
  return (
    <span class={`badge badge-${status}`} title={t[`${status}_hint` as const]}>
      <span aria-hidden="true">{ICON[status]}</span> {t[status]}
    </span>
  );
}
