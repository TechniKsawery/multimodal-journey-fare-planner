// Port of attractions/model.py: attractions, group prices, city cards and their evaluation.
// Field names stay snake_case (same keys as the Python oracle and the JSON data).

export const AttractionCategory = {
  SPORT: "sport",
  CULTURE: "turystyka_kultura",
  ENTERTAINMENT: "rozrywka",
  GASTRONOMY: "gastronomia",
  NATURE: "natura",
} as const;
export type AttractionCategory = (typeof AttractionCategory)[keyof typeof AttractionCategory];

export const CATEGORY_LABELS: Readonly<Record<AttractionCategory, string>> = {
  sport: "⚽ Sport i stadiony",
  turystyka_kultura: "🏛️ Turystyka i zabytki",
  rozrywka: "🎡 Rozrywka i punkty widokowe",
  gastronomia: "🍕 Gastronomia i kultowe smaki",
  natura: "🌳 Natura i parki",
};

/** One document/status that actually entitles the person to a discount (a person may hold several). */
export interface HeldDocument {
  doc_type: string; // e.g. "legitymacja_szkolna", "legitymacja_studencka", "ISIC", "karta_seniora"
  issuing_country: string; // ISO 3166-1 alpha-2
}

/** A concrete price for one discount title: never a percentage, always an amount from the operator's price list. */
export interface GroupPrice {
  price: number;
  label: string;
  min_age: number | null;
  max_age: number | null;
  requires_status: string;
  source_url: string;
  verified_date: string;
  price_verified: boolean; // false = not confirmed at an official source
  /** ISO codes the operator explicitly restricts this discount to; null = the source says nothing. */
  recognized_countries: string[] | null;
}

/** Source of a stored city-card discount. A discount > 0% counts ONLY with a complete source. */
export interface DiscountSource {
  source_url: string;
  verified_date: string;
}

export const isCompleteSource = (s: DiscountSource): boolean => s.source_url.trim() !== "" && s.verified_date.trim() !== "";

export interface Attraction {
  id: string;
  name: string;
  city: string;
  category: AttractionCategory;
  description: string;
  normal_price: number;
  currency: string;
  default_card_discount_percent: number;
  card_discount_source: DiscountSource | null;
  address: string;
  official_url: string;
  highlight: boolean;
  tags: string[];
  price_verified: boolean;
  child_price: GroupPrice | null;
  student_price: GroupPrice | null;
  senior_price: GroupPrice | null;
  family_price: GroupPrice | null;
  /** normal_price is a "from" price (many variants or dynamic prices). */
  price_is_from: boolean;
  /** Prices vary by date/time: no fixed discount amount, so discounts are never guessed. */
  dynamic_pricing: boolean;
  variable_pricing_note: string;
  /** End of a temporary closure (YYYY-MM-DD); closed attractions are hidden until that date passes. */
  closed_until: string;
  closed_source_url: string;
}

export interface CityCardVariant {
  id: string;
  name: string;
  duration_hours: number;
  price: number;
  currency: string;
  includes_public_transit: boolean;
  transit_zones: string;
  description: string;
  price_verified: boolean;
}

export interface CityCard {
  id: string;
  city: string;
  name: string;
  description: string;
  official_url: string;
  variants: CityCardVariant[];
  /** attraction id -> percent. No entry anywhere = no discount (there is no default discount). */
  custom_discounts: Record<string, number>;
  custom_discount_sources: Record<string, DiscountSource>;
  /** Confirmed (at a source, with a date) that the card exists and works TODAY. */
  existence_verified: boolean;
  existence_source_url: string;
  existence_verified_date: string;
}

export interface CityCardEvaluation {
  card_name: string;
  variant: CityCardVariant;
  attractions_count: number;
  attractions_price_without_card: number;
  attractions_price_with_card: number;
  card_price: number;
  estimated_transit_savings: number;
  total_cost_without_card: number;
  total_cost_with_card: number;
  net_savings: number;
  currency: string;
  is_recommended: boolean;
  summary: string;
  unverified_discount_attraction_ids: string[];
}
