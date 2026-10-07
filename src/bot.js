const { Bot, InlineKeyboard, webhookCallback } = require("grammy");

const { upsertUser } = require("./db");
const { getSubscription, isActive } = require("./subscriptions");
const {
  createApproval,
  getApproval,
  applyApproval,
  rejectApproval
} = require("./approvals");

const INVITE_LINK_TTL_SEC = 24 * 60 * 60;

function formatDate(value) {
  return new Date(value).toLocaleDateString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* Bot tokeni bo'lmaganda ishlatiladi (masalan Payme sandbox testi paytida) */
function createNoopNotifier() {
  const log = (name) => async (...args) =>
    console.log(`ℹ️ notifier.${name} (bot o'chirilgan):`, ...args);

  return {
    enabled: false,
    sendAccessLink: log("sendAccessLink"),
    sendPaymentConfirmed: log("sendPaymentConfirmed"),
    removeFromChannel: log("removeFromChannel"),
    notifyExpired: log("notifyExpired"),
    notifyExpiring: log("notifyExpiring")
  };
}

function createTelegram({ pool, config }) {
  if (!config.botToken) {
    console.warn("⚠️ BOT_TOKEN yo'q: bot ishga tushmaydi");

    return {
      bot: null,
      notifier: createNoopNotifier(),
      webhookHandler: null,
      configure: async () => {}
    };
  }

  const bot = new Bot(config.botToken);
  const api = bot.api;

  const webAppUrl = config.publicUrl ? `${config.publicUrl}/` : "";
  const panelUrl = config.publicUrl ? `${config.publicUrl}/?page=panel` : "";

  function mainKeyboard() {
    const keyboard = new InlineKeyboard();

    if (webAppUrl) {
      keyboard.webApp("Obuna ulash", webAppUrl).row();
    }

    if (panelUrl) {
      keyboard.webApp("Boshqaruv paneli", panelUrl).row();
    }

    return keyboard;
  }

  function buyKeyboard() {
    const keyboard = new InlineKeyboard();

    if (webAppUrl) {
      keyboard.webApp("💎 Obuna ulash", webAppUrl);
    }

    return keyboard;
  }

  function staffIds() {
    const ids = new Set(config.adminTelegramIds || []);

    if (config.ownerTelegramId) {
      ids.add(String(config.ownerTelegramId));
    }

    return ids;
  }

  function isStaff(userId) {
    return staffIds().has(String(userId));
  }

  function isOwner(userId) {
    return Boolean(config.ownerTelegramId) && String(userId) === String(config.ownerTelegramId);
  }

  function approvalKeyboard(approvalId) {
    return new InlineKeyboard()
      .text("✅ Havola yuborish", `ok:${approvalId}`)
      .text("❌ Yo‘q", `no:${approvalId}`);
  }

  async function notifyOwnerPayment(approval) {
    const ownerId = config.ownerTelegramId;

    if (!ownerId) {
      return false;
    }

    const name = approval.full_name ? `\nIsm: ${escapeHtml(approval.full_name)}` : "";
    const nick = approval.username ? `\nUsername: @${escapeHtml(String(approval.username).replace(/^@/, ""))}` : "";
    const amount = approval.amount_som
      ? `\nSumma: <b>${Number(approval.amount_som).toLocaleString("ru-RU")} so‘m</b>`
      : "";

    await api.sendMessage(
      Number(ownerId),
      `💳 <b>To‘lov aniqlandi</b>\n\n` +
        `User ID: <code>${escapeHtml(approval.telegram_user_id)}</code>` +
        name +
        nick +
        amount +
        `\n\nShu foydalanuvchiga kanal havolasini yuborasizmi?`,
      {
        parse_mode: "HTML",
        reply_markup: approvalKeyboard(approval.id)
      }
    );

    return true;
  }

  async function safeSend(userId, text, extra = {}) {
    try {
      await api.sendMessage(Number(userId), text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...extra
      });

      return true;
    } catch (error) {
      // Foydalanuvchi botni bloklagan bo'lishi mumkin
      console.error("❌ sendMessage:", userId, error.message);
      return false;
    }
  }

  async function createInviteLink(userId) {
    const link = await api.createChatInviteLink(config.channelId, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + INVITE_LINK_TTL_SEC,
      name: `user ${userId}`.slice(0, 32)
    });

    return link.invite_link;
  }

  async function getMemberStatus(userId) {
    try {
      const member = await api.getChatMember(config.channelId, Number(userId));
      return member.status;
    } catch (error) {
      return null;
    }
  }

  const notifier = {
    enabled: true,

    // Bir martalik kanal havolasini foydalanuvchiga yuboradi
    async sendAccessLink(userId, expiresAt) {
      const until = expiresAt ? `\nObuna <b>${formatDate(expiresAt)}</b> gacha faol.` : "";

      if (!config.channelId) {
        console.error("❌ CHANNEL_ID o'rnatilmagan");
        return false;
      }

      try {
        await api.unbanChatMember(config.channelId, Number(userId), {
          only_if_banned: true
        });
      } catch (error) {
        /* avval ban bo'lmagan bo'lishi mumkin */
      }

      let inviteLink;

      try {
        inviteLink = await createInviteLink(userId);
      } catch (error) {
        console.error("❌ createChatInviteLink:", error.message);

        return safeSend(
          userId,
          "⚠️ Kanal havolasini yaratib bo'lmadi. Iltimos, admin bilan bog'laning." +
            until,
          config.supportUrl
            ? { reply_markup: new InlineKeyboard().url("💬 Yordam", config.supportUrl) }
            : {}
        );
      }

      return safeSend(
        userId,
        "📢 Premium kanalga kirish uchun tugmani bosing." +
          until +
          "\n\nHavola bir martalik va 24 soat amal qiladi.",
        { reply_markup: new InlineKeyboard().url("📢 Premium kanalga kirish", inviteLink) }
      );
    },

    async sendPaymentConfirmed(userId, expiresAt) {
      await safeSend(
        userId,
        `✅ <b>To'lov qabul qilindi!</b>\nPremium obunangiz <b>${formatDate(expiresAt)}</b> gacha faol.`
      );

      return this.sendAccessLink(userId, expiresAt);
    },

    async removeFromChannel(userId) {
      if (!config.channelId) {
        return;
      }

      const status = await getMemberStatus(userId);

      // Kanal egasi va adminlarga tegmaymiz; kanalda yo'q bo'lsa, qiladigan ish yo'q
      if (status !== "member" && status !== "restricted") {
        return;
      }

      await api.banChatMember(config.channelId, Number(userId));
      await api.unbanChatMember(config.channelId, Number(userId), {
        only_if_banned: true
      });
    },

    async notifyExpired(userId) {
      await safeSend(
        userId,
        "⌛ <b>Obunangiz muddati tugadi.</b>\nPremium kanaldan foydalanishni davom ettirish uchun obunani yangilang.",
        { reply_markup: buyKeyboard() }
      );
    },

    async notifyExpiring(userId, expiresAt) {
      await safeSend(
        userId,
        `🔔 Obunangiz <b>${formatDate(expiresAt)}</b> da tugaydi.\nUzilishsiz foydalanish uchun hozirdan yangilab qo'ying.`,
        { reply_markup: buyKeyboard() }
      );
    }
  };

  /* ---------- Bot buyruqlari ---------- */

  bot.command("start", async (ctx) => {
    await upsertUser(pool, ctx.from);

    const subscription = await getSubscription(pool, ctx.from.id);

    const status = isActive(subscription)
      ? `\n\n✅ Obunangiz <b>${formatDate(subscription.expires_at)}</b> gacha faol.`
      : "";

    await ctx.reply(
      `✨ Assalomu alaykum! LEYLI MEDIA Premium botga xush kelibsiz. Bu yerda yopiq kanal obunasini tez va oson xarid qilishingiz mumkin.` +
        status,
      { parse_mode: "HTML", reply_markup: mainKeyboard() }
    );
  });

  bot.command("paid", async (ctx) => {
    await upsertUser(pool, ctx.from);

    if (!isStaff(ctx.from.id)) {
      return;
    }

    if (!config.ownerTelegramId) {
      await ctx.reply("OWNER_TELEGRAM_ID hali qo‘yilmagan.");
      return;
    }

    const parts = String(ctx.match || "").trim().split(/\s+/);
    const userId = parts[0] || "";
    const amountSom = parts[1] && /^\d+$/.test(parts[1]) ? Number(parts[1]) : 20000;

    if (!/^\d{3,20}$/.test(userId)) {
      await ctx.reply(
        "Payme chekdan <b>ID пользователя</b> ni yozing:\n<code>/paid 6336262541</code>\n\nIxtiyoriy summa: <code>/paid 6336262541 20000</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const approval = await createApproval(pool, {
      telegramUserId: userId,
      amountSom,
      source: isOwner(ctx.from.id) ? "owner" : "admin"
    });

    const sent = await notifyOwnerPayment(approval);

    if (isOwner(ctx.from.id)) {
      return;
    }

    await ctx.reply(
      sent
        ? "Kanal egasiga tasdiq yuborildi."
        : "Tasdiq yuborilmadi. OWNER_TELEGRAM_ID ni tekshiring."
    );
  });

  bot.callbackQuery(/^ok:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Faqat kanal egasi tasdiqlaydi", show_alert: true });
      return;
    }

    const approval = await getApproval(pool, ctx.match[1]);

    if (!approval || approval.status !== "pending") {
      await ctx.answerCallbackQuery({ text: "Bu so‘rov allaqachon yopilgan" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Yuborilmoqda…" });

    try {
      await applyApproval({ pool, notifier, approval });
      await ctx.editMessageText(
        (ctx.callbackQuery.message && ctx.callbackQuery.message.text
          ? ctx.callbackQuery.message.text + "\n\n"
          : "") + "✅ Havola foydalanuvchiga yuborildi."
      );
    } catch (error) {
      console.error("❌ APPROVE:", error.message);
      await ctx.reply("Havolani yuborib bo‘lmadi: " + error.message);
    }
  });

  bot.callbackQuery(/^no:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Faqat kanal egasi", show_alert: true });
      return;
    }

    const approval = await getApproval(pool, ctx.match[1]);

    if (approval && approval.status === "pending") {
      await rejectApproval(pool, approval);
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      (ctx.callbackQuery.message && ctx.callbackQuery.message.text
        ? ctx.callbackQuery.message.text + "\n\n"
        : "") + "❌ Rad etildi. Havola yuborilmadi."
    );
  });

  bot.callbackQuery("check", async (ctx) => {
    await ctx.answerCallbackQuery();

    const subscription = await getSubscription(pool, ctx.from.id);

    if (!isActive(subscription)) {
      await ctx.reply(
        "❌ Faol obuna topilmadi.\nObuna bo'lish uchun tugmani bosing 👇",
        { reply_markup: buyKeyboard() }
      );
      return;
    }

    const status = await getMemberStatus(ctx.from.id);

    if (status === "member" || status === "administrator" || status === "creator") {
      await ctx.reply(
        `✅ Obunangiz faol: <b>${formatDate(subscription.expires_at)}</b> gacha.\nSiz Premium kanaldasiz.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    await notifier.sendAccessLink(ctx.from.id, subscription.expires_at);
  });

  bot.on("message:contact", async (ctx) => {
    const contact = ctx.message.contact;

    if (contact && String(contact.user_id) === String(ctx.from.id) && contact.phone_number) {
      await upsertUser(pool, { ...ctx.from, phone: contact.phone_number });
    }
  });

  bot.on("message", async (ctx) => {
    if (ctx.message.contact) {
      return;
    }

    if (ctx.message.text && ctx.message.text.startsWith("/")) {
      return;
    }

    await ctx.reply("Quyidagi tugmalardan foydalaning 👇", {
      reply_markup: mainKeyboard()
    });
  });

  bot.catch((error) => {
    console.error("❌ BOT ERROR:", error.message);
  });

  const webhookHandler = webhookCallback(bot, "express", {
    secretToken: config.webhookSecret
  });

  // Webhook, buyruqlar va menyu tugmasini Telegram'da sozlaydi
  async function configure() {
    if (!config.publicUrl) {
      console.warn("⚠️ PUBLIC_URL yo'q: webhook o'rnatilmadi");
      return;
    }

    await api.setWebhook(`${config.publicUrl}/telegram/webhook`, {
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    });

    await api.setMyCommands([{ command: "start", description: "Boshlash" }]);

    if (config.ownerTelegramId) {
      await api.setMyCommands(
        [
          { command: "start", description: "Boshlash" },
          { command: "paid", description: "To‘lovni tasdiqlash (User ID)" }
        ],
        { scope: { type: "chat", chat_id: Number(config.ownerTelegramId) } }
      );
    }

    await api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Obuna",
        web_app: { url: webAppUrl }
      }
    });

    console.log("✅ Telegram webhook o'rnatildi");
  }

  return { bot, notifier, webhookHandler, configure };
}

module.exports = { createTelegram, createNoopNotifier, formatDate };
