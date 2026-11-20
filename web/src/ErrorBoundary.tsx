import { Component, type ComponentChildren } from 'preact';

/** Last line of defence: a render crash must show a message (and a console log), never a frozen page. */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { err: string | null }> {
  state = { err: null as string | null };
  componentDidCatch(e: unknown) {
    console.error('render crash', e);
    this.setState({ err: e instanceof Error ? e.message : String(e) });
  }
  render() {
    if (this.state.err === null) return this.props.children;
    return (
      <div class="error" role="alert">
        <p>Wystąpił błąd aplikacji / Application error: {this.state.err}</p>
        <button type="button" onClick={() => location.reload()}>
          Odśwież / Reload
        </button>
      </div>
    );
  }
}
