import { expect, it } from "vitest";
import { detectLang, t } from "./i18n";

it("defaults to English, picks Polish for pl-*", () => {
  expect(detectLang({ language: "de-DE" })).toBe("en");
  expect(detectLang({ language: "pl-PL" })).toBe("pl");
  expect(detectLang(undefined)).toBe("en");
});
it("has the same keys in both languages", () => {
  expect(t("en", "search")).toBe("Search");
  expect(t("pl", "search")).toBe("Szukaj");
});
