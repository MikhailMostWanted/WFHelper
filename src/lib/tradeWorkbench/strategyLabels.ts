import type { MessageKey } from "../i18n.js";
import type { WorkbenchStrategyId } from "./pricingStrategies.js";

export const STRATEGY_KEYS: Record<WorkbenchStrategyId, MessageKey> = {
  "match-cheapest": "workbench.strategy.match-cheapest",
  "cheapest-minus-one": "workbench.strategy.cheapest-minus-one",
  "percent-offset": "workbench.strategy.percent-offset",
  "bounded-cheapest-average": "workbench.strategy.bounded-cheapest-average",
  "target-margin": "workbench.strategy.target-margin",
  manual: "workbench.strategy.manual",
};
