const { DAY_MS } = require("./subscriptions");

/*
  Muddati tugagan obunalarni kanaldan chiqaradi va tugashiga yaqin
  foydalanuvchilarga eslatma yuboradi.
  Har bir foydalanuvchi alohida ishlanadi: bittasida xato bo'lsa, qolganlari to'xtamaydi.
*/
async function runExpiryJob({ pool, notifier, config, now = new Date() }) {
  const summary = { expired: 0, reminded: 0, errors: 0 };

  const expired = await pool.query(
    `
      SELECT telegram_user_id, expires_at
      FROM subscriptions
      WHERE expires_at <= $1 AND kicked = FALSE
    `,
    [now]
  );

  for (const row of expired.rows) {
    try {
      await notifier.removeFromChannel(row.telegram_user_id);

      await pool.query(
        `UPDATE subscriptions SET kicked = TRUE, updated_at = NOW()
         WHERE telegram_user_id = $1`,
        [row.telegram_user_id]
      );

      await notifier.notifyExpired(row.telegram_user_id);
      summary.expired += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("❌ EXPIRE ERROR:", row.telegram_user_id, error.message);
    }
  }

  const remindUntil = new Date(now.getTime() + config.remindDays * DAY_MS);

  const expiring = await pool.query(
    `
      SELECT telegram_user_id, expires_at
      FROM subscriptions
      WHERE expires_at > $1
        AND expires_at <= $2
        AND reminded = FALSE
        AND kicked = FALSE
    `,
    [now, remindUntil]
  );

  for (const row of expiring.rows) {
    try {
      await pool.query(
        `UPDATE subscriptions SET reminded = TRUE, updated_at = NOW()
         WHERE telegram_user_id = $1`,
        [row.telegram_user_id]
      );

      await notifier.notifyExpiring(row.telegram_user_id, row.expires_at);
      summary.reminded += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("❌ REMIND ERROR:", row.telegram_user_id, error.message);
    }
  }

  return summary;
}

module.exports = { runExpiryJob };
