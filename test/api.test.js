const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnv, signInitData } = require("./helpers");

test("Mini app API Telegram initData ni tekshiradi va checkout havolasini yasaydi", async (t) => {
  const env = await createTestEnv({
    PUBLIC_URL: "https://leyli-media-backend.onrender.com"
  });
  t.after(() => env.server.close());

  const user = { id: 777, first_name: "Kamron", username: "kamron" };
  const initData = signInitData(env.config.botToken, user, Math.floor(Date.now() / 1000));

  let res = await fetch(`${env.url}/api/me`, {
    headers: { Authorization: "tma " + initData }
  });
  let body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.user.id, "777");
  assert.equal(body.plans.length, 2);
  assert.equal(body.plans[0].price, 20000);
  assert.equal(body.plans[1].price, 109000);
  assert.equal(body.plans[1].old_price, 120000);
  assert.equal(body.subscription.active, false);

  res = await fetch(`${env.url}/api/checkout`, {
    method: "POST",
    headers: {
      Authorization: "tma " + initData,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ plan_id: "month_1" })
  });
  body = await res.json();

  assert.equal(body.ok, true);
  const token = decodeURIComponent(body.url.split("/").pop());
  assert.equal(token.includes("/"), false);
  const decoded = Buffer.from(token, "base64").toString("utf8");
  assert.match(decoded, /ac\.user_id=777/);
  assert.match(decoded, /a=2000000/);
  assert.match(decoded, /m=merchant-id/);
  assert.match(decoded, /\/paid$/);
  assert.equal(decoded.includes("?"), false);

  res = await fetch(`${env.url}/api/checkout`, {
    method: "POST",
    headers: {
      Authorization: "tma " + initData,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ plan_id: "month_6" })
  });
  body = await res.json();
  const decodedSix = Buffer.from(body.url.split("/").pop(), "base64").toString("utf8");
  assert.match(decodedSix, /a=10900000/);

  res = await fetch(`${env.url}/api/me`);
  assert.equal(res.status, 401);
});
