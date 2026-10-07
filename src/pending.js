const { getPlanById } = require("./config");
const { getSubscription, isActive, grantSubscription } = require("./subscriptions");

const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

async function savePendingPayment(pool, telegramUserId, planId) {
  await pool.query(
    `
      INSERT INTO pending_payments
        (telegram_user_id, plan_id, created_at, claimed_at)
      VALUES
        ($1, $2, NOW(), NULL)
      ON CONFLICT (telegram_user_id)
      DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        created_at = NOW(),
        claimed_at = NULL
    `,
    [String(telegramUserId), planId]
  );
}

async function markPendingClaimed(pool, telegramUserId) {
  await pool.query(
    `
      UPDATE pending_payments
      SET claimed_at = NOW()
      WHERE telegram_user_id = $1 AND claimed_at IS NULL
    `,
    [String(telegramUserId)]
  );
}

async function wasRecentlyClaimed(pool, telegramUserId, now = new Date()) {
  const result = await pool.query(
    `
      SELECT claimed_at
      FROM pending_payments
      WHERE telegram_user_id = $1 AND claimed_at IS NOT NULL
      LIMIT 1
    `,
    [String(telegramUserId)]
  );

  const claimedAt = result.rows[0]?.claimed_at;

  if (!claimedAt) {
    return false;
  }

  return now.getTime() - new Date(claimedAt).getTime() < PENDING_TTL_MS;
}

async function getUnclaimedPending(pool, telegramUserId, now = new Date()) {
  const result = await pool.query(
    `SELECT * FROM pending_payments WHERE telegram_user_id = $1 LIMIT 1`,
    [String(telegramUserId)]
  );

  const row = result.rows[0];

  if (!row || row.claimed_at) {
    return null;
  }

  if (now.getTime() - new Date(row.created_at).getTime() > PENDING_TTL_MS) {
    return null;
  }

  return row;
}

/*
  Payme Merchant API kelmasa ham, foydalanuvchi to'lovdan qaytgach
  (yoki /start bosgach) kutilayotgan obunani ochadi.
*/
async function claimPendingPayment({ pool, notifier, telegramUserId, now = new Date() }) {
  const userId = String(telegramUserId);
  const current = await getSubscription(pool, userId);

  if (isActive(current, now)) {
    await markPendingClaimed(pool, userId);
    return {
      ok: true,
      granted: false,
      already: true,
      expires_at: current.expires_at
    };
  }

  const pending = await getUnclaimedPending(pool, userId, now);

  if (!pending) {
    return { ok: false, error: "no_pending" };
  }

  const plan = getPlanById(pending.plan_id);

  if (!plan) {
    return { ok: false, error: "invalid_plan" };
  }

  const expiresAt = await grantSubscription(pool, userId, plan, now);
  await markPendingClaimed(pool, userId);

  console.log("🔓 CLAIM:", userId, plan.id, expiresAt.toISOString());

  if (notifier && notifier.sendPaymentConfirmed) {
    await notifier.sendPaymentConfirmed(userId, expiresAt);
  }

  return {
    ok: true,
    granted: true,
    already: false,
    plan: plan.id,
    expires_at: expiresAt
  };
}

module.exports = {
  PENDING_TTL_MS,
  savePendingPayment,
  markPendingClaimed,
  wasRecentlyClaimed,
  getUnclaimedPending,
  claimPendingPayment
};
