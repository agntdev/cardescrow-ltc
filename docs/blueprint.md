# Pokémon Card Marketplace — Bot specification

**Archetype:** commerce

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot marketplace for trading Pokémon cards with LTC escrow payments, seller fees, and admin-managed dispute resolution. Listings are posted publicly in groups/channels with payment confirmation and manual dispute escalation.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Telegram group members trading Pokémon cards
- Marketplace administrators

## Success criteria

- Successful LTC escrow transactions with buyer confirmation
- Dispute resolution notifications to admins
- Persistent listing visibility in group/channel

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with listing creation and browsing options
- **/new** (command, actor: user, command: /new) — Initiate new listing creation flow
- **/list** (command, actor: user, command: /list) — Browse active listings with pagination
- **Buy** (button, actor: user, callback: purchase:init) — Initiate purchase flow from listing message
- **Dispute** (button, actor: user, callback: dispute:start) — Raise dispute from purchase message
- **/withdraw** (command, actor: user, command: /withdraw) — Request LTC payout from escrow balance

## Flows

### Create Listing
_Trigger:_ /new

1. Collect title, description, photos, price, condition, quantity
2. Post public listing message with Buy button

_Data touched:_ Listing

### Purchase Flow
_Trigger:_ purchase:init

1. Show payment amount with network fee
2. Generate escrow address
3. Detect on-chain payment
4. Notify buyer/seller of escrow confirmation

_Data touched:_ Offer, Escrow

### Dispute Resolution
_Trigger:_ dispute:start

1. Collect buyer claim and evidence
2. Notify admins with purchase details
3. Admin resolution via manual command

_Data touched:_ Dispute

### Payout Release
_Trigger:_ Confirm Received

1. Deduct seller fee
2. Release funds to seller address

_Data touched:_ Escrow, Offer

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Where dispute alerts and payment issues are sent
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.
- **FEE_PERCENTAGE** — Seller fee percentage (default 5%)
  - may be UNSET at runtime: the bot must still start, and the feature needing FEE_PERCENTAGE must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **User** _(retention: persistent)_ — Marketplace participant with payout address and chat ID
  - fields: telegram_id, ltc_address, fee_preference
- **Listing** _(retention: persistent)_ — Card for sale with metadata
  - fields: title, description, photos, price_ltc, condition, quantity
- **Offer** _(retention: persistent)_ — Buyer purchase record
  - fields: buyer_id, listing_id, amount, escrow_id, status
- **Escrow** _(retention: persistent)_ — LTC transaction holding funds
  - fields: address, balance_ltc, fee_deducted, release_status
- **Dispute** _(retention: persistent)_ — Pending resolution case
  - fields: purchase_id, claim, evidence, admin_notes, resolution

## Integrations

- **Telegram** (required) — Bot API messaging and group posting
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure seller fee percentage
- View dispute details in ADMIN_CHAT_ID
- Approve manual fund releases

## Notifications

- Dispute alerts to ADMIN_CHAT_ID
- Payment confirmation to buyer/seller
- Failed payment alerts

## Permissions & privacy

- Store user LTC addresses for payouts
- Access Telegram file references for listing photos
- Retain dispute evidence for resolution

## Edge cases

- Failed LTC payment detection
- Dispute escalation without buyer confirmation
- Multiple simultaneous purchase attempts

## Required tests

- End-to-end purchase flow with escrow release
- Dispute escalation and admin resolution
- Pagination in /list command

## Assumptions

- Default 5% seller fee applies until changed
- LTC on-chain payments handled externally
- Listings posted directly in group/channel
