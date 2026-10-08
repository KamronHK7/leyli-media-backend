const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnv, signInitData } = require("./helpers");
const { decodeCheckoutToken } = require("../src/paymeCheckout");

test("Mini app API Telegram initData ni tekshiradi va checkout havolasini yasaydi", async (t) => {
  const env = await createTestEnv({
    PUBLIC_URL: "https://leyli-media-backend.onrender.com"
  });
  t.after(() => env.server.close());

  const user = {
    id: 777,
    first_name: "Kamronbek",
    last_name: "Xoliqov",
    username: "kamron"
  };
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
  assert.match(body.url, /^https:\/\/checkout\.paycom\.uz\//);
  const decoded = decodeCheckoutToken(body.url);
  assert.match(decoded, /(?:^|;)m=merchant-id(?:;|$)/);
  assert.match(decoded, /(?:^|;)ac\.user_id=777(?:;|$)/);
  assert.equal(decoded.includes("ac.full_name"), false);
  assert.equal(decoded.includes("ac.username"), false);
  assert.equal(decoded.includes("ac.phone_number"), false);
  assert.match(decoded, /(?:^|;)a=2000000(?:;|$)/);
  assert.equal(decoded.includes("?"), false);
  assert.equal(body.url.includes("payme.uz/fallback"), false);

  res = await fetch(`${env.url}/pay?a=2000000&uid=777`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /name="merchant" value="merchant-id"/);
  assert.match(html, /name="amount" value="2000000"/);
  assert.match(html, /name="account\[user_id\]" value="777"/);
  assert.equal(html.includes("account[full_name]"), false);
  assert.equal(html.includes("account[username]"), false);
  assert.equal(html.includes("account[phone_number]"), false);
  assert.match(html, /action="https:\/\/checkout\.paycom\.uz"/);

  res = await fetch(`${env.url}/api/checkout`, {
    method: "POST",
    headers: {
      Authorization: "tma " + initData,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ plan_id: "month_6" })
  });
  body = await res.json();
  assert.match(decodeCheckoutToken(body.url), /(?:^|;)a=10900000(?:;|$)/);

  res = await fetch(`${env.url}/payme`);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "payme");

  res = await fetch(`${env.url}/pay`);
  assert.equal(res.status, 400);

  res = await fetch(`${env.url}/api/me`);
  assert.equal(res.status, 401);
});
