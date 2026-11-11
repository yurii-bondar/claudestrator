// The page ↔ main thread channel, over Electrobun's RPC: messages only, both ways. The page's requests and their
// answers are its own protocol (core/src/wire.ts), carried as these messages; the engine worker answers them.
import type { RPCSchema } from 'electrobun/bun';

/** A message of the page's protocol: always an object (`{ type: 'req', … }`). */
export type PageMessage = Record<string, unknown>;

export type DashboardRPC = {
  bun: RPCSchema<{ requests: Record<never, never>; messages: { page: PageMessage } }>;
  /** What the engine posted in one turn of its loop, in order. */
  webview: RPCSchema<{ requests: Record<never, never>; messages: { host: unknown[] } }>;
};
