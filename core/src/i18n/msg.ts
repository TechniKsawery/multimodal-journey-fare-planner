// Counterpart of i18n.Msg: a message key plus parameters. Rendering (6 languages) is in ./index.ts.
export interface Msg {
  key: string;
  params: Record<string, unknown>;
}

/** Text produced by domain code: a translatable message or a plain string that stays as it is. */
export type Text = string | Msg;

export const msg = (key: string, params: Record<string, unknown> = {}): Msg => ({ key, params });

export const isMsg = (v: unknown): v is Msg =>
  typeof v === "object" && v !== null && typeof (v as Msg).key === "string" && typeof (v as Msg).params === "object" && (v as Msg).params !== null;

/** A list rendered as one text with a separator (i18n.Joined): a Msg parameter. */
export interface Joined {
  joined: unknown[];
  sep: string;
}
export const joined = (items: Iterable<unknown>, sep = ", "): Joined => ({ joined: [...items], sep });
export const isJoined = (v: unknown): v is Joined => typeof v === "object" && v !== null && Array.isArray((v as Joined).joined) && typeof (v as Joined).sep === "string";

/**
 * A Python float that must print with its ".0" (JS numbers cannot tell 5.0 from 5): use for message
 * parameters that are floats in the oracle, e.g. `pyFloat(5)` renders "5.0".
 */
export interface PyFloat {
  pyfloat: number;
}
export const pyFloat = (value: number): PyFloat => ({ pyfloat: value });
export const isPyFloat = (v: unknown): v is PyFloat => typeof v === "object" && v !== null && typeof (v as PyFloat).pyfloat === "number";
