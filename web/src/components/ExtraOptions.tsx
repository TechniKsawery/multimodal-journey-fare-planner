import type { Profile } from '../types';
import type { Dict } from '../i18n';
import { baseDiscountProfile } from '../search/profile';
import { BOOL_FIELDS, PKP_CODES } from '../search/extraOptions';

/** "More options": every discount switch of the core profile, defaults shown, manual choices stored in profile.overrides. */
export function ExtraOptions({ t, profile, onProfile }: { t: Dict; profile: Profile; onProfile: (p: Profile) => void }) {
  const base = baseDiscountProfile(profile) as unknown as Record<string, unknown>;
  const ov = profile.overrides ?? {};
  const set = (key: string, value: boolean | string) => onProfile({ ...profile, overrides: { ...ov, [key]: value } });
  const reset = () => onProfile({ ...profile, overrides: undefined });
  const pkp = (ov['pkp_ulga_kod'] as string | undefined) ?? 'auto';
  const label = (f: (typeof BOOL_FIELDS)[number]) =>
    f.key === 'child_with_guardian' ? t.childWithGuardian : `${f.name}: ${t[`kind_${f.kind}` as keyof Dict] as string}`;
  return (
    <details class="extras">
      <summary>{t.moreOptions}</summary>
      <p class="muted small-note">{t.moreOptionsHint}</p>
      <label>
        <span>{t.pkpRelief}</span>
        <select value={pkp} onChange={(e) => (e.currentTarget.value === 'auto' ? onProfile({ ...profile, overrides: Object.fromEntries(Object.entries(ov).filter(([k]) => k !== 'pkp_ulga_kod')) }) : set('pkp_ulga_kod', e.currentTarget.value))}>
          <option value="auto">{t.pkpAuto}</option>
          {PKP_CODES.map((c) => (
            <option key={c} value={c}>
              {t[`pkp_${c}` as keyof Dict] as string}
            </option>
          ))}
        </select>
      </label>
      {BOOL_FIELDS.map((f) => (
        <label class="check" key={f.key}>
          <input
            type="checkbox"
            checked={(ov[f.key] as boolean | undefined) ?? base[f.key] === true}
            onChange={(e) => set(f.key, e.currentTarget.checked)}
          />
          <span>{label(f)}</span>
        </label>
      ))}
      {Object.keys(ov).length > 0 && (
        <button type="button" class="link-btn" onClick={reset}>
          {t.resetExtras}
        </button>
      )}
    </details>
  );
}
