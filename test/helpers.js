const crypto = require("crypto");
const { newDb } = require("pg-mem");

const { loadConfig } = require("../src/config");
const { initDatabase } = require("../src/db");
const { createApp } = require("../src/app");
const { createNoopNotifier } = require("../src/bot");

function signInitData(botToken, user, authDate) {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAEtest");
  params.set("user", JSON.stringify(user));

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const hash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params.toString();
}

async function createTestEnv(overrides = {}) {
  const mem = newDb();
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  const config = loadConfig({
    PAYME_LOGIN: "Paycom",
    PAYME_KEY: "test_key",
    PAYME_MERCHANT_ID: "merchant-id",
    PAYME_FALLBACK_ID: "fallback-id",
    PAYME_TEST_USER_ID: "12345",
    BOT_TOKEN: "123:ABC",
    CRON_SECRET: "cron-secret",
    ...overrides
  });

  await initDatabase(pool, config);

  const notifier = {
    ...createNoopNotifier(),
    calls: [],
    sendPaymentConfirmed: async (...args) => {
      notifier.calls.push(["paid", ...args]);
    },
    sendAccessLink: async (...args) => {
      notifier.calls.push(["link", ...args]);
    },
    removeFromChannel: async (...args) => {
      notifier.calls.push(["kick", ...args]);
    },
    notifyExpired: async (...args) => {
      notifier.calls.push(["expired", ...args]);
    },
    notifyExpiring: async (...args) => {
      notifier.calls.push(["remind", ...args]);
    }
  };

  const app = createApp({ pool, config, notifier, webhookHandler: null });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  return { pool, config, notifier, server, url: `http://127.0.0.1:${port}` };
}

function paymeAuth(login, key) {
  return "Basic " + Buffer.from(`${login}:${key}`).toString("base64");
}

async function rpc(url, method, params, auth, extraHeaders = {}) {
  const res = await fetch(`${url}/payme`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
      ...extraHeaders
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });

  return { http: res.status, body: await res.json() };
}

module.exports = { signInitData, createTestEnv, paymeAuth, rpc };
