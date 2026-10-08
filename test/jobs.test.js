const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnv } = require("./helpers");
const { grantSubscription } = require("../src/subscriptions");
const { getPlanById } = require("../src/config");
const { runExpiryJob, recoverMissedPayments, applyManualGrants } = require("../src/jobs");

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

test("To'lov o'tib ketganda obunani qo'lda ochish", async (t) => {
  const env = await createTestEnv();
  t.after(() => env.server.close());

  let res = await fetch(`${env.url}/cron/grant?secret=wrong&user_id=2096644395`);
  assert.equal(res.status, 401);

  res = await fetch(`${env.url}/cron/grant?secret=cron-secret&user_id=abc`);
  assert.equal(res.status, 400);

  res = await fetch(
    `${env.url}/cron/grant?secret=cron-secret&user_id=2096644395&plan=month_1`
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.user_id, "2096644395");
  assert.equal(body.plan, "month_1");
  assert.ok(new Date(body.expires_at) > new Date());
  assert.equal(env.notifier.calls.some((c) => c[0] === "paid"), true);

  const sub = await env.pool.query(
    `SELECT * FROM subscriptions WHERE telegram_user_id = '2096644395'`
  );
  assert.equal(sub.rows.length, 1);

  const recovered = await recoverMissedPayments({
    pool: env.pool,
    notifier: env.notifier
  });
  assert.equal(recovered.skipped, 1);
  assert.equal(recovered.granted, 4);
});

test("O'tib ketgan to'lovni server ishga tushganda tiklash", async (t) => {
  const env = await createTestEnv();
  t.after(() => env.server.close());

  const first = await recoverMissedPayments({
    pool: env.pool,
    notifier: env.notifier
  });
  assert.equal(first.granted, 5);
  assert.equal(env.notifier.calls.some((c) => c[0] === "paid"), true);

  const second = await recoverMissedPayments({
    pool: env.pool,
    notifier: env.notifier
  });
  assert.equal(second.granted, 0);
  assert.equal(second.skipped, 5);
});

test("Qo'lda ochilgan obuna qayta deployda ikki qilmaydi", async (t) => {
  const env = await createTestEnv();
  t.after(() => env.server.close());

  const first = await applyManualGrants({
    pool: env.pool,
    notifier: env.notifier
  });
  assert.equal(first.granted, 2);

  const sub = await env.pool.query(
    `SELECT * FROM subscriptions WHERE telegram_user_id = '2096644395'`
  );
  assert.equal(sub.rows.length, 1);
  const firstExpiry = new Date(sub.rows[0].expires_at).getTime();

  const second = await applyManualGrants({
    pool: env.pool,
    notifier: env.notifier
  });
  assert.equal(second.granted, 0);
  assert.equal(second.skipped, 2);

  const again = await env.pool.query(
    `SELECT * FROM subscriptions WHERE telegram_user_id = '2096644395'`
  );
  assert.equal(new Date(again.rows[0].expires_at).getTime(), firstExpiry);
});
