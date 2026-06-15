// Replay helper: load recorded market frames from JSONL and feed them to the engine.
//
// Frame format (one JSON object per line):
//   { "ts": 1718000000000, "quotes": { "BTCUSDT": { "symbol": "BTCUSDT", "bid": 1, "ask": 2, "last": 1.5 }, ... } }
//
// This keeps PaperPit source-agnostic: record quotes from any venue into this shape and replay them.
import { readFileSync } from "node:fs";
import type { MarketQuote } from "./types";

export interface Frame {
  ts: number;
  quotes: Record<string, MarketQuote>;
}

/** Parse a JSONL string into frames (malformed lines are skipped). */
export function parseFrames(jsonl: string): Frame[] {
  const out: Frame[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const f = JSON.parse(t) as Frame;
      if (f && typeof f.ts === "number" && f.quotes) out.push(f);
    } catch {
      /* skip malformed line */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Load frames from a JSONL file. */
export function loadFrames(file: string): Frame[] {
  return parseFrames(readFileSync(file, "utf8"));
}

/** A frame's quotes as a Map, ready for engine.onMarket / submit. */
export function quotesOf(frame: Frame): Map<string, MarketQuote> {
  return new Map(Object.entries(frame.quotes));
}
