import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { BudgetExceededError } from '../transitous';
import { suggest, type GeocodeSuggestion } from '../search/service';
import type { Dict } from '../i18n';

export interface PlaceValue {
  text: string;
  match: GeocodeSuggestion | null;
}

interface Props {
  label: string;
  value: PlaceValue;
  onChange: (v: PlaceValue) => void;
  t: Dict;
  enterkeyhint: 'next' | 'search';
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 350;

// most local administrative area first (highest OSM admin level), e.g. the city of a station
const describe = (m: GeocodeSuggestion): string =>
  [m.type === 'STOP' ? '' : m.type, [...(m.areas ?? [])].sort((a, b) => b.adminLevel - a.adminLevel)[0]?.name, m.country]
    .filter(Boolean)
    .join(' · ');

/** Autouzupełnianie miejsc (Transitous /geocode): debounce, anulowanie, cache i budżet są w kliencie. */
export function PlaceInput({ label, value, onChange, t, enterkeyhint }: Props) {
  const [options, setOptions] = useState<GeocodeSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [hint, setHint] = useState<string | null>(null);
  const listId = useId();
  const timer = useRef<number | undefined>(undefined);
  const trimmed = value.text.trim();

  useEffect(() => {
    window.clearTimeout(timer.current);
    setHint(null);
    if (value.match || trimmed.length < MIN_CHARS) {
      setOptions([]);
      return;
    }
    const ctrl = new AbortController();
    timer.current = window.setTimeout(() => {
      suggest(trimmed, ctrl.signal)
        .then((r) => {
          setOptions(r.slice(0, 7));
          setActive(-1);
          setOpen(true);
          if (r.length === 0) setHint(t.noPlaces);
        })
        .catch((e: unknown) => {
          if ((e as Error)?.name === 'AbortError') return;
          setOptions([]);
          setHint(e instanceof BudgetExceededError ? t.geocodeBudget : t.geocodeDown);
        });
    }, DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer.current);
    };
  }, [trimmed, value.match]);

  const pick = (m: GeocodeSuggestion) => {
    setOptions([]);
    setOpen(false);
    onChange({ text: m.name, match: m });
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((active + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((active - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const expanded = open && options.length > 0;
  return (
    <div class="place">
      <label>
        <span>{label}</span>
        <input
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          value={value.text}
          maxLength={120}
          autocomplete="off"
          autocapitalize="words"
          spellcheck={false}
          enterkeyhint={enterkeyhint}
          placeholder={t.placePlaceholder}
          onInput={(e) => onChange({ text: e.currentTarget.value, match: null })}
          onKeyDown={onKey}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        />
      </label>
      {expanded && (
        <ul class="options" id={listId} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={`${o.lat}${o.lon}${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              class={i === active ? 'active' : ''}
              // mousedown (nie click), bo blur inputu zamknąłby listę przed kliknięciem
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              <span>{o.name}</span>
              <small>{describe(o)}</small>
            </li>
          ))}
        </ul>
      )}
      {hint && !value.match && (
        <p class="muted hint" role="status">
          {hint}
        </p>
      )}
    </div>
  );
}
