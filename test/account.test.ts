import { test } from "node:test";
import assert from "node:assert/strict";
import { Account } from "../src/index";

test("spot round-trip realizes PnL and charges fees both ways", () => {
  const a = new Account("a", 10_000, { spotTakerPct: 0.1, perpTakerPct: 0.06 });
  a.applySpotFill("X", "buy", 10, 100); // cost 1000 + 1 fee
  assert.ok(Math.abs(a.cash - (10_000 - 1000 - 1)) < 1e-9);
  a.applySpotFill("X", "sell", 10, 110); // proceeds 1100 - 1.1 fee
  assert.equal(a.spot.get("X")!.units, 0);
  assert.ok(a.realizedPnl > 0);
});

test("perp long then close realizes directional PnL", () => {
  const a = new Account("a", 10_000);
  a.applyPerpFill("P", "buy", 1, 100, 2); // long 1 @ 100
  a.applyPerpFill("P", "sell", 1, 110, 2); // close @ 110 → +10 realized (fees hit cash/feesPaid)
  assert.equal(a.perp.get("P")!.qty, 0);
  assert.ok(Math.abs(a.realizedPnl - 10) < 1e-9, `realizedPnl=${a.realizedPnl}`);
  assert.ok(a.feesPaid > 0 && a.cash < 10_000 + 10); // fees were charged to cash
});

test("funding debits a long when the rate is positive", () => {
  const a = new Account("a", 10_000);
  a.applyPerpFill("P", "buy", 1, 100);
  const before = a.cash;
  a.applyFunding("P", 0.0001, 100); // pay 1 * 100 * 0.0001 = 0.01
  assert.ok(a.cash < before);
  assert.ok(Math.abs(a.fundingPaid - 0.01) < 1e-9);
});

test("equity = cash + marked positions", () => {
  const a = new Account("a", 10_000);
  a.applySpotFill("X", "buy", 10, 100);
  const eq = a.equity(new Map([["X", 105]]));
  assert.ok(eq > 10_000 - 1); // up ~50 minus the 1 fee
});
