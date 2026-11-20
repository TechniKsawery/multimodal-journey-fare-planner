import { Component, type ComponentChildren } from 'preact';
import { dict, detectLang, isLang } from './i18n';

function currentDict() {
  let l = '';
  try {
    l = JSON.parse(localStorage.getItem('lang') ?? '""');
  } catch {
    /* ignore */
  }
  return dict[isLang(l) ? l : detectLang(navigator.languages)];
}

/** Last line of defence: a render crash must show a message (and a console log), never a frozen page. */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { err: string | null }> {
  state = { err: null as string | null };
  componentDidCatch(e: unknown) {
    console.error('render crash', e);
    this.setState({ err: e instanceof Error ? e.message : String(e) });
  }
  render() {
    if (this.state.err === null) return this.props.children;
    const d = currentDict();
    return (
      <div class="error" role="alert">
        <p>{d.appError}: {this.state.err}</p>
        <button type="button" onClick={() => location.reload()}>
          {d.reload}
        </button>
      </div>
    );
  }
}
