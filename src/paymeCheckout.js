const { amountTiyin } = require("./config");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function checkoutAction(config) {
  return config.paymeTestMode ? "https://test.paycom.uz" : "https://checkout.paycom.uz";
}

function checkoutReturnUrl(config) {
  const username = String(config.botUsername || "LeyliMedia_bot").replace(/^@/, "");
  return `https://t.me/${username}`;
}

function payerDisplayName(user) {
  const first = String(user?.first_name || "").trim();
  const last = String(user?.last_name || "").trim();
  return [first, last].filter(Boolean).join(" ");
}

function payerUsername(user) {
  const raw = String(user?.username || "")
    .trim()
    .replace(/^@/, "");
  return raw ? "@" + raw : "";
}

function buildPayFormUrl({ config, userId, plan }) {
  const params = new URLSearchParams({
    a: String(amountTiyin(plan)),
    uid: String(userId)
  });
  const base = config.publicUrl || "";
  return `${base}/pay?${params}`;
}

function encodeCheckoutToken(payload) {
  const token = Buffer.from(payload, "utf8").toString("base64");
  return token.includes("/") || token.includes("+") ? encodeURIComponent(token) : token;
}

function decodeCheckoutToken(url) {
  const token = decodeURIComponent(String(url).split("/").pop() || "");
  return Buffer.from(token, "base64").toString("utf8");
}

function buildCheckoutUrl({ config, userId, plan }) {
  const parts = [
    `m=${config.paymeMerchantId}`,
    `ac.user_id=${userId}`,
    `a=${amountTiyin(plan)}`,
    "l=uz"
  ];

  return `${checkoutAction(config)}/${encodeCheckoutToken(parts.join(";"))}`;
}

function paymeAppLinkFromHtml(html) {
  const match = String(html).match(/paycom:\/\/checkout\.paycom\.uz\/[a-f0-9]{24}/i);
  return match ? match[0] : null;
}

async function resolvePaymeAppUrl(checkoutUrl) {
  try {
    const response = await fetch(checkoutUrl, { signal: AbortSignal.timeout(8000) });
    const html = await response.text();
    return paymeAppLinkFromHtml(html) || checkoutUrl;
  } catch (error) {
    console.error("PAYME CHECKOUT:", error.message);
    return checkoutUrl;
  }
}

function payFormPage({ merchant, amount, userId, callback, action }) {
  const m = escapeHtml(merchant);
  const a = escapeHtml(amount);
  const uid = escapeHtml(userId);
  const c = escapeHtml(callback);
  const dest = escapeHtml(action);

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="origin">
  <title>Payme</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #1c1c1e; color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 24px; text-align: center; gap: 12px; }
    p { color: #8e8e93; margin: 0; }
    button { margin-top: 8px; border: 0; border-radius: 12px; padding: 14px 22px;
      background: #14b8a6; color: #fff; font-size: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <p>Payme to‘lov oynasi ochilmoqda…</p>
    <form id="payme" method="POST" action="${dest}">
      <input type="hidden" name="merchant" value="${m}">
      <input type="hidden" name="amount" value="${a}">
      <input type="hidden" name="account[user_id]" value="${uid}">
      <input type="hidden" name="lang" value="uz">
      <input type="hidden" name="callback" value="${c}">
      <input type="hidden" name="callback_timeout" value="15000">
      <input type="hidden" name="description[uz]" value="LEYLI MEDIA">
      <input type="hidden" name="description[ru]" value="LEYLI MEDIA">
      <button type="submit">Payme orqali to‘lash</button>
    </form>
  </div>
  <script>document.getElementById("payme").submit();</script>
</body>
</html>`;
}

module.exports = {
  buildCheckoutUrl,
  buildPayFormUrl,
  paymeAppLinkFromHtml,
  resolvePaymeAppUrl,
  checkoutAction,
  checkoutReturnUrl,
  payFormPage,
  payerDisplayName,
  payerUsername,
  decodeCheckoutToken
};
