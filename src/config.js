require("dotenv").config();

const crypto = require("crypto");

/*
  TARIFLAR
  Yangi tarif qo'shish uchun shu ro'yxatga yana bitta obyekt qo'shing.
  Payme summani tiyinda yuboradi: 1 so'm = 100 tiyin.
*/
const PLANS = [
  {
    id: "month_1",
    title: "1 oylik",
    days: 30,
    priceSom: 20000
  }
];

function amountTiyin(plan) {
  return plan.priceSom * 100;
}

function getPlanById(id) {
  return PLANS.find((plan) => plan.id === id) || null;
}

function getPlanByAmount(amount) {
  return PLANS.find((plan) => amountTiyin(plan) === Number(amount)) || null;
}

function publicPlan(plan) {
  return {
    id: plan.id,
    title: plan.title,
    days: plan.days,
    price: plan.priceSom
  };
}

function trimSlash(value) {
  return value ? String(value).replace(/\/+$/, "") : "";
}

function loadConfig(env = process.env) {
  const botToken = env.BOT_TOKEN || "";

  return {
    port: env.PORT || 3000,
    databaseUrl: env.DATABASE_URL,

    botToken,
    channelId: env.CHANNEL_ID || "",
    supportUrl: env.SUPPORT_URL || "",

    publicUrl: trimSlash(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL),
    webhookSecret:
      env.TELEGRAM_WEBHOOK_SECRET ||
      (botToken
        ? crypto
            .createHash("sha256")
            .update("webhook:" + botToken)
            .digest("hex")
            .slice(0, 32)
        : ""),
    cronSecret: env.CRON_SECRET || "",

    paymeLogin: env.PAYME_LOGIN || "",
    paymeKey: env.PAYME_KEY || "",
    paymeMerchantId: env.PAYME_MERCHANT_ID || "",
    paymeTestMode: env.PAYME_TEST_MODE === "true",
    paymeTestUserId: env.PAYME_TEST_USER_ID || "",

    // To'lanmagan Payme tranzaksiyasi 12 soatdan keyin bekor qilinadi
    transactionTimeoutMs: 12 * 60 * 60 * 1000,
    // Obuna tugashiga necha kun qolganda eslatma yuboriladi
    remindDays: 3
  };
}

module.exports = {
  PLANS,
  amountTiyin,
  getPlanById,
  getPlanByAmount,
  publicPlan,
  loadConfig
};
