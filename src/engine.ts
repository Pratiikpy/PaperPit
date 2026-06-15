// PaperPit engine: routes orders to quote- or depth-fills, applies them to accounts, rests limit
// orders and settles them on new quotes, applies funding, and marks positions to market.
import type { Fill, MarketQuote, Order } from "./types";
import { Account, type FeeConfig, DEFAULT_FEES } from "./account";
import { quoteFill, depthFill, DEFAULT_FILL, type FillModelConfig } from "./fills";

export class PaperPit {
  accounts = new Map<string, Account>();
  fills: Fill[] = [];
  pending: Order[] = [];
  private fillCfg: FillModelConfig;
  private fees: FeeConfig;

  constructor(opts: { fillCfg?: FillModelConfig; fees?: FeeConfig } = {}) {
    this.fillCfg = opts.fillCfg ?? DEFAULT_FILL;
    this.fees = opts.fees ?? DEFAULT_FEES;
  }

  createAccount(id: string, cash: number): Account {
    const a = new Account(id, cash, this.fees);
    this.accounts.set(id, a);
    return a;
  }

  private reject(o: Order, reason: string): Fill {
    const f: Fill = {
      orderId: o.id,
      accountId: o.accountId,
      symbol: o.symbol,
      kind: o.kind,
      side: o.side,
      qty: 0,
      avgPrice: null,
      feePaid: 0,
      slippagePct: 0,
      ts: o.ts,
      status: "rejected",
      reason,
    };
    this.fills.push(f);
    return f;
  }

  private execute(o: Order, q: MarketQuote, priceCap?: number): Fill {
    const acct = this.accounts.get(o.accountId);
    if (!acct) return this.reject(o, "no such account");

    const useDepth = o.kind === "perp" && q.book && q.book.bids.length > 0 && q.book.asks.length > 0;
    const res = useDepth ? depthFill(o.side, o.qty, q.book!) : quoteFill(o.side, o.qty, q, this.fillCfg);
    if (res.avgPrice == null || res.fillQty <= 0) return this.reject(o, "no liquidity");

    let price = res.avgPrice;
    if (priceCap != null) {
      // limit protection: never fill worse than the limit price
      price = o.side === "buy" ? Math.min(price, priceCap) : Math.max(price, priceCap);
    }

    const fee =
      o.kind === "spot"
        ? acct.applySpotFill(o.symbol, o.side, res.fillQty, price)
        : acct.applyPerpFill(o.symbol, o.side, res.fillQty, price, o.leverage ?? 1);

    const f: Fill = {
      orderId: o.id,
      accountId: o.accountId,
      symbol: o.symbol,
      kind: o.kind,
      side: o.side,
      qty: res.fillQty,
      avgPrice: price,
      feePaid: fee,
      slippagePct: res.slippagePct,
      ts: o.ts,
      status: res.fillQty >= o.qty - 1e-12 ? "filled" : "partial",
    };
    this.fills.push(f);
    return f;
  }

  /** Submit an order against the current market quote for its symbol. */
  submit(o: Order, q: MarketQuote): Fill {
    if (o.type === "market") return this.execute(o, q);
    const touch = o.side === "buy" ? q.ask : q.bid;
    const marketable =
      touch != null && o.limitPrice != null && (o.side === "buy" ? touch <= o.limitPrice : touch >= o.limitPrice);
    if (marketable) return this.execute(o, q, o.limitPrice);
    // rest it for later quotes
    this.pending.push(o);
    return {
      orderId: o.id,
      accountId: o.accountId,
      symbol: o.symbol,
      kind: o.kind,
      side: o.side,
      qty: 0,
      avgPrice: null,
      feePaid: 0,
      slippagePct: 0,
      ts: o.ts,
      status: "pending",
    };
  }

  /** Feed fresh quotes: settle any marketable resting limit orders. Returns the new fills. */
  onMarket(quotes: Map<string, MarketQuote>): Fill[] {
    const stillPending: Order[] = [];
    const newFills: Fill[] = [];
    for (const o of this.pending) {
      const q = quotes.get(o.symbol);
      const touch = q ? (o.side === "buy" ? q.ask : q.bid) : null;
      const marketable =
        q && touch != null && o.limitPrice != null && (o.side === "buy" ? touch <= o.limitPrice : touch >= o.limitPrice);
      if (marketable) newFills.push(this.execute(o, q!, o.limitPrice));
      else stillPending.push(o);
    }
    this.pending = stillPending;
    return newFills;
  }

  /** Apply funding to every open perp position from the quotes' fundingRate. */
  applyFunding(quotes: Map<string, MarketQuote>): void {
    for (const acct of this.accounts.values()) {
      for (const [symbol, pos] of acct.perp) {
        const q = quotes.get(symbol);
        if (q?.fundingRate != null && q.last != null && pos.qty !== 0) {
          acct.applyFunding(symbol, q.fundingRate, q.last);
        }
      }
    }
  }

  /** Mark map (symbol → mark price) from a set of quotes — last, else mid. */
  marksFrom(quotes: Map<string, MarketQuote>): Map<string, number> {
    const marks = new Map<string, number>();
    for (const [sym, q] of quotes) {
      const m = q.last ?? (q.bid != null && q.ask != null ? (q.bid + q.ask) / 2 : null);
      if (m != null) marks.set(sym, m);
    }
    return marks;
  }
}
