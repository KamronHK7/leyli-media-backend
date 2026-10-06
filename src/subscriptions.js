const DAY_MS = 24 * 60 * 60 * 1000;

async function getSubscription(pool, telegramUserId) {
  const result = await pool.query(
    `SELECT * FROM subscriptions WHERE telegram_user_id = $1 LIMIT 1`,
    [String(telegramUserId)]
  );

  return result.rows[0] || null;
}

function isActive(subscription, now = new Date()) {
  return Boolean(
    subscription && new Date(subscription.expires_at).getTime() > now.getTime()
  );
}

/*
  Obunani uzaytiradi. Faol obuna bor bo'lsa, yangi muddat mavjud muddatning
  ustiga qo'shiladi (to'langan kunlar yo'qolmaydi).
*/
async function grantSubscription(pool, telegramUserId, plan, now = new Date()) {
  const current = await getSubscription(pool, telegramUserId);

  const base =
    current && isActive(current, now)
      ? new Date(current.expires_at).getTime()
      : now.getTime();

  const expiresAt = new Date(base + plan.days * DAY_MS);

  await pool.query(
    `
      INSERT INTO subscriptions
        (telegram_user_id, plan_id, expires_at, reminded, kicked, updated_at)
      VALUES
        ($1, $2, $3, FALSE, FALSE, NOW())
      ON CONFLICT (telegram_user_id)
      DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        expires_at = EXCLUDED.expires_at,
        reminded = FALSE,
        kicked = FALSE,
        updated_at = NOW()
    `,
    [String(telegramUserId), plan.id, expiresAt]
  );

  return expiresAt;
}

/*
  To'lov qaytarilganda (Payme CancelTransaction, state -2) to'langan kunlarni
  ayiradi. Muddat o'tib ketsa, obuna darhol tugagan hisoblanadi.
*/
async function revokeSubscription(pool, telegramUserId, plan) {
  const current = await getSubscription(pool, telegramUserId);

  if (!current) {
    return null;
  }

  // Kamaytirilgan sana o'tmishda bo'lsa, obuna o'z-o'zidan tugagan hisoblanadi
  const expiresAt = new Date(
    new Date(current.expires_at).getTime() - plan.days * DAY_MS
  );

  await pool.query(
    `
      UPDATE subscriptions
      SET expires_at = $2, kicked = FALSE, updated_at = NOW()
      WHERE telegram_user_id = $1
    `,
    [String(telegramUserId), expiresAt]
  );

  return expiresAt;
}

module.exports = {
  DAY_MS,
  getSubscription,
  isActive,
  grantSubscription,
  revokeSubscription
};
