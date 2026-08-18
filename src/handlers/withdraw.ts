import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { saveUser, storageMessage } from "../marketplace.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Withdraw LTC", data: "withdraw:start", order: 30 });
const composer = new Composer<Ctx>();
function begin(ctx: Ctx): Promise<unknown> { ctx.session.step = "withdraw_address"; return ctx.reply("Enter your Litecoin payout address."); }
function isLtcAddress(value: string): boolean { return /^(ltc1[ac-hj-np-z02-9]{20,90}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(value); }
composer.command("withdraw", async (ctx) => { await begin(ctx); });
composer.callbackQuery("withdraw:start", async (ctx) => { await ctx.answerCallbackQuery(); await begin(ctx); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.step !== "withdraw_address") return next(); const address = ctx.message.text.trim(); if (address === "/cancel") { ctx.session.step = undefined; await ctx.reply("Withdrawal request cancelled."); return; } if (!isLtcAddress(address)) { await ctx.reply("That doesn't look like a Litecoin address. Check it and try again."); return; } ctx.session.step = undefined; if (!(await saveUser(ctx, address))) { await ctx.reply(storageMessage()); return; } await ctx.reply("Your payout address is saved. Approved escrow payouts are released manually by the owner.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); });
export default composer;
