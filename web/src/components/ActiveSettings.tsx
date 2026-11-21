import type { Profile } from '../types';
import type { Dict } from '../i18n';

interface Chip {
  label: string;
  on: boolean;
}

/** Jednym rzutem oka: co jest włączone w cenach, a co nie, i gdzie to zmienić. */
export function ActiveSettings({
  t,
  profile,
  onChange,
}: {
  t: Dict;
  profile: Profile;
  onChange: () => void;
}) {
  const discountOn = profile.status !== 'none';
  const chips: Chip[] = [
    {
      label: discountOn
        ? `${t.chipDiscount}: ${t[`who_${profile.status}` as keyof Dict] as string}, ${t.chipId} ${profile.idCountry.toUpperCase()}`
        : `${t.chipDiscount}: ${t.chipNone}`,
      on: discountOn,
    },
    {
      label:
        profile.bahncard !== 'none'
          ? `${t.chipBc} ${profile.bahncard}`
          : `${t.chipBc}: ${t.chipNone}`,
      on: profile.bahncard !== 'none',
    },
    {
      label: `${t.chipDt}: ${profile.deutschlandticket || profile.bahncard === '100' ? t.yes : t.no}`,
      on: profile.deutschlandticket === true || profile.bahncard === '100',
    },
  ];
  return (
    <div class="active" aria-label={t.active}>
      <ul class="chips">
        {chips.map((c) => (
          <li class={`chip ${c.on ? 'on' : 'off'}`}>
            <span aria-hidden="true">{c.on ? '✓' : '○'}</span> {c.label}
            {!c.on && <span class="sr"> ({t.inactive})</span>}
          </li>
        ))}
      </ul>
      <button type="button" class="link" onClick={onChange}>
        {t.change}
      </button>
      <p class="muted hint">{t.chipHint}</p>
    </div>
  );
}
