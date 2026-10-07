const express = require("express");

const { validateInitData } = require("./telegramAuth");
const { upsertUser } = require("./db");
const { PLANS, publicPlan, getPlanById, amountTiyin } = require("./config");
const { getSubscription, isActive } = require("./subscriptions");

const LINK_COOLDOWN_MS = 20 * 1000;

/*
  Payme checkout havolasi:
  https://checkout.paycom.uz/<base64("m=<kassa>;ac.user_id=<id>;a=<tiyin>;l=uz;c=<qaytish>")>
  Foydalanuvchi Payme'da hech narsa kiritmaydi, faqat to'laydi.
*/
function buildCheckoutUrl({ config, userId, plan }) {
  const parts = [
    `m=${config.paymeMerchantId}`,
    `ac.user_id=${userId}`,
    `a=${amountTiyin(plan)}`,
    "l=uz"
  ];

  if (config.publicUrl) {
    parts.push(`c=${config.publicUrl}/?paid=1`);
  }

  const base = config.paymeTestMode
    ? "https://checkout.test.paycom.uz"
    : "https://checkout.paycom.uz";

  return `${base}/${Buffer.from(parts.join(";")).toString("base64")}`;
}

function createApiRouter({ pool, config, notifier }) {
  const router = express.Router();
  const lastLinkRequest = new Map();

  // Telegram initData orqali foydalanuvchini aniqlash
  router.use((req, res, next) => {
    const header = req.headers.authorization || "";
    const initData = header.startsWith("tma ") ? header.slice(4) : "";
    const user = validateInitData(initData, config.botToken);

    if (!user) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    req.tgUser = user;
    next();
  });

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error("❌ API ERROR:", error);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  };

  function subscriptionView(subscription) {
    if (!subscription) {
      return { active: false, expires_at: null, plan_id: null };
    }

    return {
      active: isActive(subscription),
      expires_at: new Date(subscription.expires_at).toISOString(),
      plan_id: subscription.plan_id
    };
  }

  router.get(
    "/me",
    handle(async (req, res) => {
      await upsertUser(pool, req.tgUser);

      const subscription = await getSubscription(pool, req.tgUser.id);

      res.json({
        ok: true,
        user: {
          id: String(req.tgUser.id),
          first_name: req.tgUser.first_name || "",
          last_name: req.tgUser.last_name || "",
          username: req.tgUser.username || "",
          photo_url: req.tgUser.photo_url || ""
        },
        plans: PLANS.map(publicPlan),
        subscription: subscriptionView(subscription),
        payment_ready: Boolean(config.paymeMerchantId),
        support_url: config.supportUrl || "",
        brand: {
          name: "LEYLI MEDIA",
          bot_username: config.botUsername || "LeyliMedia_bot",
          instagram_url: config.instagramUrl || "",
          youtube_url: config.youtubeUrl || ""
        }
      });
    })
  );

  router.post(
    "/checkout",
    handle(async (req, res) => {
      if (!config.paymeMerchantId) {
        return res.status(503).json({ ok: false, error: "payment_not_configured" });
      }

      const plan = getPlanById(req.body?.plan_id);

      if (!plan) {
        return res.status(400).json({ ok: false, error: "invalid_plan" });
      }

      // Payme CheckPerformTransaction foydalanuvchini bazadan qidiradi
      await upsertUser(pool, req.tgUser);

      res.json({
        ok: true,
        url: buildCheckoutUrl({
          config,
          userId: String(req.tgUser.id),
          plan
        })
      });
    })
  );

  // Faol obunachiga kanal havolasini botga yuboradi
  router.post(
    "/send-link",
    handle(async (req, res) => {
      const userId = String(req.tgUser.id);
      const subscription = await getSubscription(pool, userId);

      if (!isActive(subscription)) {
        return res.status(403).json({ ok: false, error: "no_active_subscription" });
      }

      const last = lastLinkRequest.get(userId) || 0;

      if (Date.now() - last < LINK_COOLDOWN_MS) {
        return res.status(429).json({ ok: false, error: "too_many_requests" });
      }

      lastLinkRequest.set(userId, Date.now());

      await notifier.sendAccessLink(userId, subscription.expires_at);

      res.json({ ok: true });
    })
  );

  return router;
}

module.exports = { createApiRouter, buildCheckoutUrl };
