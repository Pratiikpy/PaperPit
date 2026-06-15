// PaperPit — public API.
export const VERSION = "0.1.0";

export { PaperPit } from "./engine";
export { Account, DEFAULT_FEES, type FeeConfig, type SpotPosition, type PerpPosition } from "./account";
export { quoteFill, depthFill, DEFAULT_FILL, type FillModelConfig, type QuoteResult } from "./fills";
export { parseFrames, loadFrames, quotesOf, type Frame } from "./replay";
export type { Order, Fill, MarketQuote, Side, OrderType, InstrumentKind, FillStatus } from "./types";
