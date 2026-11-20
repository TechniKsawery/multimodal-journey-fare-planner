// Runtime validation of a discount profile coming from an untrusted place (localStorage, URL, shared link).
// No dependencies: unknown keys are dropped, wrong types are rejected, so a tampered value can never
// reach the price calculators as something they do not expect.
import { defaultProfile, type DiscountProfile } from "./model";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

const BOOLEAN_FIELDS = Object.entries(defaultProfile())
  .filter(([, v]) => typeof v === "boolean")
  .map(([k]) => k as keyof DiscountProfile);

const MAX_STRING = 64;

export function parseDiscountProfile(input: unknown): DiscountProfile {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ProfileError("profile must be an object");
  }
  const src = input as Record<string, unknown>;
  const out = defaultProfile();

  for (const key of BOOLEAN_FIELDS) {
    if (!Object.hasOwn(src, key)) continue;
    if (typeof src[key] !== "boolean") throw new ProfileError(`${key} must be a boolean`);
    (out as unknown as Record<string, unknown>)[key] = src[key];
  }
  for (const key of ["pkp_ulga_kod", "bahncard", "obywatelstwo"] as const) {
    if (!Object.hasOwn(src, key) || src[key] === null || src[key] === undefined) continue;
    const v = src[key];
    if (typeof v !== "string" || v.length > MAX_STRING) throw new ProfileError(`${key} must be a short string`);
    (out as unknown as Record<string, unknown>)[key] = v;
  }
  if (Object.hasOwn(src, "age") && src["age"] !== null && src["age"] !== undefined) {
    const age = src["age"];
    if (typeof age !== "number" || !Number.isInteger(age) || age < 0 || age > 130) {
      throw new ProfileError("age must be an integer between 0 and 130");
    }
    out.age = age;
  }
  return out;
}
