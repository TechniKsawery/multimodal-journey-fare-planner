// Validates data/**/*.json against data/schemas/*.schema.json (JSON Schema 2020-12).
// Errors fail CI. Warnings (e.g. a verification date that is null) are listed but do not fail:
// they are the "data debt" list for the owner (see plan: no price without source + date).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const targets = [
  ["fares.schema.json", readdirSync(join(root, "fares")).filter((f) => f.endsWith(".json")).map((f) => `fares/${f}`)],
  ["attractions.schema.json", ["attractions/attractions.json"]],
  ["city_cards.schema.json", ["attractions/city_cards.json"]],
  ["airports.schema.json", ["routing/airports.json"]],
  ["place_aliases.schema.json", ["places/aliases.json"]],
  ["cabin_baggage.schema.json", ["flights/cabin_baggage.json"]],
];

let errors = 0;
const warnings = [];
const hasSource = (o) => Object.keys(o).some((k) => /^_?(zrodlo|zrodla|kopia_zrodla)/.test(k) || k === "_zrodlo_raportu");

for (const [schemaFile, files] of targets) {
  const validate = ajv.compile(load(join(root, "schemas", schemaFile)));
  for (const f of files) {
    const data = load(join(root, f));
    if (!validate(data)) {
      errors++;
      for (const e of validate.errors) console.error(`ERROR ${f}${e.instancePath}: ${e.message}`);
    }
    if (schemaFile === "fares.schema.json") {
      if (!hasSource(data)) {
        errors++;
        console.error(`ERROR ${f}: no source key (_zrodlo*/zrodlo_url*) — every fare table must cite its source`);
      }
      for (const k of ["data_weryfikacji", "data_sprawdzenia", "_data_sprawdzenia"]) {
        if (k in data && data[k] === null) warnings.push(`${f}: ${k} is null (unverified)`);
      }
    }
  }
}
// Placeholder data must never look like fact.
const extras = load(join(root, "flights", "extras_placeholder.json"));
if (extras) warnings.push("flights/extras_placeholder.json: PLACEHOLDER data — do not show as fact");

for (const w of warnings) console.warn(`WARN  ${w}`);
console.log(`validate-data: ${errors} error(s), ${warnings.length} warning(s)`);
process.exit(errors ? 1 : 0);
