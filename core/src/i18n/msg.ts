// Minimal counterpart of i18n.Msg: a message key plus parameters. Rendering (6 languages) comes
// with the i18n port; until then callers get the stable key, which is what the oracle's golden
// vectors compare.
export interface Msg {
  key: string;
  params: Record<string, unknown>;
}

export const msg = (key: string, params: Record<string, unknown> = {}): Msg => ({ key, params });
