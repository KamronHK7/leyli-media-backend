const { getPlanById, getPlanByAmount, amountTiyin } = require("./config");
const { getSubscription, isActive, grantSubscription } = require("./subscriptions");

function planFromAmountSom(amountSom) {
  if (!amountSom) {
    return getPlanById("month_1");
  }

  return getPlanByAmount(amountTiyin({ priceSom: Number(amountSom) })) || getPlanById("month_1");
}

async function findPendingApproval(pool, telegramUserId) {
  const result = await pool.query(
    `
      SELECT * FROM payment_approvals
      WHERE telegram_user_id = $1 AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1
    `,
    [String(telegramUserId)]
  );

  return result.rows[0] || null;
}

async function getApproval(pool, id) {
  const result = await pool.query(
    `SELECT * FROM payment_approvals WHERE id = $1 LIMIT 1`,
    [Number(id)]
  );

  return result.rows[0] || null;
}

async function createApproval(pool, { telegramUserId, amountSom, fullName, username, source }) {
  const pending = await findPendingApproval(pool, telegramUserId);

  if (pending) {
    return pending;
  }

  const plan = planFromAmountSom(amountSom);

  const inserted = await pool.query(
    `
      INSERT INTO payment_approvals
        (telegram_user_id, plan_id, amount_som, full_name, username, source, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `,
    [
      String(telegramUserId),
      plan.id,
      amountSom ? Number(amountSom) : plan.priceSom,
      fullName || null,
      username || null,
      source || "manual"
    ]
  );

  return inserted.rows[0];
}

async function applyApproval({ pool, notifier, approval }) {
  const userId = String(approval.telegram_user_id);
  const plan = getPlanById(approval.plan_id) || getPlanById("month_1");
  const current = await getSubscription(pool, userId);
  let expiresAt;

  await pool.query(
    `
      INSERT INTO telegram_users (telegram_user_id, first_name, username)
      VALUES ($1, $2, $3)
      ON CONFLICT (telegram_user_id) DO NOTHING
    `,
    [userId, approval.full_name || "mijoz", approval.username || null]
  );

  if (isActive(current)) {
    expiresAt = current.expires_at;
    await notifier.sendAccessLink(userId, expiresAt);
  } else {
    expiresAt = await grantSubscription(pool, userId, plan);
    await notifier.sendPaymentConfirmed(userId, expiresAt);
  }

  await pool.query(
    `
      UPDATE payment_approvals
      SET status = 'approved', resolved_at = NOW()
      WHERE id = $1
    `,
    [approval.id]
  );

  return { expiresAt, granted: !isActive(current) };
}

async function rejectApproval(pool, approval) {
  await pool.query(
    `
      UPDATE payment_approvals
      SET status = 'rejected', resolved_at = NOW()
      WHERE id = $1
    `,
    [approval.id]
  );
}

module.exports = {
  planFromAmountSom,
  findPendingApproval,
  getApproval,
  createApproval,
  applyApproval,
  rejectApproval
};
