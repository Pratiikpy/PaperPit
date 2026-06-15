// Replay recorded market frames through the engine.
//   npm run replay
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PaperPit, loadFrames, quotesOf } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const frames = loadFrames(join(here, "sample-frames.jsonl"));

const sim = new PaperPit();
sim.createAccount("demo", 10_000);

// Rest a limit buy; it should settle on a later frame whose ask crosses it.
sim.submit(
  { id: "buy", accountId: "demo", symbol: "BTCUSDT", kind: "perp", side: "buy", type: "limit", limitPrice: 60_000, qty: 0.01, ts: 0 },
  quotesOf(frames[0]!).get("BTCUSDT")!
);

for (const f of frames) {
  const quotes = quotesOf(f);
  const newFills = sim.onMarket(quotes);
  sim.applyFunding(quotes);
  for (const fill of newFills) console.log(`frame ${f.ts}: ${fill.status} ${fill.qty} ${fill.symbol} @ ${fill.avgPrice}`);
}

const acct = sim.accounts.get("demo")!;
const marks = sim.marksFrom(quotesOf(frames[frames.length - 1]!));
console.log("equity:", acct.equity(marks).toFixed(2), "| funding paid:", acct.fundingPaid.toFixed(4));
