import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteFill, depthFill } from "../src/index";
import type { MarketQuote } from "../src/index";

const q = (bid: number, ask: number): MarketQuote => ({ symbol: "X", bid, ask, last: (bid + ask) / 2 });

test("quoteFill buys at the ask, sells at the bid, with size-aware slippage", () => {
  const buy = quoteFill("buy", 1, q(99, 100), { baseSlipPct: 0, impactPct: 0, refNotional: 5000 });
  assert.equal(buy.avgPrice, 100);
  const sell = quoteFill("sell", 1, q(99, 100), { baseSlipPct: 0, impactPct: 0, refNotional: 5000 });
  assert.equal(sell.avgPrice, 99);
  // impact pushes a buy above the ask
  const big = quoteFill("buy", 100, q(99, 100), { baseSlipPct: 0, impactPct: 0.1, refNotional: 1000 });
  assert.ok(big.avgPrice! > 100, `expected slippage, got ${big.avgPrice}`);
});

test("quoteFill returns nothing when there is no touch", () => {
  const r = quoteFill("buy", 1, { symbol: "X", bid: 99, ask: null, last: 99 });
  assert.equal(r.fillQty, 0);
  assert.equal(r.avgPrice, null);
});

test("depthFill is a VWAP across levels and partials when the book is too thin", () => {
  const book = { bids: [[99, 1] as [number, number]], asks: [[100, 1] as [number, number], [101, 1] as [number, number]] };
  const full = depthFill("buy", 2, book);
  assert.equal(full.fillQty, 2);
  assert.equal(full.avgPrice, 100.5); // (100*1 + 101*1)/2
  const partial = depthFill("buy", 5, book);
  assert.equal(partial.fillQty, 2); // only 2 units of asks available
});
