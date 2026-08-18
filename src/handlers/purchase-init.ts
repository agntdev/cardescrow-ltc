import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { createOffer, feePercentage, getEscrow, getListing, getOffer, getUser, saveEscrow, saveOffer, storageMessage } from "../marketplace.js";
import { adminChatId, inlineButton, inlineKeyboard, requireOwner } from "../toolkit/index.js";

const composer = new Composer<Ctx>();
const networkFeeNote = "Network fees are set by the LTC wallet when payment is sent.";
async function notify(ctx: Ctx, chatId: string | number | undefined, text: string, markup?: ReturnType<typeof inlineKeyboard>): Promise<void> { if (!chatId) return; try { await ctx.api.sendMessage(chatId, text, markup ? { reply_markup: markup } : undefined); } catch { /* A blocked or unavailable chat must not stop the transaction. */ } }

composer.callbackQuery("purchase:init", async (ctx) => { await ctx.answerCallbackQuery(); await ctx.reply("Choose an active listing first."); });
composer.callbackQuery(/^purchase:init:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const listing = await getListing(ctx, ctx.match[1]);
  if (!listing || listing.status !== "active" || listing.quantity < 1) { await ctx.reply("That listing is no longer available."); return; }
  if (ctx.from?.id === listing.sellerId) { await ctx.reply("You can't buy your own listing."); return; }
  const offer = await createOffer(ctx, listing);
  if (!offer) { await ctx.reply(storageMessage()); return; }
  await ctx.reply(`Payment amount: ${offer.amount} LTC.\n${networkFeeNote}\n\nEscrow payment monitoring isn't connected yet, so no payment address can be issued. The owner needs to connect the external LTC escrow service.`, { reply_markup: inlineKeyboard([[inlineButton("Raise dispute", `dispute:start:${offer.id}`)]]) });
  const owner = adminChatId(ctx as unknown as { env?: Record<string, unknown> });
  if (owner) await notify(ctx, owner, `A buyer started a purchase for ${listing.title}. Verify payment externally before marking it paid.`, inlineKeyboard([[inlineButton("Mark payment received", `offer:markpaid:${offer.id}`)]]));
});

composer.callbackQuery(/^offer:markpaid:(.+)$/, async (ctx) => {
  if (!(await requireOwner(ctx as unknown as Parameters<typeof requireOwner>[0]))) return;
  await ctx.answerCallbackQuery();
  const offer = await getOffer(ctx, ctx.match[1]);
  if (!offer || offer.status !== "awaiting_payment") { await ctx.reply("That payment can't be marked as received."); return; }
  const escrow = await getEscrow(ctx, offer.escrowId);
  if (!escrow) { await ctx.reply("The escrow record couldn't be found."); return; }
  offer.status = "confirmed"; escrow.balanceLtc = offer.amount; escrow.releaseStatus = "held";
  await saveOffer(ctx, offer); await saveEscrow(ctx, escrow);
  const listing = await getListing(ctx, offer.listingId);
  await notify(ctx, offer.buyerChatId, "Your LTC payment is confirmed in escrow. Confirm delivery when you receive the card.", inlineKeyboard([[inlineButton("Confirm received", `purchase:received:${offer.id}`), inlineButton("Raise dispute", `dispute:start:${offer.id}`)]]));
  if (listing) await notify(ctx, listing.sellerChatId, "LTC payment is confirmed in escrow. Ship the card, then wait for buyer confirmation.");
  await ctx.reply("Payment marked as received. The buyer and seller have been notified.");
});

composer.callbackQuery(/^purchase:received:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const offer = await getOffer(ctx, ctx.match[1]);
  if (!offer || ctx.from?.id !== offer.buyerId) { await ctx.reply("That purchase isn't available for confirmation."); return; }
  if (offer.status !== "confirmed") { await ctx.reply("This purchase isn't ready for release yet."); return; }
  const escrow = await getEscrow(ctx, offer.escrowId); const listing = await getListing(ctx, offer.listingId); const fee = feePercentage(ctx);
  if (!escrow || !listing) { await ctx.reply("The escrow details couldn't be found."); return; }
  if (fee === undefined) { await ctx.reply("The seller fee setting isn't valid. Ask the owner to update it."); return; }
  const seller = await getUser(ctx, listing.sellerId);
  if (!seller?.ltcAddress) { await ctx.reply("The seller hasn't set a payout address yet. The owner has been notified."); await notify(ctx, adminChatId(ctx as unknown as { env?: Record<string, unknown> }), "A confirmed purchase is waiting for the seller's payout address."); return; }
  const feeAmount = Number((offer.amount * fee / 100).toFixed(8));
  escrow.feeDeducted = feeAmount; escrow.releaseStatus = "released"; offer.status = "released";
  await saveEscrow(ctx, escrow); await saveOffer(ctx, offer);
  await ctx.reply(`Receipt confirmed. ${Number((offer.amount - feeAmount).toFixed(8))} LTC is approved for the seller after the ${fee}% fee.`);
  await notify(ctx, seller.chatId, `The buyer confirmed receipt. Your payout of ${Number((offer.amount - feeAmount).toFixed(8))} LTC is approved for manual release.`);
  await notify(ctx, adminChatId(ctx as unknown as { env?: Record<string, unknown> }), `A seller payout is approved for manual release after buyer confirmation.`);
});

export default composer;
