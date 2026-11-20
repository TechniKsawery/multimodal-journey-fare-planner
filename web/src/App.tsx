import { useEffect, useMemo, useState } from 'preact/hooks';
import { sample } from './data';
import { dict, type Lang } from './i18n';
import { load, save } from './storage';
import type { Profile } from './types';
import { ResultCard } from './components/ResultCard';
import { ActiveSettings } from './components/ActiveSettings';
import { SearchPanel, type Query } from './components/SearchPanel';

type Theme = 'auto' | 'light' | 'dark';
type Sort = 'price' | 'time';

const defaultProfile: Profile = { status: 'student', idCountry: 'pl', age: 21, bahncard: 'none' };
const today = new Date().toISOString().slice(0, 10);

export function App() {
  const [lang, setLang] = useState<Lang>(() => load<Lang>('lang', 'pl'));
  const [theme, setTheme] = useState<Theme>(() => load<Theme>('theme', 'auto'));
  const [profile, setProfile] = useState<Profile>(() => load('profile', defaultProfile));
  const [query, setQuery] = useState<Query>({ from: 'Poznań Główny', to: 'Berlin Alexanderplatz', date: today });
  const [searched, setSearched] = useState(true);
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

  const results = useMemo(() => {
    const list = [...sample];
    // Warianty z sumą częściową (brak części cen) nie mogą wygrywać rankingu ceny: idą na koniec.
    list.sort((a, b) => {
      if (sort === 'price' && !!a.partial !== !!b.partial) return a.partial ? 1 : -1;
      return sort === 'price' ? a.totalPln - b.totalPln : a.durationMin - b.durationMin;
    });
    return list;
  }, [sort]);

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
            onSearch={() => setSearched(true)}
            profileOpen={profileOpen}
            onProfileOpen={setProfileOpen}
          />
        </aside>

        <section id="results" class="results" aria-live="polite">
          {!searched ? (
            <p class="muted">{t.empty}</p>
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
              {results.map((it) => (
                <ResultCard key={it.id} it={it} t={t} lang={lang} />
              ))}
            </>
          )}
        </section>
      </main>
    </>
  );
}
