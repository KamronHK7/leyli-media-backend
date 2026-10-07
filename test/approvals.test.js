const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnv } = require("./helpers");
const { createApproval, applyApproval, getApproval } = require("../src/approvals");
const { grantSubscription } = require("../src/subscriptions");
const { getPlanById } = require("../src/config");

test("Kanal egasi tasdiqlagach obuna ochiladi, qayta tasdiq muddatni ikki qilmaydi", async (t) => {
  const env = await createTestEnv();
  t.after(() => env.server.close());

  const first = await createApproval(env.pool, {
    telegramUserId: "6336262541",
    amountSom: 20000,
    fullName: "Usmonkhodja",
    username: "sattorxonovvu"
  });

  assert.equal(first.status, "pending");
  assert.equal(first.plan_id, "month_1");

  const again = await createApproval(env.pool, {
    telegramUserId: "6336262541",
    amountSom: 20000
  });
  assert.equal(again.id, first.id);

  const result = await applyApproval({
    pool: env.pool,
    notifier: env.notifier,
    approval: first
  });

  assert.equal(result.granted, true);
  assert.equal(env.notifier.calls.some((c) => c[0] === "paid"), true);

  const saved = await getApproval(env.pool, first.id);
  assert.equal(saved.status, "approved");

  await grantSubscription(env.pool, "2096644395", getPlanById("month_1"));
  const second = await createApproval(env.pool, {
    telegramUserId: "2096644395",
    amountSom: 20000
  });
  const relink = await applyApproval({
    pool: env.pool,
    notifier: env.notifier,
    approval: second
  });
  assert.equal(relink.granted, false);
  assert.equal(env.notifier.calls.some((c) => c[0] === "link"), true);
});
