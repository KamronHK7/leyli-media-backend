const { amountTiyin } = require("./config");

function checkoutBase(config) {
  return config.paymeTestMode ? "https://checkout.test.paycom.uz" : "https://checkout.paycom.uz";
}

function encodeToken(params) {
  for (let n = 5000; n < 5300; n += 1) {
    const token = Buffer.from(`${params};ct=${n}`).toString("base64");
    if (!token.includes("/") && !token.includes("+")) {
      return token;
    }
  }

  return Buffer.from(params).toString("base64");
}

function buildCheckoutUrl({ config, userId, plan }) {
  const parts = [
    `m=${config.paymeMerchantId}`,
    `ac.user_id=${userId}`,
    `a=${amountTiyin(plan)}`,
    "l=uz"
  ];

  if (config.publicUrl) {
    parts.push(`c=${config.publicUrl}/paid`);
  }

  const token = encodeToken(parts.join(";"));
  return `${checkoutBase(config)}/${token}`;
}

module.exports = { buildCheckoutUrl, checkoutBase, encodeToken };
