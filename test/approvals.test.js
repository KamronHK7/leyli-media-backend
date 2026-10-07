const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnv } = require("./helpers");
const {
  createApproval,
  applyApproval,
  getApproval,
  parseStaffGrantText,
  planFromAmountSom
} = require("../src/approvals");
const { DAY_MS, grantSubscription, getSubscription } = require("../src/subscriptions");
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

test("6 oylik summa month_6 tarifini ochadi, 1 oylikdan keyin muddatni uzaytiradi", async (t) => {
  const env = await createTestEnv();
  t.after(() => env.server.close());

  assert.equal(planFromAmountSom(109000).id, "month_6");
  assert.equal(parseStaffGrantText("6336262541").plan, null);
  assert.equal(parseStaffGrantText("6336262541 6").plan.id, "month_6");
  assert.equal(parseStaffGrantText("6336262541 109000").plan.id, "month_6");

  const month1 = await createApproval(env.pool, {
    telegramUserId: "7000000001",
    amountSom: 20000
  });
  await applyApproval({ pool: env.pool, notifier: env.notifier, approval: month1 });

  const month6 = await createApproval(env.pool, {
    telegramUserId: "7000000001",
    amountSom: 109000
  });
  assert.equal(month6.plan_id, "month_6");

  const result = await applyApproval({
    pool: env.pool,
    notifier: env.notifier,
    approval: month6
  });

  assert.equal(result.granted, true);
  const sub = await getSubscription(env.pool, "7000000001");
  assert.equal(sub.plan_id, "month_6");
  const days = (new Date(sub.expires_at).getTime() - Date.now()) / DAY_MS;
  assert.ok(days > 200 && days < 211);
});
