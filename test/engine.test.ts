import { test } from "node:test";
import assert from "node:assert/strict";
import { PaperPit } from "../src/index";
import type { Order, MarketQuote } from "../src/index";

const order = (o: Partial<Order>): Order => ({
  id: o.id ?? "o1",
  accountId: o.accountId ?? "a",
  symbol: o.symbol ?? "X",
  kind: o.kind ?? "spot",
  side: o.side ?? "buy",
  type: o.type ?? "market",
  qty: o.qty ?? 1,
  limitPrice: o.limitPrice,
  leverage: o.leverage,
  ts: o.ts ?? 0,
});
const q = (bid: number, ask: number): MarketQuote => ({ symbol: "X", bid, ask, last: (bid + ask) / 2 });

test("market order fills immediately and updates the account", () => {
  const sim = new PaperPit();
  sim.createAccount("a", 10_000);
  const fill = sim.submit(order({ qty: 5 }), q(99, 100));
  assert.equal(fill.status, "filled");
  assert.equal(fill.qty, 5);
  assert.equal(sim.accounts.get("a")!.spot.get("X")!.units, 5);
});

test("an unmarketable limit order rests, then settles when the quote crosses it", () => {
  const sim = new PaperPit();
  sim.createAccount("a", 10_000);
  const resting = sim.submit(order({ type: "limit", side: "buy", limitPrice: 95, qty: 1 }), q(99, 100));
  assert.equal(resting.status, "pending");
  assert.equal(sim.pending.length, 1);
  const fills = sim.onMarket(new Map([["X", q(94, 95)]])); // ask 95 <= limit 95 → fills
  assert.equal(fills.length, 1);
  assert.equal(fills[0]!.status, "filled");
  assert.equal(sim.pending.length, 0);
});

test("orders for a missing account are rejected", () => {
  const sim = new PaperPit();
  const fill = sim.submit(order({ accountId: "ghost" }), q(99, 100));
  assert.equal(fill.status, "rejected");
  assert.match(fill.reason!, /account/);
});

test("no-liquidity quote is rejected, not silently filled", () => {
  const sim = new PaperPit();
  sim.createAccount("a", 10_000);
  const fill = sim.submit(order({ side: "buy" }), { symbol: "X", bid: 99, ask: null, last: 99 });
  assert.equal(fill.status, "rejected");
});
