import type { Profile } from '../types';
import type { Dict } from '../i18n';
import { PlaceInput, type PlaceValue } from './PlaceInput';

export interface Query {
  from: PlaceValue;
  to: PlaceValue;
  date: string;
  time: string;
}

interface Props {
  t: Dict;
  busy: boolean;
  query: Query;
  profile: Profile;
  onQuery: (q: Query) => void;
  onProfile: (p: Profile) => void;
  onSearch: () => void;
  profileOpen: boolean;
  onProfileOpen: (o: boolean) => void;
}

export function SearchPanel({ t, busy, query, profile, onQuery, onProfile, onSearch, profileOpen, onProfileOpen }: Props) {
  const set = <K extends keyof Query>(k: K, v: Query[K]) => onQuery({ ...query, [k]: v });
  const setP = <K extends keyof Profile>(k: K, v: Profile[K]) => onProfile({ ...profile, [k]: v });
  const summary = [
    t[`who_${profile.status}` as keyof Dict] as string,
    profile.status !== 'none' ? (profile.idCountry === 'pl' ? t.pl : t.de) : '',
    profile.bahncard !== 'none' ? `BahnCard ${profile.bahncard}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <form
      class="panel"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
    >
      <div class="route">
        <PlaceInput
          label={t.from}
          value={query.from}
          onChange={(v) => set('from', v)}
          t={t}
          enterkeyhint="next"
        />
        <button
          type="button"
          class="icon-btn swap"
          aria-label={t.swap}
          onClick={() => onQuery({ ...query, from: query.to, to: query.from })}
        >
          ⇅
        </button>
        <PlaceInput
          label={t.to}
          value={query.to}
          onChange={(v) => set('to', v)}
          t={t}
          enterkeyhint="search"
        />
      </div>

      <div class="row2">
        <label>
          <span>{t.date}</span>
          <input type="date" required value={query.date} onInput={(e) => set('date', e.currentTarget.value)} />
        </label>
        <label>
          <span>{t.time}</span>
          <input type="time" required value={query.time} onInput={(e) => set('time', e.currentTarget.value)} />
        </label>
      </div>

      <details
        class="profile"
        id="profile"
        open={profileOpen}
        onToggle={(e) => onProfileOpen(e.currentTarget.open)}
      >
        <summary>
          <span>{t.profileSummary}</span>
          <span class="muted">{summary}</span>
        </summary>
        <div class="profile-body">
          <fieldset>
            <legend>{t.profile}</legend>
            <div class="seg" role="radiogroup">
              {(['none', 'student', 'pupil'] as const).map((v) => (
                <label class={profile.status === v ? 'on' : ''}>
                  <input
                    type="radio"
                    name="who"
                    checked={profile.status === v}
                    onChange={() => setP('status', v)}
                  />
                  {t[`who_${v}` as keyof Dict] as string}
                </label>
              ))}
            </div>
          </fieldset>
          {profile.status !== 'none' && (
            <fieldset>
              <legend>{t.idCountry}</legend>
              <div class="seg">
                {(['pl', 'de'] as const).map((v) => (
                  <label class={profile.idCountry === v ? 'on' : ''}>
                    <input
                      type="radio"
                      name="idc"
                      checked={profile.idCountry === v}
                      onChange={() => setP('idCountry', v)}
                    />
                    {t[v]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div class="row2">
            <label>
              <span>{t.age}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={profile.age}
                onInput={(e) => setP('age', Number(e.currentTarget.value) || 0)}
              />
            </label>
            <label>
              <span>{t.bahncard}</span>
              <select
                value={profile.bahncard}
                onChange={(e) => setP('bahncard', e.currentTarget.value as Profile['bahncard'])}
              >
                <option value="none">{t.bc_none}</option>
                <option value="25">BahnCard 25</option>
                <option value="50">BahnCard 50</option>
                <option value="100">BahnCard 100</option>
              </select>
            </label>
          </div>
        </div>
      </details>

      <button type="submit" class="primary" disabled={busy}>
        {busy ? t.searching : t.search}
      </button>
    </form>
  );
}
