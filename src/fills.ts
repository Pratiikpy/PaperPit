// Fill models. Pure functions — no state, no I/O.
//
// Two models, because two kinds of markets behave differently:
//   - quoteFill: fills at the touch (ask for a buy, bid for a sell) plus size-aware slippage.
//     Use it when you only have a top-of-book quote — e.g. instruments whose L2 book is thin or
//     intermittently published, where the always-present bid/ask is the honest signal.
//   - depthFill: walks the L2 book level by level for a true VWAP fill. Use it when you have real
//     depth and want price impact modelled, not approximated.
import type { Side, MarketQuote } from "./types";

export interface FillModelConfig {
  baseSlipPct: number; // always-applied slippage (a half-spread proxy)
  impactPct: number; // extra slippage per 1x of reference notional consumed
  refNotional: number; // reference notional (quote currency) the impact scales against
}

export const DEFAULT_FILL: FillModelConfig = { baseSlipPct: 0.0, impactPct: 0.05, refNotional: 5000 };

export interface QuoteResult {
  fillQty: number;
  avgPrice: number | null;
  slippagePct: number;
}

/** Quote-driven fill: touch price plus size-aware slippage. Also the fallback when no book exists. */
export function quoteFill(side: Side, qty: number, q: MarketQuote, cfg: FillModelConfig = DEFAULT_FILL): QuoteResult {
  const touch = side === "buy" ? q.ask : q.bid;
  if (touch == null || touch <= 0 || qty <= 0) return { fillQty: 0, avgPrice: null, slippagePct: 0 };
  const notional = qty * touch;
  const impact = cfg.impactPct * (notional / cfg.refNotional);
  const slippagePct = cfg.baseSlipPct + impact;
  const dir = side === "buy" ? 1 : -1;
  const avgPrice = touch * (1 + dir * (slippagePct / 100));
  return { fillQty: qty, avgPrice, slippagePct };
}

/** Depth-aware VWAP fill: consume L2 levels until filled. Partial fills when the book runs out. */
export function depthFill(
  side: Side,
  qty: number,
  book: { bids: [number, number][]; asks: [number, number][] }
): QuoteResult {
  if (qty <= 0) return { fillQty: 0, avgPrice: null, slippagePct: 0 };
  const levels = side === "buy" ? book.asks : book.bids; // a buy consumes asks, a sell hits bids
  if (!levels || levels.length === 0) return { fillQty: 0, avgPrice: null, slippagePct: 0 };
  let remaining = qty;
  let cost = 0;
  let filled = 0;
  for (const [price, size] of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, size);
    cost += take * price;
    filled += take;
    remaining -= take;
  }
  if (filled === 0) return { fillQty: 0, avgPrice: null, slippagePct: 0 };
  const avgPrice = cost / filled;
  const touch = levels[0]![0];
  const slippagePct = touch > 0 ? ((avgPrice - touch) / touch) * 100 * (side === "buy" ? 1 : -1) : 0;
  return { fillQty: filled, avgPrice, slippagePct };
}
