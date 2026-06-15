// Virtual account: cash, spot units, signed perp positions, realized/unrealized PnL, fees, funding.
// Cash-settled accounting — PnL realizes into cash on close.
import type { Side } from "./types";

export interface SpotPosition {
  units: number; // >= 0
  avgCost: number;
}
export interface PerpPosition {
  qty: number; // signed (+ long, - short)
  entry: number;
  leverage: number;
}
export interface FeeConfig {
  spotTakerPct: number;
  perpTakerPct: number;
}

export const DEFAULT_FEES: FeeConfig = { spotTakerPct: 0.1, perpTakerPct: 0.06 };

export class Account {
  readonly id: string;
  cash: number;
  readonly startCash: number;
  spot = new Map<string, SpotPosition>();
  perp = new Map<string, PerpPosition>();
  realizedPnl = 0;
  feesPaid = 0;
  fundingPaid = 0;
  fees: FeeConfig;

  constructor(id: string, cash: number, fees: FeeConfig = DEFAULT_FEES) {
    this.id = id;
    this.cash = cash;
    this.startCash = cash;
    this.fees = fees;
  }

  applySpotFill(symbol: string, side: Side, qty: number, price: number): number {
    const fee = qty * price * (this.fees.spotTakerPct / 100);
    this.feesPaid += fee;
    const pos = this.spot.get(symbol) ?? { units: 0, avgCost: 0 };
    if (side === "buy") {
      this.cash -= qty * price + fee;
      const newUnits = pos.units + qty;
      pos.avgCost = newUnits > 0 ? (pos.units * pos.avgCost + qty * price) / newUnits : 0;
      pos.units = newUnits;
    } else {
      this.cash += qty * price - fee;
      this.realizedPnl += qty * (price - pos.avgCost) - fee;
      pos.units -= qty;
      if (pos.units <= 1e-12) {
        pos.units = 0;
        pos.avgCost = 0;
      }
    }
    this.spot.set(symbol, pos);
    return fee;
  }

  applyPerpFill(symbol: string, side: Side, qty: number, price: number, leverage = 1): number {
    const fee = qty * price * (this.fees.perpTakerPct / 100);
    this.feesPaid += fee;
    this.cash -= fee;
    const signed = side === "buy" ? qty : -qty;
    const pos = this.perp.get(symbol) ?? { qty: 0, entry: 0, leverage };
    const sameDir = (pos.qty >= 0 && signed > 0) || (pos.qty <= 0 && signed < 0);
    if (pos.qty === 0 || sameDir) {
      const newQty = pos.qty + signed;
      pos.entry = newQty !== 0 ? (pos.qty * pos.entry + signed * price) / newQty : 0;
      pos.qty = newQty;
      pos.leverage = leverage;
    } else {
      // reducing, closing, or flipping
      const dir = pos.qty > 0 ? 1 : -1;
      const closeQty = Math.min(Math.abs(signed), Math.abs(pos.qty));
      const pnl = dir * closeQty * (price - pos.entry);
      this.realizedPnl += pnl;
      this.cash += pnl;
      pos.qty += signed;
      if (Math.abs(pos.qty) <= 1e-12) {
        pos.qty = 0;
        pos.entry = 0;
      } else if (pos.qty > 0 !== dir > 0) {
        pos.entry = price; // flipped to the other side
      }
    }
    this.perp.set(symbol, pos);
    return fee;
  }

  /** Apply one funding settlement. A long pays when the rate is positive; a short receives. */
  applyFunding(symbol: string, fundingRate: number, mark: number): number {
    const pos = this.perp.get(symbol);
    if (!pos || pos.qty === 0) return 0;
    const payment = pos.qty * mark * fundingRate;
    this.cash -= payment;
    this.fundingPaid += payment;
    return payment;
  }

  unrealizedPnl(marks: Map<string, number>): number {
    let u = 0;
    for (const [s, p] of this.spot) {
      const m = marks.get(s);
      if (m != null) u += p.units * (m - p.avgCost);
    }
    for (const [s, p] of this.perp) {
      const m = marks.get(s);
      if (m != null) u += p.qty * (m - p.entry);
    }
    return u;
  }

  equity(marks: Map<string, number>): number {
    let spotVal = 0;
    for (const [s, p] of this.spot) {
      const m = marks.get(s);
      if (m != null) spotVal += p.units * m;
    }
    let perpU = 0;
    for (const [s, p] of this.perp) {
      const m = marks.get(s);
      if (m != null) perpU += p.qty * (m - p.entry);
    }
    return this.cash + spotVal + perpU;
  }
}
