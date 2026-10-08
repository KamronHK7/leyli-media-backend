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

function paymeLaunchFromHtml(html) {
  const source = String(html);
  const found = source.match(/paycom:\/\/checkout\.paycom\.uz\/([a-f0-9]{24})/i);

  if (!found) {
    return null;
  }

  const id = found[1];
  const actionMatch = source.match(/<form[^>]*\saction="([^"]+)"/i);
  const receiptMatch = source.match(/name="receipt"\s+value="([^"]*)"/i);
  const action = actionMatch
    ? actionMatch[1].replace(/&#x3D;/gi, "=").replace(/&amp;/g, "&")
    : `https://payme.uz/quick/checkout/${id}/start?back=null&timeout=15000&lang=uz`;

  return {
    appLink: found[0],
    id,
    action,
    receipt: receiptMatch ? receiptMatch[1] : ""
  };
}

async function resolvePaymeLaunch(checkoutUrl) {
  const response = await fetch(checkoutUrl, { signal: AbortSignal.timeout(8000) });
  const html = await response.text();
  return paymeLaunchFromHtml(html);
}

function payLaunchPage({ appLink, id, action, receipt }) {
  const link = JSON.stringify(appLink);
  const intent = JSON.stringify(
    `intent://checkout.paycom.uz/${id}#Intent;scheme=paycom;package=uz.dida.payme;end`
  );
  const dest = escapeHtml(action);
  const cheque = escapeHtml(receipt || "");

  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payme</title>
</head>
<body>
  <p>Payme ilovasida to‘lov ochilmoqda…</p>
  <form name="redirect" method="POST" action="${dest}">
    <input type="hidden" name="receipt" value="${cheque}">
    <input type="hidden" name="lang" value="uz">
    <input type="hidden" name="callback" value="">
    <button type="submit">To‘lash</button>
  </form>
  <script>
    (function () {
      var agent = (navigator.userAgent || "").toLowerCase();
      var appLink = ${link};
      var intent = ${intent};
      document.location = agent.indexOf("android") !== -1 ? intent : appLink;
      setTimeout(function () {
        if (document.visibilityState === "visible" && document.forms.redirect) {
          document.forms.redirect.submit();
        }
      }, 1200);
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  buildCheckoutUrl,
  buildPayFormUrl,
  paymeLaunchFromHtml,
  resolvePaymeLaunch,
  payLaunchPage,
  checkoutAction,
  checkoutReturnUrl,
  payerDisplayName,
  payerUsername,
  decodeCheckoutToken
};
