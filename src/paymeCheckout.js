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
  return config.paymeTestMode ? "https://checkout.test.paycom.uz" : "https://checkout.paycom.uz";
}

function buildPayFormUrl({ config, userId, plan }) {
  const params = new URLSearchParams({
    a: String(amountTiyin(plan)),
    uid: String(userId)
  });
  const base = config.publicUrl || "";
  return `${base}/pay?${params}`;
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
  <meta name="color-scheme" content="dark">
  <title>Payme</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #1c1c1e; color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 24px; text-align: center; }
    p { color: #8e8e93; }
    button { margin-top: 16px; border: 0; border-radius: 12px; padding: 14px 22px;
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

module.exports = { buildPayFormUrl, checkoutAction, payFormPage, escapeHtml };
