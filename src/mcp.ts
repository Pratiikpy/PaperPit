#!/usr/bin/env tsx
// PaperPit MCP server — exposes the sandbox over the Model Context Protocol (stdio transport) so any
// MCP client (Claude, Cursor, Codex, your own agent) can paper-trade through it. Zero dependencies:
// MCP stdio is newline-delimited JSON-RPC 2.0, which is small enough to implement directly.
//
// Tools: create_account, quote, submit, account, fills. State is held in-process for the session.
import { PaperPit } from "./engine";
import type { MarketQuote, Order } from "./types";

const sim = new PaperPit();
const quotes = new Map<string, MarketQuote>();
let orderSeq = 0;

const TOOLS = [
  {
    name: "create_account",
    description: "Create a paper-trading account with a starting cash balance.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, cash: { type: "number" } },
      required: ["id", "cash"],
    },
  },
  {
    name: "quote",
    description: "Set or update the current market quote for a symbol (bid/ask/last, optional fundingRate).",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        bid: { type: "number" },
        ask: { type: "number" },
        last: { type: "number" },
        fundingRate: { type: "number" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "submit",
    description: "Submit an order against the stored quote for its symbol. Returns the fill (price, fee, slippage).",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        symbol: { type: "string" },
        kind: { type: "string", enum: ["spot", "perp"] },
        side: { type: "string", enum: ["buy", "sell"] },
        qty: { type: "number" },
        type: { type: "string", enum: ["market", "limit"] },
        limitPrice: { type: "number" },
        leverage: { type: "number" },
      },
      required: ["accountId", "symbol", "kind", "side", "qty"],
    },
  },
  {
    name: "account",
    description: "Get an account's cash, positions, realized/unrealized PnL and equity (marked at stored quotes).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "fills",
    description: "List every fill produced so far this session.",
    inputSchema: { type: "object", properties: {} },
  },
];

function callTool(name: string, args: Record<string, any>): unknown {
  switch (name) {
    case "create_account": {
      const a = sim.createAccount(String(args.id), Number(args.cash));
      return { id: a.id, cash: a.cash };
    }
    case "quote": {
      const symbol = String(args.symbol);
      quotes.set(symbol, {
        symbol,
        bid: args.bid ?? null,
        ask: args.ask ?? null,
        last: args.last ?? null,
        fundingRate: args.fundingRate ?? null,
      });
      sim.onMarket(quotes); // settle any resting limit orders
      return { ok: true, symbol };
    }
    case "submit": {
      const q = quotes.get(String(args.symbol));
      if (!q) throw new Error(`no quote for ${args.symbol} — call 'quote' first`);
      const order: Order = {
        id: `o${orderSeq++}`,
        accountId: String(args.accountId),
        symbol: String(args.symbol),
        kind: args.kind,
        side: args.side,
        type: args.type ?? "market",
        qty: Number(args.qty),
        limitPrice: args.limitPrice != null ? Number(args.limitPrice) : undefined,
        leverage: args.leverage != null ? Number(args.leverage) : undefined,
        ts: Date.now(),
      };
      return sim.submit(order, q);
    }
    case "account": {
      const a = sim.accounts.get(String(args.id));
      if (!a) throw new Error(`no such account: ${args.id}`);
      const marks = sim.marksFrom(quotes);
      return {
        id: a.id,
        cash: Number(a.cash.toFixed(6)),
        realizedPnl: Number(a.realizedPnl.toFixed(6)),
        unrealizedPnl: Number(a.unrealizedPnl(marks).toFixed(6)),
        equity: Number(a.equity(marks).toFixed(6)),
        feesPaid: Number(a.feesPaid.toFixed(6)),
        fundingPaid: Number(a.fundingPaid.toFixed(6)),
        spot: Object.fromEntries(a.spot),
        perp: Object.fromEntries(a.perp),
      };
    }
    case "fills":
      return sim.fills;
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── JSON-RPC 2.0 over stdio (newline-delimited) ──
function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(msg: any): void {
  const { id, method, params } = msg ?? {};
  if (method == null) return; // a response/garbage — ignore
  const isNotification = id === undefined || id === null;
  try {
    let result: unknown;
    if (method === "initialize") {
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "paperpit", version: "0.1.0" },
      };
    } else if (method === "tools/list") {
      result = { tools: TOOLS };
    } else if (method === "tools/call") {
      const out = callTool(params?.name, params?.arguments ?? {});
      result = { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } else if (method === "ping") {
      result = {};
    } else if (isNotification) {
      return; // unknown notification (e.g. notifications/initialized) — nothing to do
    } else {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
      return;
    }
    if (!isNotification) send({ jsonrpc: "2.0", id, result });
  } catch (e) {
    if (!isNotification) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: (e as Error).message } });
    }
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      /* ignore non-JSON line */
    }
  }
});
process.stdin.on("end", () => process.exit(0));
