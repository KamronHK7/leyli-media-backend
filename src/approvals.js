const { getPlanById, getPlanByAmount, amountTiyin } = require("./config");
const { DAY_MS, getSubscription, isActive, grantSubscription } = require("./subscriptions");

function planFromAmountSom(amountSom) {
  if (!amountSom) {
    return getPlanById("month_1");
  }

  return getPlanByAmount(amountTiyin({ priceSom: Number(amountSom) })) || getPlanById("month_1");
}

function parsePlanToken(token) {
  const raw = String(token || "").trim().toLowerCase();

  if (!raw) {
    return null;
  }

  const compact = raw.replace(/[^a-z0-9]/g, "");

  if (compact === "6" || compact === "6oy" || compact === "month6") {
    return getPlanById("month_6");
  }

  if (compact === "1" || compact === "1oy" || compact === "month1") {
    return getPlanById("month_1");
  }

  if (/^\d+$/.test(raw)) {
    return getPlanByAmount(amountTiyin({ priceSom: Number(raw) }));
  }

  return getPlanById(raw) || getPlanById(compact);
}

function parseStaffGrantText(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length || !/^\d{3,20}$/.test(parts[0])) {
    return null;
  }

  return {
    userId: parts[0],
    plan: parts[1] ? parsePlanToken(parts[1]) : null
  };
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
  const plan = planFromAmountSom(amountSom);
  const pending = await findPendingApproval(pool, telegramUserId);

  if (pending) {
    if (pending.plan_id === plan.id) {
      return pending;
    }

    const updated = await pool.query(
      `
        UPDATE payment_approvals
        SET plan_id = $2, amount_som = $3
        WHERE id = $1
        RETURNING *
      `,
      [pending.id, plan.id, amountSom ? Number(amountSom) : plan.priceSom]
    );

    return updated.rows[0];
  }

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
  const remainingMs = isActive(current)
    ? new Date(current.expires_at).getTime() - Date.now()
    : 0;
  const alreadyCovered = remainingMs >= plan.days * DAY_MS - 60 * 1000;
  let expiresAt;

  await pool.query(
    `
      INSERT INTO telegram_users (telegram_user_id, first_name, username)
      VALUES ($1, $2, $3)
      ON CONFLICT (telegram_user_id) DO NOTHING
    `,
    [userId, approval.full_name || "mijoz", approval.username || null]
  );

  if (alreadyCovered) {
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

  return { expiresAt, granted: !alreadyCovered };
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
  parsePlanToken,
  parseStaffGrantText,
  findPendingApproval,
  getApproval,
  createApproval,
  applyApproval,
  rejectApproval
};
