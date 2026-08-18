import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { createListing, feePercentage, formatLtc, storageMessage } from "../marketplace.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "➕ New listing", data: "listing:new", order: 10 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

function reset(ctx: Ctx): void { ctx.session.step = undefined; ctx.session.draftListing = undefined; }
function begin(ctx: Ctx): Promise<unknown> {
  ctx.session.draftListing = { photos: [] };
  ctx.session.step = "listing_title";
  return ctx.reply("Enter the card title.");
}
function validText(text: string, max: number): string | undefined { const value = text.trim(); return value.length > 0 && value.length <= max ? value : undefined; }

composer.command("new", async (ctx) => { await begin(ctx); });
composer.callbackQuery("listing:new", async (ctx) => { await ctx.answerCallbackQuery(); await begin(ctx); });

composer.callbackQuery(/^listing:condition:(mint|near_mint|excellent|good|played)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.session.draftListing) return;
  ctx.session.draftListing.condition = ctx.match[1].replace("_", " ");
  ctx.session.step = "listing_quantity";
  await ctx.editMessageText("Enter the quantity available.");
});

composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.step !== "listing_photos") return next();
  const photos = ctx.session.draftListing?.photos ?? [];
  const largest = ctx.message.photo.at(-1);
  if (largest && photos.length < 10) photos.push(largest.file_id);
  if (ctx.session.draftListing) ctx.session.draftListing.photos = photos;
  await ctx.reply("Photo added. Send another photo or tap Continue.", { reply_markup: inlineKeyboard([[inlineButton("Continue", "listing:photos:done")]]) });
});

composer.callbackQuery("listing:photos:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "listing_photos") return;
  ctx.session.step = "listing_price";
  await ctx.editMessageText("Enter the price in LTC, for example 0.25.");
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text;
  const draft = ctx.session.draftListing;
  if (!ctx.session.step || !draft) return next();
  if (text === "/cancel") { reset(ctx); await ctx.reply("Listing cancelled.", { reply_markup: back }); return; }
  if (ctx.session.step === "listing_title") {
    const title = validText(text, 100);
    if (!title) { await ctx.reply("Use a title of up to 100 characters."); return; }
    draft.title = title; ctx.session.step = "listing_description";
    await ctx.reply("Add a short description."); return;
  }
  if (ctx.session.step === "listing_description") {
    const description = validText(text, 1000);
    if (!description) { await ctx.reply("Use a description of up to 1,000 characters."); return; }
    draft.description = description; ctx.session.step = "listing_photos";
    await ctx.reply("Send up to 10 card photos, then tap Continue. You can continue without photos.", { reply_markup: inlineKeyboard([[inlineButton("Continue", "listing:photos:done")]]) }); return;
  }
  if (ctx.session.step === "listing_photos") { await ctx.reply("Send a photo or tap Continue."); return; }
  if (ctx.session.step === "listing_price") {
    const price = Number(text.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) { await ctx.reply("Enter a valid LTC price greater than zero."); return; }
    draft.priceLtc = price;
    await ctx.reply("Choose the card condition.", { reply_markup: inlineKeyboard([[inlineButton("Mint", "listing:condition:mint"), inlineButton("Near mint", "listing:condition:near_mint")], [inlineButton("Excellent", "listing:condition:excellent"), inlineButton("Good", "listing:condition:good")], [inlineButton("Played", "listing:condition:played")]]) }); return;
  }
  if (ctx.session.step === "listing_quantity") {
    const quantity = Number(text);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) { await ctx.reply("Enter a whole quantity between 1 and 1,000."); return; }
    if (!draft.title || !draft.description || !draft.priceLtc || !draft.condition) { reset(ctx); await ctx.reply("That listing couldn't be completed. Start a new listing and try again."); return; }
    const fee = feePercentage(ctx);
    if (fee === undefined) { await ctx.reply("The seller fee setting isn't valid. Ask the owner to update it."); return; }
    const listing = await createListing(ctx, { title: draft.title, description: draft.description, photos: draft.photos ?? [], priceLtc: draft.priceLtc, condition: draft.condition, quantity });
    reset(ctx);
    if (!listing) { await ctx.reply(storageMessage()); return; }
    const estimatedPayout = listing.priceLtc - listing.priceLtc * fee / 100;
    const caption = `${listing.title}\n${listing.description}\nCondition: ${listing.condition}\nPrice: ${formatLtc(listing.priceLtc)} LTC\nSeller fee: ${fee}%\nEstimated seller payout: ${formatLtc(estimatedPayout)} LTC\nQuantity: ${listing.quantity}`;
    const keyboard = inlineKeyboard([[inlineButton("Buy", `purchase:init:${listing.id}`)]]);
    if (listing.photos[0]) await ctx.api.sendPhoto(ctx.chat.id, listing.photos[0], { caption, reply_markup: keyboard });
    else await ctx.reply(caption, { reply_markup: keyboard });
    await ctx.reply("Your listing is live.", { reply_markup: back });
  }
});

export default composer;
