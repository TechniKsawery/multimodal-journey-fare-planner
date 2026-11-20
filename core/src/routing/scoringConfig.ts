// Port of routing/scoring_config.py: penalties for "best price/time" (ESTIMATES, to be tuned).
// "Cheapest" and "fastest" do not use them.
export const VALUE_OF_TIME_PLN_PER_HOUR = 40; // what one hour of travel is worth (weight of time vs. price)
export const RISKY_TRANSFER_PENALTY_MIN = 60; // added to time for every risky transfer
export const RISKY_TRANSFER_PENALTY_PLN = 50; // added to price for every risky transfer
export const EXTRA_CARRIER_PENALTY_MIN = 20; // per additional carrier (separate ticket, connection risk)
export const EXTRA_CARRIER_PENALTY_PLN = 30;
