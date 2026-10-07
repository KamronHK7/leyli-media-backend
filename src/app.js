const path = require("path");
const crypto = require("crypto");
const express = require("express");

const { createPaymeRouter, rpcError, MESSAGES } = require("./payme");
const { createApiRouter } = require("./api");
const { runExpiryJob } = require("./jobs");
const { payFormPage, checkoutAction } = require("./paymeCheckout");

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

  /* Payme Merchant API */
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

  /* Mini app uchun API */
  app.use("/api", createApiRouter({ pool, config, notifier }));

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
    const given = String(req.query.secret || "");

    const allowed =
      config.cronSecret &&
      given.length === config.cronSecret.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(config.cronSecret));

    if (!allowed) {
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
    checkout.paycom.uz/{token} ni to'g'ridan-to'g'ri ochish Payme ilovasini
    bosh sahifaga olib ketadi (Universal Links) va Telegram "request cancelled"
    ko'rsatadi. Avval o'z /pay sahifamiz ochiladi, u POST ni path "/" ga
    yuboradi — ilova ushlamaydi, to'lov formasi chiqadi.
  */
  app.get("/pay", (req, res) => {
    const amount = String(req.query.a || "");
    const userId = String(req.query.uid || "");
    const merchant = config.paymeMerchantId || "";
    const callback = config.publicUrl ? `${config.publicUrl}/paid` : "";

    if (!merchant || !/^\d{3,12}$/.test(amount) || !/^\d{1,20}$/.test(userId)) {
      res.status(400).type("html").send("<p>To‘lov parametrlari noto‘g‘ri.</p>");
      return;
    }

    res
      .status(200)
      .type("html")
      .send(
        payFormPage({
          merchant,
          amount,
          userId,
          callback,
          action: checkoutAction(config)
        })
      );
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
