import type { Ctx } from "./bot.js";

export type Listing = {
  id: string;
  sellerId: number;
  sellerChatId: number;
  title: string;
  description: string;
  photos: string[];
  priceLtc: number;
  condition: string;
  quantity: number;
  status: "active" | "sold";
  createdAt: number;
};

export type MarketplaceUser = { telegramId: number; chatId: number; ltcAddress?: string; feePreference?: number };
export type Offer = {
  id: string;
  buyerId: number;
  buyerChatId: number;
  listingId: string;
  amount: number;
  escrowId: string;
  status: "awaiting_payment" | "confirmed" | "released" | "disputed";
};
export type Escrow = { id: string; address?: string; balanceLtc: number; feeDeducted: number; releaseStatus: "awaiting_payment" | "held" | "released" };
export type Dispute = { id: string; purchaseId: string; claim: string; evidence: string[]; adminNotes?: string; resolution: "pending" | "approved" | "rejected" };

type D1Statement = { bind(...values: unknown[]): D1Statement; first<T>(): Promise<T | null>; run(): Promise<unknown> };
type D1Database = { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<unknown> };
type MarketplaceStub = { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> };
type MarketplaceNamespace = { idFromName(name: string): unknown; get(id: unknown): MarketplaceStub };
type DatabaseCtx = Ctx & { env?: { DB?: D1Database; CHAT_DO?: MarketplaceNamespace } };

let clock: () => number = () => Date.now();
/** Test seam for time-dependent records. Production code uses this single clock. */
export function now(): number { return clock(); }
export function setMarketplaceClockForTests(next?: () => number): void { clock = next ?? (() => Date.now()); }

function db(ctx: Ctx): D1Database | undefined { return (ctx as DatabaseCtx).env?.DB; }
function durableStore(ctx: Ctx): MarketplaceStub | undefined { const namespace = (ctx as DatabaseCtx).env?.CHAT_DO; return namespace?.get(namespace.idFromName("marketplace")); }
export function storageReady(ctx: Ctx): boolean { return db(ctx) !== undefined || durableStore(ctx) !== undefined; }

