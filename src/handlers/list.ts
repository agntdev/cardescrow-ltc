import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { activeListings, feePercentage, formatLtc, getListing, storageReady } from "../marketplace.js";
import { inlineButton, inlineKeyboard, paginate, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Browse listings", data: "listing:list:0", order: 20 });
const composer = new Composer<Ctx>();
async function show(ctx: Ctx, page: number, edit = false): Promise<void> {
  if (!storageReady(ctx)) { if (edit) await ctx.editMessageText("No listings yet — marketplace storage isn't set up."); else await ctx.reply("No listings yet — marketplace storage isn't set up."); return; }
  const listings = await activeListings(ctx);
  if (listings.length === 0) { const text = "No active listings yet — tap New listing to post one."; if (edit) await ctx.editMessageText(text); else await ctx.reply(text); return; }
  const slice = paginate(listings, { page, perPage: 5, callbackPrefix: "listing:page", prevLabel: "Previous", nextLabel: "Next" });
  const rows: Parameters<typeof inlineKeyboard>[0] = slice.pageItems.map((listing) => [inlineButton(`${listing.title} · ${listing.priceLtc} LTC`, `listing:show:${listing.id}`)]);
  rows.push(...slice.controls.inline_keyboard);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  const text = `Active listings · page ${slice.page + 1} of ${slice.totalPages}`;
  if (edit) await ctx.editMessageText(text, { reply_markup: inlineKeyboard(rows) }); else await ctx.reply(text, { reply_markup: inlineKeyboard(rows) });
}
composer.command("list", async (ctx) => { await show(ctx, 0); });
composer.callbackQuery("listing:list:0", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, 0, true); });
composer.callbackQuery(/^listing:page:(?:prev|next):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, Number(ctx.match[1]), true); });
composer.callbackQuery(/^listing:show:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery(); const listing = await getListing(ctx, ctx.match[1]); if (!listing || listing.status !== "active") { await ctx.editMessageText("That listing is no longer available."); return; } const fee = feePercentage(ctx); if (fee === undefined) { await ctx.editMessageText("The seller fee setting isn't valid. Ask the owner to update it."); return; } const payout = listing.priceLtc - listing.priceLtc * fee / 100; await ctx.editMessageText(`${listing.title}\n${listing.description}\nCondition: ${listing.condition}\nPrice: ${formatLtc(listing.priceLtc)} LTC\nSeller fee: ${fee}%\nEstimated seller payout: ${formatLtc(payout)} LTC\nQuantity: ${listing.quantity}`, { reply_markup: inlineKeyboard([[inlineButton("Buy", `purchase:init:${listing.id}`)], [inlineButton("Back to listings", "listing:list:0")]]) }); });
export default composer;
