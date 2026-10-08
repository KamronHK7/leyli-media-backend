const { getPlanById } = require("./config");
const { DAY_MS, getSubscription, isActive, grantSubscription } = require("./subscriptions");

/*
  Payme pul oldi, lekin Merchant API (PerformTransaction) bizga
  kelmagan to'lovlar. Server ishga tushganda bir marta tiklanadi.
  Faol obuna bo'lsa, qayta qo'shilmaydi.
*/
const MISSED_PAYMENTS = [
  { userId: "2096644395", planId: "month_1", firstName: "asaradarachukara" },
  { userId: "6336262541", planId: "month_1", firstName: "Usmonkhodja" },
  { userId: "6416642759", planId: "month_1", firstName: "mijoz" },
  { userId: "1384872047", planId: "month_1", firstName: "Ibrohim" }
];

async function recoverMissedPayments({ pool, notifier }) {
  const summary = { granted: 0, skipped: 0, errors: 0 };

  for (const item of MISSED_PAYMENTS) {
    try {
      const plan = getPlanById(item.planId);

      if (!plan) {
        continue;
      }

      const current = await getSubscription(pool, item.userId);

      if (isActive(current)) {
        summary.skipped += 1;
        continue;
      }

      await pool.query(
        `
          INSERT INTO telegram_users (telegram_user_id, first_name)
          VALUES ($1, $2)
          ON CONFLICT (telegram_user_id) DO NOTHING
        `,
        [item.userId, item.firstName || "mijoz"]
      );

      const expiresAt = await grantSubscription(pool, item.userId, plan);
      console.log("🔓 RECOVER:", item.userId, plan.id, expiresAt.toISOString());
      await notifier.sendPaymentConfirmed(item.userId, expiresAt);
      summary.granted += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("❌ RECOVER:", item.userId, error.message);
    }
  }

  return summary;
}

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

module.exports = { runExpiryJob, recoverMissedPayments };
