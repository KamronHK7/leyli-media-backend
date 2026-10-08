const { loadConfig } = require("./src/config");
const { createPool, initDatabase } = require("./src/db");
const { createTelegram } = require("./src/bot");
const { createApp } = require("./src/app");
const { runExpiryJob, recoverMissedPayments, applyManualGrants } = require("./src/jobs");

const EXPIRY_JOB_INTERVAL_MS = 10 * 60 * 1000;

async function start() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    await initDatabase(pool, config);

    const telegram = createTelegram({ pool, config });
    const app = createApp({
      pool,
      config,
      notifier: telegram.notifier,
      webhookHandler: telegram.webhookHandler
    });

    app.listen(config.port, () => {
      console.log(`🚀 Leyli Media ${config.port}-portda ishga tushdi`);
    });

    // Webhook'ni server ishga tushgandan keyin o'rnatamiz; xato bo'lsa ham server ishlayveradi
    telegram
      .configure()
      .catch((error) => {
        console.error("❌ Telegram sozlanmadi:", error.message);
      })
      .then(() => recoverMissedPayments({ pool, notifier: telegram.notifier }))
      .then(() => applyManualGrants({ pool, notifier: telegram.notifier }))
      .catch((error) => {
        console.error("❌ RECOVER:", error.message);
      });

    if (telegram.notifier.enabled) {
      const tick = () =>
        runExpiryJob({ pool, notifier: telegram.notifier, config }).catch(
          (error) => console.error("❌ EXPIRY JOB:", error.message)
        );

      setInterval(tick, EXPIRY_JOB_INTERVAL_MS).unref();
      setTimeout(tick, 15 * 1000).unref();
    }
  } catch (error) {
    console.error("❌ Server ishga tushmadi:", error);
    process.exit(1);
  }
}

start();
