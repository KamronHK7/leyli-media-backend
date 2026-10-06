const crypto = require("crypto");

/*
  Telegram Mini App "initData" ni tekshiradi (HMAC-SHA256).
  To'g'ri bo'lsa Telegram foydalanuvchisi obyektini qaytaradi, aks holda null.
  Hujjat: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
*/
function validateInitData(initData, botToken, options = {}) {
  const maxAgeSec = options.maxAgeSec ?? 24 * 60 * 60;
  const now = options.now ?? Date.now();

  if (!initData || !botToken || typeof initData !== "string") {
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return null;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const expected = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const given = Buffer.from(hash, "utf8");
  const wanted = Buffer.from(expected, "utf8");

  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));

  if (!authDate || now / 1000 - authDate > maxAgeSec) {
    return null;
  }

  try {
    const user = JSON.parse(params.get("user") || "null");

    if (!user || !user.id) {
      return null;
    }

    return user;
  } catch (error) {
    return null;
  }
}

module.exports = { validateInitData };
