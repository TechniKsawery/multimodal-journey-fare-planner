import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dict, detectLang, isLang, LANGS, LANG_NAMES, type Dict, type Lang } from './i18n';
import { load, save } from './storage';
import type { Profile } from './types';
import { ResultCard } from './components/ResultCard';
import { ActiveSettings } from './components/ActiveSettings';
import { SearchPanel, type Query } from './components/SearchPanel';
import { BudgetExceededError } from './transitous';
import { BudgetExceededError as PerSearchBudgetError } from '../../core/src/routing/errors';
import { MotisError } from '../../core/src/routing/errors';
import { planBudget, searchRoutes, suggest, type GeocodeSuggestion } from './search/service';
import { buildResults } from './search/adapt';
import { comparePrice } from './search/sort';

type Theme = 'auto' | 'light' | 'dark';
type Sort = 'price' | 'time';
type Tab = 'all' | 'fastest' | 'cheapest' | 'safest';

const defaultProfile: Profile = { status: 'student', idCountry: 'pl', age: 21, bahncard: 'none' };
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
type ErrKey = 'errPast' | 'errBudget' | 'errBusy' | 'errNetwork' | 'errGeneric' | 'errPlace' | 'errTime';

function errorKey(e: unknown): ErrKey {
  if (e instanceof BudgetExceededError) return 'errBudget';
  // the per-search budget is spent by retries: the service kept failing (429/5xx)
  if (e instanceof PerSearchBudgetError) return 'errBusy';
  if (e instanceof MotisError) {
    const err = String(e.msg.params['error'] ?? '');
    if (/\b429\b/.test(err)) return 'errBusy';
    return e.msg.key === 'err.motis_request' || e.msg.key === 'err.motis_geocode' ? 'errNetwork' : 'errGeneric';
  }
  return 'errGeneric';
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = load<string>('lang', '');
    return isLang(saved) ? saved : detectLang(typeof navigator === 'undefined' ? [] : navigator.languages);
  });
  const [theme, setTheme] = useState<Theme>(() => load<Theme>('theme', 'auto'));
  const [profile, setProfile] = useState<Profile>(() => load('profile', defaultProfile));
  const [query, setQuery] = useState<Query>({
    from: { text: '', match: null },
    to: { text: '', match: null },
    date: todayLocal(),
    time: nowHHMM(),
  });
  const [raw, setRaw] = useState<unknown[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrKey | null>(null);
  const [detail, setDetail] = useState('');
  const [sent, setSent] = useState('');
  const [sentDate, setSentDate] = useState('');
  const [left, setLeft] = useState(() => planBudget.remaining());
  const abort = useRef<AbortController | null>(null);
  const [sort, setSort] = useState<Sort>('price');
  const [tab, setTab] = useState<Tab>('all');
  const [onlyFullyPriced, setOnlyFullyPriced] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const t = dict[lang];
  const editProfile = () => {
    setProfileOpen(true);
    document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = dict[lang].pageTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', dict[lang].pageDescription);
    save('lang', lang);
  }, [lang]);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    // inline skrypt w index.html czyta surowy string, więc zapisujemy bez JSON
    try {
      if (theme === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch {
      /* ignoruj */
    }
  }, [theme]);
  useEffect(() => save('profile', profile), [profile]);

  function tryTomorrow() {
    const d = new Date(`${query.date}T12:00`);
    d.setDate(d.getDate() + 1);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setQuery({ ...query, date, time: '06:00' });
    window.setTimeout(() => void runSearch({ date, time: '06:00' }), 0);
  }

  async function runSearch(override?: { date: string; time: string }) {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    setDetail('');
    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const when = new Date(`${override?.date ?? query.date}T${override?.time ?? query.time}`);
      if (Number.isNaN(when.getTime())) throw new RangeError('time');
      if (when.getTime() < Date.now() - 5 * 60_000) throw new RangeError('past');
      // Nie wybrano podpowiedzi? Bierzemy pierwszy wynik geokodowania wpisanego tekstu.
      const resolve = async (p: Query['from']): Promise<GeocodeSuggestion | null> => {
        if (p.match) return p.match;
        if (p.text.trim().length < 2) return null;
        return (await suggest(p.text, ctrl.signal))[0] ?? null;
      };
      const [from, to] = [await resolve(query.from), await resolve(query.to)];
      if (!from || !to) throw new RangeError('place');
      setQuery((q) => ({ ...q, from: { text: from.name, match: from }, to: { text: to.name, match: to } }));
      const itineraries = await searchRoutes(from, to, when.toISOString(), ctrl.signal);
      if (ctrl.signal.aborted) return;
      console.info('[search] itineraries from Transitous:', itineraries.length);
      setRaw(itineraries);
      setSent(`${from.name} → ${to.name}, ${override?.date ?? query.date} ${override?.time ?? query.time}`);
      setSentDate(override?.date ?? query.date);
      if (itineraries.length === 0) console.warn('[search] empty itineraries for', from.lat, from.lon, to.lat, to.lon, when.toISOString());
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      console.error('[search] failed', e);
      setRaw(null);
      setDetail(
        e instanceof MotisError
          ? `${e.msg.key}: ${String(e.msg.params['error'] ?? e.msg.params['detail'] ?? '')}`
          : e instanceof Error
            ? `${e.name}: ${e.message}`
            : String(e),
      );
      setError(
        e instanceof RangeError ? (e.message === 'time' ? 'errTime' : e.message === 'past' ? 'errPast' : 'errPlace') : errorKey(e),
      );
    } finally {
      if (abort.current === ctrl) setBusy(false);
      setLeft(planBudget.remaining());
    }
  }

  const allResults = useMemo(() => {
    try {
      return raw ? buildResults(raw, profile, sentDate || undefined) : [];
    } catch (e) {
      console.error('buildResults failed', e);
      return [];
    }
  }, [raw, profile, sentDate]);

  const fullyPricedCount = useMemo(
    () => allResults.filter((it) => !it.partial && !it.noPrice).length,
    [allResults],
  );

  const results = useMemo(() => {
    const list = onlyFullyPriced
      ? allResults.filter((it) => !it.partial && !it.noPrice)
      : [...allResults];

    list.sort((a, b) => {
      if (tab === 'fastest') {
        if (a.tag === 'fastest' && b.tag !== 'fastest') return -1;
        if (b.tag === 'fastest' && a.tag !== 'fastest') return 1;
        return a.durationMin - b.durationMin || a.totalPln - b.totalPln;
      }
      if (tab === 'cheapest') {
        if (a.tag === 'cheapest' && b.tag !== 'cheapest') return -1;
        if (b.tag === 'cheapest' && a.tag !== 'cheapest') return 1;
        return comparePrice(a, b);
      }
      if (tab === 'safest') {
        if (a.tag === 'safest' && b.tag !== 'safest') return -1;
        if (b.tag === 'safest' && a.tag !== 'safest') return 1;
        const tightCount = (x: typeof a) => x.transfers.filter((t) => t.risk === 'tight').length;
        if (tightCount(a) !== tightCount(b)) return tightCount(a) - tightCount(b);
        if (a.transfers.length !== b.transfers.length) return a.transfers.length - b.transfers.length;
        return a.durationMin - b.durationMin;
      }
      // tab === 'all'
      if (sort === 'price') {
        return comparePrice(a, b);
      }
      return a.durationMin - b.durationMin;
    });

    return list;
  }, [allResults, onlyFullyPriced, tab, sort]);

  const showForeignWarn = profile.status !== 'none' && profile.idCountry === 'pl';

  return (
    <>
      <a class="skip" href="#results">
        {t.skip}
      </a>
      <header class="topbar">
        <h1>
          <span class="full">{t.title}</span>
          <span class="short" aria-hidden="true">PL ↔ DE</span>
        </h1>
        <div class="controls">
          <label class="compact">
            <span class="sr">{t.lang}</span>
            <select value={lang} onChange={(e) => setLang(e.currentTarget.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l} value={l} lang={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
          <label class="compact">
            <span class="sr">{t.theme}</span>
            <select value={theme} onChange={(e) => setTheme(e.currentTarget.value as Theme)}>
              <option value="auto">{t.themeAuto}</option>
              <option value="light">{t.themeLight}</option>
              <option value="dark">{t.themeDark}</option>
            </select>
          </label>
        </div>
      </header>

      <div class="demo" role="note">
        {t.demo}
      </div>

      <main class="layout">
        <aside class="side">
          <SearchPanel
            t={t}
            query={query}
            profile={profile}
            onQuery={setQuery}
            onProfile={setProfile}
            onSearch={() => void runSearch()}
            busy={busy}
            profileOpen={profileOpen}
            onProfileOpen={setProfileOpen}
          />
        </aside>

        <section id="results" class="results" aria-live="polite">
          {error && (
            <p class="error" role="alert">
              {t[error]} <small class="muted">({detail})</small>
            </p>
          )}
          {!raw ? (
            !error && <p class="muted">{busy ? t.searching : t.empty}</p>
          ) : allResults.length === 0 ? (
            <div class="muted">
              <p>{t.noResults}</p>
              <p class="small-note">
                {t.queryUsed}: {sent} ({t.fromApi(raw.length)})
              </p>
              <button type="button" class="link-btn" onClick={tryTomorrow}>
                {t.tryTomorrow}
              </button>
            </div>
          ) : (
            <>
              <div class="results-head">
                <h2>
                  {t.results} <span class="muted">· {t.resultsCount(results.length)}</span>
                </h2>
              </div>

              <div class="tabs-seg" role="tablist" aria-label={t.results}>
                {(['all', 'fastest', 'cheapest', 'safest'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    class={`tab-btn ${tab === id ? 'active' : ''}`}
                    onClick={() => setTab(id)}
                  >
                    {t[`tab_${id}` as keyof Dict] as string}
                  </button>
                ))}
              </div>

              <div class="filter-bar">
                <label class="filter-toggle">
                  <input
                    type="checkbox"
                    checked={onlyFullyPriced}
                    onChange={(e) => setOnlyFullyPriced(e.currentTarget.checked)}
                  />
                  <span>{t.filter_confirmed_only}</span>
                  <span class={`filter-count ${fullyPricedCount > 0 ? 'has-items' : ''}`}>
                    {fullyPricedCount}
                  </span>
                </label>
                {tab === 'all' && (
                  <div class="seg small" role="radiogroup" aria-label={t.sort}>
                    {(['price', 'time'] as const).map((s) => (
                      <label key={s} class={sort === s ? 'on' : ''}>
                        <input type="radio" name="sort" checked={sort === s} onChange={() => setSort(s)} />
                        {s === 'price' ? t.sort_price : t.sort_time}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <ActiveSettings t={t} profile={profile} onChange={editProfile} />
              {showForeignWarn && (
                <p class="callout">
                  <b>{t.warnTitle}:</b> {t.warnText}
                </p>
              )}
              <p class="muted small-note">{t.priceNote}</p>
              {(tab === 'cheapest' || (tab === 'all' && sort === 'price')) && <p class="muted small-note">{t.sortHintPrice}</p>}

              {results.some((it) => it.otherDay) && (
                <p class="callout" role="status">
                  <b>{t.otherDayTitle}</b> {t.otherDayHint}
                </p>
              )}
              {results.length === 0 ? (
                <div class="muted">
                  <p>{t.filter_no_results}</p>
                  <button type="button" class="link-btn" onClick={() => setOnlyFullyPriced(false)}>
                    {t.tab_all} ({allResults.length})
                  </button>
                </div>
              ) : (
                results.map((it) => (
                  <ResultCard key={it.id} it={it} t={t} lang={lang} />
                ))
              )}
            </>
          )}
          <p class="muted small-note">{t.budgetLeft(left)}</p>
        </section>
      </main>

      <footer class="foot">
        <p>{t.footerAttr}</p>
        <p>
          <a href="transitous-proto.html">{t.footerLive}</a> ·{' '}
          <a href="https://github.com/TechniKsawery/multimodal-journey-fare-planner/blob/main/DATA_SOURCES.md" rel="noopener noreferrer">
            {t.footerSources}
          </a>
        </p>
      </footer>
    </>
  );
}
