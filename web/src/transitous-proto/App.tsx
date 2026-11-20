import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type Lang, type MsgKey, detectLang, t } from "./i18n";
import {
  BudgetExceededError,
  type GeocodeMatch,
  type Itinerary,
  TransitousClient,
  TransitousError,
  placeArg,
} from "../transitous";

const REPO_URL = "https://github.com/TechniKsawery/multimodal-journey-fare-planner";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function PlaceInput(props: {
  label: string;
  lang: Lang;
  client: TransitousClient;
  value: GeocodeMatch | null;
  onPick: (m: GeocodeMatch | null) => void;
  pickText: string;
}) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<GeocodeMatch[]>([]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (text.trim().length < 3 || props.value?.name === text) {
      setOptions([]);
      return;
    }
    const ctrl = new AbortController();
    // Debounce: do not hammer the public geocoder while the user is typing.
    timer.current = window.setTimeout(() => {
      props.client
        .geocode(text.trim(), props.lang, ctrl.signal)
        .then((r) => setOptions(r.slice(0, 6)))
        .catch(() => setOptions([]));
    }, 400);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer.current);
    };
  }, [text]);

  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        value={text}
        placeholder={props.pickText}
        onInput={(e) => {
          setText((e.target as HTMLInputElement).value);
          props.onPick(null);
        }}
      />
      {options.length > 0 && (
        <ul class="options">
          {options.map((o) => (
            <li key={`${o.id ?? ""}${o.lat}${o.lon}`}>
              <button
                type="button"
                onClick={() => {
                  setText(o.name);
                  setOptions([]);
                  props.onPick(o);
                }}
              >
                {o.name}
                <small>{[o.type, o.areas?.[0]?.name].filter(Boolean).join(" · ")}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang());
  const client = useMemo(() => new TransitousClient(), []);
  const tr = (k: MsgKey) => t(lang, k);
  const [from, setFrom] = useState<GeocodeMatch | null>(null);
  const [to, setTo] = useState<GeocodeMatch | null>(null);
  const [when, setWhen] = useState(() => new Date(Date.now() + 86400_000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MsgKey | null>(null);
  const [results, setResults] = useState<Itinerary[] | null>(null);
  const [left, setLeft] = useState(client.budget.remaining());

  async function search(e: Event) {
    e.preventDefault();
    if (!from || !to) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.plan({
        from: placeArg(from),
        to: placeArg(to),
        time: new Date(when).toISOString(),
      });
      setResults(r.itineraries);
    } catch (err) {
      setResults(null);
      if (err instanceof BudgetExceededError) setError("errBudget");
      else if (err instanceof TransitousError) setError("errBusy");
      else setError("errGeneric");
    } finally {
      setBusy(false);
      setLeft(client.budget.remaining());
    }
  }

  return (
    <main>
      <header>
        <h1>{tr("title")}</h1>
        <button class="lang" onClick={() => setLang(lang === "en" ? "pl" : "en")}>
          {lang === "en" ? "PL" : "EN"}
        </button>
      </header>
      <p>{tr("tagline")}</p>
      <form onSubmit={search}>
        <PlaceInput label={tr("from")} lang={lang} client={client} value={from} onPick={setFrom} pickText={tr("pick")} />
        <PlaceInput label={tr("to")} lang={lang} client={client} value={to} onPick={setTo} pickText={tr("pick")} />
        <label class="field">
          <span>{tr("when")}</span>
          <input type="datetime-local" value={when} onInput={(e) => setWhen((e.target as HTMLInputElement).value)} />
        </label>
        <button type="submit" disabled={busy || !from || !to}>
          {busy ? tr("searching") : tr("search")}
        </button>
        <small>
          {tr("budgetLeft")}: {left}
        </small>
      </form>

      {error && <p class="error">{tr(error)}</p>}
      {results && results.length === 0 && <p>{tr("noResults")}</p>}
      {results && results.length > 0 && <p class="note">{tr("priceNote")}</p>}
      <ol class="results">
        {results?.map((it, i) => (
          <li key={i}>
            <strong>
              {fmtTime(it.startTime)} → {fmtTime(it.endTime)}
            </strong>{" "}
            · {fmtDuration(it.duration)} · {it.transfers} {tr("transfers")}
            <div class="legs">
              {it.legs
                .filter((l) => l.mode !== "WALK")
                .map((l, j) => (
                  <span class="leg" key={j}>
                    {l.agencyName ?? l.mode} {l.routeShortName ?? ""}
                  </span>
                ))}
            </div>
          </li>
        ))}
      </ol>

      <footer>
        <p>{tr("disclaimer")}</p>
        <p>
          {tr("attribution")} · <a href="https://transitous.org/sources/">Transitous sources</a> ·{" "}
          <a href={`${REPO_URL}/blob/main/DATA_SOURCES.md`}>{tr("sources")}</a> ·{" "}
          <a href={`${REPO_URL}/issues`}>{tr("contact")}</a>
        </p>
      </footer>
    </main>
  );
}
