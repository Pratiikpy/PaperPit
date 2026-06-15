// Core types. PaperPit fills spot orders quote-first and perp orders depth-aware.

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";
export type InstrumentKind = "spot" | "perp";

export interface Order {
  id: string;
  accountId: string;
  symbol: string;
  kind: InstrumentKind;
  side: Side;
  type: OrderType;
  qty: number; // base units (spot) / contracts (perp)
  limitPrice?: number;
  leverage?: number; // perp only
  ts: number;
}

export interface MarketQuote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  bidSz?: number | null;
  askSz?: number | null;
  book?: { bids: [number, number][]; asks: [number, number][] };
  fundingRate?: number | null;
}

export type FillStatus = "filled" | "partial" | "rejected" | "pending";

export interface Fill {
  orderId: string;
  accountId: string;
  symbol: string;
  kind: InstrumentKind;
  side: Side;
  qty: number;
  avgPrice: number | null;
  feePaid: number;
  slippagePct: number;
  ts: number;
  status: FillStatus;
  reason?: string;
}
