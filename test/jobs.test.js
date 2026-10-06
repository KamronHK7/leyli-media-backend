const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnv } = require("./helpers");
const { grantSubscription } = require("../src/subscriptions");
const { getPlanById } = require("../src/config");
const { runExpiryJob } = require("../src/jobs");

test("Muddat tugagach kanaldan chiqarish va eslatma yuborish", async (t) => {
  const env = await createTestEnv();
  t.after(() => env.server.close());

  const plan = getPlanById("month_1");
  const now = new Date("2026-10-07T00:00:00Z");

  await env.pool.query(
    `INSERT INTO telegram_users (telegram_user_id, first_name) VALUES ('1','A'), ('2','B')`
  );

  await grantSubscription(env.pool, "1", plan, new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000));
  await grantSubscription(env.pool, "2", plan, new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000));

  const summary = await runExpiryJob({
    pool: env.pool,
    notifier: env.notifier,
    config: env.config,
    now
  });

  assert.equal(summary.expired, 1);
  assert.equal(summary.reminded, 1);
  assert.equal(env.notifier.calls.some((c) => c[0] === "kick"), true);
  assert.equal(env.notifier.calls.some((c) => c[0] === "remind"), true);
});
