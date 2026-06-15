// Minimal example: open an account, buy spot, mark it up, sell, print the result.
//   npm run example
import { PaperPit } from "../src/index";
import type { MarketQuote } from "../src/index";

const sim = new PaperPit();
sim.createAccount("demo", 10_000);

const quote = (bid: number, ask: number): MarketQuote => ({ symbol: "AAPL", bid, ask, last: (bid + ask) / 2 });

const buy = sim.submit(
  { id: "1", accountId: "demo", symbol: "AAPL", kind: "spot", side: "buy", type: "market", qty: 10, ts: Date.now() },
  quote(199.9, 200.0)
);
console.log("buy:", buy.status, "@", buy.avgPrice, "fee", buy.feePaid.toFixed(2));

const sell = sim.submit(
  { id: "2", accountId: "demo", symbol: "AAPL", kind: "spot", side: "sell", type: "market", qty: 10, ts: Date.now() },
  quote(205.0, 205.1)
);
console.log("sell:", sell.status, "@", sell.avgPrice, "fee", sell.feePaid.toFixed(2));

const acct = sim.accounts.get("demo")!;
const marks = sim.marksFrom(new Map([["AAPL", quote(205, 205.1)]]));
console.log("realized PnL:", acct.realizedPnl.toFixed(2), "| equity:", acct.equity(marks).toFixed(2), "| fees:", acct.feesPaid.toFixed(2));
