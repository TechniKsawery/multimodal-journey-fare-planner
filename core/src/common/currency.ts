// Port of common/currency.py: fixed rates to PLN, used ONLY to compare variants (never to bill).
// The EUR rate was checked against the NBP table A mid rate on 2026-10-09: 4.3775. A new currency
// needs a rate from a source (e.g. NBP table A) with a verification date.
import { ValueError, pyRepr } from "../pyCompat";

export const PLACEHOLDER_RATES_TO_PLN: Readonly<Record<string, number>> = { PLN: 1.0, EUR: 4.3775 };

export const SUPPORTED_CURRENCIES: readonly string[] = Object.keys(PLACEHOLDER_RATES_TO_PLN).sort();

export class UnsupportedCurrencyError extends ValueError {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedCurrencyError";
  }
}

export function normalizeCurrency(currency: string): string {
  const code = String(currency).trim().toUpperCase();
  if (!Object.hasOwn(PLACEHOLDER_RATES_TO_PLN, code)) {
    throw new UnsupportedCurrencyError(
      `Nieobsługiwana waluta ${pyRepr(String(currency))} — obsługiwane: ${SUPPORTED_CURRENCIES.join(", ")}. ` +
        "Nie zgadujemy kursów; nowa waluta wymaga kursu ze źródła (np. tabela A NBP) " +
        "z datą weryfikacji w common/currency.py.",
    );
  }
  return code;
}

const rate = (currency: string): number => PLACEHOLDER_RATES_TO_PLN[normalizeCurrency(currency)];

export const toPln = (amount: number, currency: string): number => amount * rate(currency);

export function convert(amount: number, fromCurrency: string, toCurrency: string): number {
  if (normalizeCurrency(fromCurrency) === normalizeCurrency(toCurrency)) return amount;
  return toPln(amount, fromCurrency) / rate(toCurrency);
}