async function ensure(ctx: Ctx): Promise<D1Database | undefined> {
  const database = db(ctx);
  if (!database) return undefined;
  await database.batch([
    database.prepare("CREATE TABLE IF NOT EXISTS marketplace_records (record_key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    database.prepare("CREATE TABLE IF NOT EXISTS marketplace_indexes (index_key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
  ]);
  return database;
}

async function read<T>(ctx: Ctx, key: string): Promise<T | undefined> {
  const database = await ensure(ctx);
  if (!database) {
    const store = durableStore(ctx);
    if (!store) return undefined;
    const response = await store.fetch(`https://do/marketplace?key=${encodeURIComponent(key)}`, { method: "GET" });
    return response.status === 204 ? undefined : await response.json() as T;
  }
  const row = await database.prepare("SELECT value FROM marketplace_records WHERE record_key = ?").bind(key).first<{ value: string }>();
  if (!row) return undefined;
  try { return JSON.parse(row.value) as T; } catch { return undefined; }
}

async function write(ctx: Ctx, key: string, value: unknown): Promise<boolean> {
  const database = await ensure(ctx);
  if (!database) {
    const store = durableStore(ctx);
    if (!store) return false;
    await store.fetch(`https://do/marketplace?key=${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(value) });
    return true;
  }
  await database.prepare("INSERT OR REPLACE INTO marketplace_records (record_key, value) VALUES (?, ?)").bind(key, JSON.stringify(value)).run();
  return true;
}

async function addToIndex(ctx: Ctx, key: string, id: string): Promise<boolean> {
  const database = await ensure(ctx);
  if (!database) {
    const store = durableStore(ctx);
    if (!store) return false;
    const url = `https://do/marketplace?bucket=index&key=${encodeURIComponent(key)}`;
    const response = await store.fetch(url, { method: "GET" });
    const ids = response.status === 204 ? [] : await response.json() as string[];
    if (!ids.includes(id)) ids.push(id);
    await store.fetch(url, { method: "PUT", body: JSON.stringify(ids) });
    return true;
  }
  const current = await database.prepare("SELECT value FROM marketplace_indexes WHERE index_key = ?").bind(key).first<{ value: string }>();
  let ids: string[] = [];
  try { ids = current ? JSON.parse(current.value) as string[] : []; } catch { ids = []; }
  if (!ids.includes(id)) ids.push(id);
  await database.prepare("INSERT OR REPLACE INTO marketplace_indexes (index_key, value) VALUES (?, ?)").bind(key, JSON.stringify(ids)).run();
  return true;
}

async function index(ctx: Ctx, key: string): Promise<string[]> {
  const database = await ensure(ctx);
  if (!database) {
    const store = durableStore(ctx);
    if (!store) return [];
    const response = await store.fetch(`https://do/marketplace?bucket=index&key=${encodeURIComponent(key)}`, { method: "GET" });
    return response.status === 204 ? [] : await response.json() as string[];
  }
  const row = await database.prepare("SELECT value FROM marketplace_indexes WHERE index_key = ?").bind(key).first<{ value: string }>();
  try { return row ? JSON.parse(row.value) as string[] : []; } catch { return []; }
}

function id(kind: string): string { return `${kind}_${crypto.randomUUID()}`; }

export async function saveUser(ctx: Ctx, address?: string): Promise<boolean> {
  if (!ctx.from || !ctx.chat) return false;
  const prior = await read<MarketplaceUser>(ctx, `user:${ctx.from.id}`);
  return write(ctx, `user:${ctx.from.id}`, { telegramId: ctx.from.id, chatId: ctx.chat.id, ltcAddress: address ?? prior?.ltcAddress, feePreference: prior?.feePreference });
}
export async function getUser(ctx: Ctx, userId: number): Promise<MarketplaceUser | undefined> { return read(ctx, `user:${userId}`); }

export async function createListing(ctx: Ctx, input: Omit<Listing, "id" | "sellerId" | "sellerChatId" | "status" | "createdAt">): Promise<Listing | undefined> {
  if (!ctx.from || !ctx.chat) return undefined;
  const listing: Listing = { ...input, id: id("listing"), sellerId: ctx.from.id, sellerChatId: ctx.chat.id, status: "active", createdAt: now() };
  if (!(await write(ctx, `listing:${listing.id}`, listing))) return undefined;
  await addToIndex(ctx, "listings:active", listing.id);
  await saveUser(ctx);
  return listing;
}
export async function getListing(ctx: Ctx, listingId: string): Promise<Listing | undefined> { return read(ctx, `listing:${listingId}`); }
export async function activeListings(ctx: Ctx): Promise<Listing[]> {
  const ids = await index(ctx, "listings:active");
  const values = await Promise.all(ids.map((listingId) => getListing(ctx, listingId)));
  return values.filter((value): value is Listing => value?.status === "active").sort((a, b) => b.createdAt - a.createdAt);
}

export async function createOffer(ctx: Ctx, listing: Listing): Promise<Offer | undefined> {
  if (!ctx.from || !ctx.chat || listing.quantity < 1 || listing.status !== "active") return undefined;
  const escrow: Escrow = { id: id("escrow"), balanceLtc: 0, feeDeducted: 0, releaseStatus: "awaiting_payment" };
  const offer: Offer = { id: id("offer"), buyerId: ctx.from.id, buyerChatId: ctx.chat.id, listingId: listing.id, amount: listing.priceLtc, escrowId: escrow.id, status: "awaiting_payment" };
  if (!(await write(ctx, `escrow:${escrow.id}`, escrow))) return undefined;
  if (!(await write(ctx, `offer:${offer.id}`, offer))) return undefined;
  // Reserve one card as soon as checkout starts so a listing cannot oversell
  // while a previous buyer is arranging payment.
  listing.quantity -= 1;
  if (listing.quantity === 0) listing.status = "sold";
  await write(ctx, `listing:${listing.id}`, listing);
  await addToIndex(ctx, `offers:buyer:${offer.buyerId}`, offer.id);
  return offer;
}
export async function getOffer(ctx: Ctx, offerId: string): Promise<Offer | undefined> { return read(ctx, `offer:${offerId}`); }
export async function getEscrow(ctx: Ctx, escrowId: string): Promise<Escrow | undefined> { return read(ctx, `escrow:${escrowId}`); }
export async function saveOffer(ctx: Ctx, offer: Offer): Promise<boolean> { return write(ctx, `offer:${offer.id}`, offer); }
export async function saveEscrow(ctx: Ctx, escrow: Escrow): Promise<boolean> { return write(ctx, `escrow:${escrow.id}`, escrow); }

export async function createDispute(ctx: Ctx, purchaseId: string, claim: string, evidence: string[]): Promise<Dispute | undefined> {
  const dispute: Dispute = { id: id("dispute"), purchaseId, claim, evidence, resolution: "pending" };
  if (!(await write(ctx, `dispute:${dispute.id}`, dispute))) return undefined;
  await addToIndex(ctx, "disputes:pending", dispute.id);
  return dispute;
}
export async function getDispute(ctx: Ctx, disputeId: string): Promise<Dispute | undefined> { return read(ctx, `dispute:${disputeId}`); }
export async function saveDispute(ctx: Ctx, dispute: Dispute): Promise<boolean> { return write(ctx, `dispute:${dispute.id}`, dispute); }
export async function pendingDisputes(ctx: Ctx): Promise<Dispute[]> {
  const ids = await index(ctx, "disputes:pending");
  const values = await Promise.all(ids.map((disputeId) => getDispute(ctx, disputeId)));
  return values.filter((value): value is Dispute => value?.resolution === "pending");
}

export function feePercentage(ctx: Ctx): number | undefined {
  const raw = (ctx as Ctx & { env?: Record<string, unknown> }).env?.FEE_PERCENTAGE ?? (typeof process === "undefined" ? undefined : process.env.FEE_PERCENTAGE);
  if (raw === undefined || raw === "") return 5;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}
export function storageMessage(): string { return "Marketplace storage isn't set up yet. Ask the owner to finish deployment setup."; }
