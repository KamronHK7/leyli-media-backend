const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnv, paymeAuth, rpc } = require("./helpers");

const AUTH = paymeAuth("Paycom", "test_key");

test("Payme Merchant API sandbox ssenariylari", async (t) => {
  const env = await createTestEnv();
  t.after(() => env.server.close());

  const now = Date.now();
  const account = { user_id: "12345" };
  const amount = 2000000;

  let r = await rpc(env.url, "CheckPerformTransaction", { amount, account }, paymeAuth("Paycom", "wrong"));
  assert.equal(r.http, 200);
  assert.equal(r.body.error.code, -32504);

  r = await rpc(env.url, "CheckPerformTransaction", { amount, account: {} }, AUTH);
  assert.equal(r.body.error.code, -31050);
  assert.equal(r.body.error.data, "user_id");

  r = await rpc(
    env.url,
    "CheckPerformTransaction",
    { amount: 23232222, account: { user_id: "2323uaccuk3223" } },
    AUTH
  );
  assert.equal(r.body.error.code, -31050);
  assert.equal(r.body.error.data, "user_id");

  r = await rpc(env.url, "CheckPerformTransaction", { amount: 50000, account }, AUTH);
  assert.equal(r.body.error.code, -31001);
  assert.equal(r.body.error.data, "amount");

  r = await rpc(env.url, "CheckPerformTransaction", { amount, account }, AUTH);
  assert.equal(r.body.result.allow, true);

  const sandbox = await createTestEnv({
    PAYME_KEY: "prod_key_value",
    PAYME_TEST_KEY: "sandbox_key_value",
    PAYME_TEST_USER_ID: "12345"
  });
  t.after(() => sandbox.server.close());

  r = await rpc(
    sandbox.url,
    "CheckPerformTransaction",
    { amount: 23232222, account: { user_id: "999999999" } },
    paymeAuth("Paycom", "sandbox_key_value"),
    { "Test-Operation": "Paycom" }
  );
  assert.equal(r.body.error.code, -31050);

  r = await rpc(
    sandbox.url,
    "CheckPerformTransaction",
    { amount: 23232222, account: { user_id: "999999999" } },
    paymeAuth("Paycom", "sandbox_key_value")
  );
  assert.equal(r.body.error.code, -32504);

  const sandboxAuth = paymeAuth("Paycom", "sandbox_key_value");
  const sandboxHeaders = { "Test-Operation": "Paycom" };
  r = await rpc(
    sandbox.url,
    "CreateTransaction",
    { id: "sb1", time: now, amount, account },
    sandboxAuth,
    sandboxHeaders
  );
  assert.equal(r.body.result.state, 1);
  r = await rpc(
    sandbox.url,
    "CreateTransaction",
    { id: "sb2", time: now, amount, account },
    sandboxAuth,
    sandboxHeaders
  );
  assert.equal(r.body.result.state, 1);
  r = await rpc(sandbox.url, "PerformTransaction", { id: "sb2" }, sandboxAuth, sandboxHeaders);
  assert.equal(r.body.result.state, 2);

  r = await rpc(env.url, "CreateTransaction", { id: "tx1", time: now, amount, account }, AUTH);
  assert.equal(r.body.result.state, 1);

  r = await rpc(env.url, "CreateTransaction", { id: "tx2", time: now, amount, account }, AUTH);
  assert.equal(r.body.error.code, -31050);

  r = await rpc(env.url, "PerformTransaction", { id: "tx1" }, AUTH);
  assert.equal(r.body.result.state, 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.notifier.calls[0][0], "paid");

  const sub = await env.pool.query(
    `SELECT * FROM subscriptions WHERE telegram_user_id = '12345'`
  );
  assert.ok(new Date(sub.rows[0].expires_at) > new Date());

  r = await rpc(env.url, "CreateTransaction", { id: "tx1", time: now, amount, account }, AUTH);
  assert.equal(r.body.error.code, -31008);

  r = await rpc(env.url, "CancelTransaction", { id: "tx1", reason: 5 }, AUTH);
  assert.equal(r.body.result.state, -2);

  r = await rpc(env.url, "GetStatement", { from: now - 1000, to: now + 1000 }, AUTH);
  assert.equal(r.body.result.transactions.length, 1);
});
