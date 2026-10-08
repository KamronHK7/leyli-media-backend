const path = require("path");
const crypto = require("crypto");
const express = require("express");

const { getPlanById, getPlanByAmount } = require("./config");
const { createPaymeRouter, rpcError, MESSAGES } = require("./payme");
const { createApiRouter } = require("./api");
const { runExpiryJob } = require("./jobs");
const { grantSubscription } = require("./subscriptions");
const { buildCheckoutUrl, resolvePaymeLaunch, payLaunchPage } = require("./paymeCheckout");

function cronAuthorized(req, config) {
  const given = String(req.query.secret || "");

  return Boolean(
    config.cronSecret &&
      given.length === config.cronSecret.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(config.cronSecret))
  );
}

function createApp({ pool, config, notifier, webhookHandler }) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  /* Render uyg'otish va holat tekshiruvi */
  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, database: "connected" });
    } catch (error) {
      console.error("❌ HEALTH:", error.message);
      res.status(500).json({ ok: false, database: "error" });
    }
  });

  /* Payme Merchant API — faqat POST JSON-RPC. GET brauzerda ochilsa ham 404 bo'lmasin. */
  app.get("/payme", (req, res) => {
    res.json({
      ok: true,
      service: "payme",
      method: "POST"
    });
  });

  app.use(
    "/payme",
    createPaymeRouter({
      pool,
      config,
      hooks: {
        onPerformed: ({ telegramUserId, expiresAt }) =>
          notifier.sendPaymentConfirmed(telegramUserId, expiresAt)
      }
    })
  );

  function allowMiniAppCors(req, res, next) {
    const origin = String(req.headers.origin || "");

    if (
      origin === "https://ksarvinoz54-netizen.github.io" ||
      origin === "https://leyli-media-backend.onrender.com"
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  }

  /* Mini app uchun API */
  app.use("/api", allowMiniAppCors, createApiRouter({ pool, config, notifier }));

  /* Telegram webhook */
  if (webhookHandler) {
    app.post("/telegram/webhook", webhookHandler);
  }

  /*
    Muddat tugashi vazifasi. Server o'zi ham har 10 daqiqada ishga tushiradi,
    lekin Render Free uxlab qolsa, tashqi cron shu manzilni chaqirishi mumkin:
    GET /cron/expire?secret=CRON_SECRET
  */
  app.get("/cron/expire", async (req, res) => {
    if (!cronAuthorized(req, config)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    try {
      const summary = await runExpiryJob({ pool, notifier, config });
      res.json({ ok: true, ...summary });
    } catch (error) {
      console.error("❌ CRON:", error);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  /*
    Payme pul oldi, lekin Merchant API chaqirmasa (endpoint ishlamasa)
    obunani qo'lda ochish: GET /cron/grant?secret=CRON_SECRET&user_id=...&plan=month_1
  */
  app.get("/cron/grant", async (req, res) => {
    if (!cronAuthorized(req, config)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const userId = String(req.query.user_id || "").trim();
    const plan = getPlanById(String(req.query.plan || "month_1"));

    if (!/^\d{1,20}$/.test(userId) || !plan) {
      return res.status(400).json({ ok: false, error: "bad_params" });
    }

    try {
      await pool.query(
        `
          INSERT INTO telegram_users (telegram_user_id, first_name)
          VALUES ($1, 'mijoz')
          ON CONFLICT (telegram_user_id) DO NOTHING
        `,
        [userId]
      );

      const expiresAt = await grantSubscription(pool, userId, plan);
      console.log("🔓 GRANT:", userId, plan.id, expiresAt.toISOString());

      try {
        await notifier.sendPaymentConfirmed(userId, expiresAt);
      } catch (error) {
        console.error("❌ GRANT BOT:", error.message);
      }

      res.json({
        ok: true,
        user_id: userId,
        plan: plan.id,
        expires_at: expiresAt
      });
    } catch (error) {
      console.error("❌ GRANT:", error);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  /*
    checkout.paycom.uz havolasini Payme ilovasi bosh sahifada ochadi.
    /pay chekni yaratadi va brauzerdan paycom:// chekiga o'tkazadi.
  */
  app.get("/pay", async (req, res) => {
    const amount = String(req.query.a || "");
    const userId = String(req.query.uid || "");
    const plan = getPlanByAmount(amount);

    if (!config.paymeMerchantId || !plan || !/^\d{1,20}$/.test(userId)) {
      res.status(400).type("html").send("<p>To‘lov parametrlari noto‘g‘ri.</p>");
      return;
    }

    try {
      const launch = await resolvePaymeLaunch(
        buildCheckoutUrl({
          config,
          userId,
          plan
        })
      );

      if (!launch) {
        res.status(502).type("html").send("<p>Payme chekini ochib bo‘lmadi.</p>");
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.status(200).type("html").send(payLaunchPage(launch));
    } catch (error) {
      console.error("❌ PAY:", error.message);
      res.status(502).type("html").send("<p>Payme chekini ochib bo‘lmadi.</p>");
    }
  });

  /* Mini app (statik fayllar) */
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));
  app.get("/paid", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  /* Xatolar: Payme uchun doim RPC formatida, HTTP 200 */
  app.use((err, req, res, next) => {
    const isPayme = req.originalUrl.startsWith("/payme");

    if (err && err.type === "entity.parse.failed") {
      return isPayme
        ? rpcError(res, null, -32700, MESSAGES.parseError)
        : res.status(400).json({ ok: false, error: "invalid_json" });
    }

    console.error("❌ SERVER ERROR:", err);

    return isPayme
      ? rpcError(res, null, -32400, MESSAGES.systemError)
      : res.status(500).json({ ok: false, error: "server_error" });
  });

  return app;
}

module.exports = { createApp };
