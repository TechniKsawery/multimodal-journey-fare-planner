import { useState } from 'preact/hooks';
import type { Itinerary, Leg } from '../types';
import { fmtDuration, fmtMoney, type Dict, type Lang } from '../i18n';
import { PriceBadge } from './PriceBadge';

const MODE_ICON = { rail: '🚆', bus: '🚌', local: '🚋', flight: '✈️', walk: '🚶' } as const;

function LegRow({ leg, t, lang }: { leg: Leg; t: Dict; lang: Lang }) {
  const price =
    leg.price !== undefined && leg.currency ? fmtMoney(leg.price, leg.currency, lang) : '—';
  return (
    <li class="leg">
      <div class="leg-time">
        <b>{leg.depart}</b>
        <span>{leg.arrive}</span>
      </div>
      <div class="leg-body">
        <div class="leg-route">
          <span aria-label={t[`mode_${leg.mode}` as keyof Dict] as string}>{MODE_ICON[leg.mode]}</span>{' '}
          {leg.from} → {leg.to}
        </div>
        <div class="muted">{leg.carrier}</div>
        {leg.reason && <div class="note">{t[`reason_${leg.reason}` as keyof Dict] as string}</div>}
        {leg.note && <div class="note">{leg.note}</div>}
        {leg.status === 'unconfirmed' ? (
          <div class="source">{t.unconfirmed_hint}</div>
        ) : (
          <div class="source">
            {t.source}:{' '}
            {leg.sourceUrl && /^https:\/\//.test(leg.sourceUrl) ? (
              <a href={leg.sourceUrl} target="_blank" rel="noopener noreferrer">
                {leg.source}
              </a>
            ) : (
              leg.source
            )}
            {leg.verified && ` · ${t.verified}: ${leg.verified}`}
          </div>
        )}
      </div>
      <div class="leg-price">
        <b>{price}</b>
        <PriceBadge status={leg.status} t={t} />
      </div>
    </li>
  );
}

export function ResultCard({ it, t, lang }: { it: Itinerary; t: Dict; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  const panelId = `details-${it.id}`;
  const tight = it.transfers.some((x) => x.risk === 'tight');

  const total = it.totalPlnHigh
    ? `${fmtMoney(it.totalPln, 'PLN', lang)} – ${fmtMoney(it.totalPlnHigh, 'PLN', lang)}`
    : fmtMoney(it.totalPln, 'PLN', lang);

  return (
    <article class="card">
      <div class="card-head">
        {it.tag && <span class={`tag tag-${it.tag}`}>{t[`tag_${it.tag}` as keyof Dict] as string}</span>}
        <PriceBadge status={it.status} t={t} />
      </div>

      <div class="card-main">
        <div class="times">
          <span class="big">
            {first.depart} → {last.arrive}
          </span>
          <span class="muted">
            {fmtDuration(it.durationMin)} · {t.transfersN(it.transfers.length)}
            {tight && <span class="warn-inline"> · ⚠ {t.tight}</span>}
          </span>
        </div>
        <div class="price">
          <span class="big">{it.noPrice ? t.noPrice : `${it.partial ? `${t.partial}: ` : ''}${total}`}</span>
          {it.regularPln && (
            <span class="muted">
              {t.instead} <s>{fmtMoney(it.regularPln, 'PLN', lang)}</s>
            </span>
          )}
        </div>
      </div>

      <button
        class="toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {open ? t.hide : t.details} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div id={panelId} class="details">
          <ol class="legs">
            {it.legs.map((leg, i) => (
              <>
                <LegRow leg={leg} t={t} lang={lang} />
                {it.transfers[i] && (
                  <li class={`transfer ${it.transfers[i].risk}`}>
                    ⏱ {it.transfers[i].place}: {it.transfers[i].minutes} {t.minutes}
                    {it.transfers[i].risk === 'tight' && ` — ${t.tight}`}
                  </li>
                )}
              </>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}
