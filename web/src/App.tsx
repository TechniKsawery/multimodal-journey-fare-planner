import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dict, type Lang } from './i18n';
import { load, save } from './storage';
import type { Profile } from './types';
import { ResultCard } from './components/ResultCard';
import { ActiveSettings } from './components/ActiveSettings';
import { SearchPanel, type Query } from './components/SearchPanel';
import { BudgetExceededError, TransitousClient, TransitousError, placeArg, type GeocodeMatch } from './transitous';
import { buildResults } from './search/adapt';

type Theme = 'auto' | 'light' | 'dark';
type Sort = 'price' | 'time';

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
  if (e instanceof TransitousError) {
    if (e.status === 429) return 'errBusy';
    // brak statusu = fetch odrzucony (offline, CORS, blokada sieci)
    return e.status === undefined && /contacting/.test(e.message) ? 'errNetwork' : 'errGeneric';
  }
  return 'errGeneric';
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => load<Lang>('lang', 'pl'));
  const [theme, setTheme] = useState<Theme>(() => load<Theme>('theme', 'auto'));
  const [profile, setProfile] = useState<Profile>(() => load('profile', defaultProfile));
  const client = useMemo(() => new TransitousClient(), []);
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
  const [left, setLeft] = useState(() => client.budget.remaining());
  const abort = useRef<AbortController | null>(null);
  const [sort, setSort] = useState<Sort>('price');
  const [profileOpen, setProfileOpen] = useState(false);
  const t = dict[lang];
  const editProfile = () => {
    setProfileOpen(true);
    document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    document.documentElement.lang = lang;
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
      const resolve = async (p: Query['from']): Promise<GeocodeMatch | null> => {
        if (p.match) return p.match;
        if (p.text.trim().length < 2) return null;
        return (await client.geocode(p.text, lang, ctrl.signal))[0] ?? null;
      };
      const [from, to] = [await resolve(query.from), await resolve(query.to)];
      if (!from || !to) throw new RangeError('place');
      setQuery((q) => ({ ...q, from: { text: from.name, match: from }, to: { text: to.name, match: to } }));
      const r = await client.plan({ from: placeArg(from), to: placeArg(to), time: when.toISOString() }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      console.info('[search] itineraries from Transitous:', r.itineraries.length);
      setRaw(r.itineraries.slice(0, 20));
      setSent(`${from.name} → ${to.name}, ${query.date} ${query.time}`);
      if (r.itineraries.length === 0) console.warn('[search] empty itineraries for', placeArg(from), placeArg(to), when.toISOString());
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      console.error('[search] failed', e);
      setRaw(null);
      setDetail(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setError(
        e instanceof RangeError ? (e.message === 'time' ? 'errTime' : e.message === 'past' ? 'errPast' : 'errPlace') : errorKey(e),
      );
    } finally {
      if (abort.current === ctrl) setBusy(false);
      setLeft(client.budget.remaining());
    }
  }

  const results = useMemo(() => {
    let list: ReturnType<typeof buildResults> = [];
    try {
      list = raw ? buildResults(raw, profile) : [];
    } catch (e) {
      console.error('buildResults failed', e);
    }
    // Warianty bez pełnej ceny nie mogą wygrywać rankingu ceny: idą na koniec.
    list.sort((a, b) => {
      if (sort === 'price') {
        if (!!a.noPrice !== !!b.noPrice) return a.noPrice ? 1 : -1;
        // fully priced first, then the better price coverage, then the lower (partial) sum
        const cov = (x: typeof a) => (x.partial ? (x.pricedLegs ?? 0) / Math.max(x.totalLegs ?? 1, 1) : 2);
        if (cov(a) !== cov(b)) return cov(b) - cov(a);
        return a.totalPln - b.totalPln || a.durationMin - b.durationMin;
      }
      return a.durationMin - b.durationMin;
    });
    return list;
  }, [raw, profile, sort]);

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
              <option value="pl">PL</option>
              <option value="en">EN</option>
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
            lang={lang}
            client={client}
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
          ) : results.length === 0 ? (
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
                <div class="seg small" role="radiogroup" aria-label={t.sort}>
                  {(['price', 'time'] as const).map((s) => (
                    <label class={sort === s ? 'on' : ''}>
                      <input type="radio" name="sort" checked={sort === s} onChange={() => setSort(s)} />
                      {s === 'price' ? t.sort_price : t.sort_time}
                    </label>
                  ))}
                </div>
              </div>
              <ActiveSettings t={t} profile={profile} onChange={editProfile} />
              {showForeignWarn && (
                <p class="callout">
                  <b>{t.warnTitle}:</b> {t.warnText}
                </p>
              )}
              <p class="muted small-note">{t.priceNote}</p>
              {results.map((it) => (
                <ResultCard key={it.id} it={it} t={t} lang={lang} />
              ))}
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
