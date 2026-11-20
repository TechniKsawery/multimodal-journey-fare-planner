// Counterpart of routing.motis_client.MotisError: a failure to talk to the routing service or an
// empty result. The message is an i18n `Msg` (the UI renders it in the selected language).
import { msg, type Msg } from "../i18n/msg";

export class MotisError extends Error {
  readonly msg: Msg;
  constructor(message: Msg) {
    super(message.key);
    this.name = "MotisError";
    this.msg = message;
  }
}

/** The per-search Transitous request budget is spent (see QueryBudget). */
export class BudgetExceededError extends MotisError {
  constructor(limit: number) {
    super(msg("err.transitous_budget", { limit }));
    this.name = "BudgetExceededError";
  }
}
