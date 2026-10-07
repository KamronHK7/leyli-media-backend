const crypto = require("crypto");
const express = require("express");

const { getPlanByAmount, getPlanById } = require("./config");
const { getSubscription, grantSubscription, revokeSubscription } = require("./subscriptions");
const { markPendingClaimed, wasRecentlyClaimed } = require("./pending");

const MESSAGES = {
  unauthorized: {
    uz: "Avtorizatsiya xatosi",
    ru: "Ошибка авторизации",
    en: "Unauthorized"
  },
  invalidAmount: {
    uz: "Noto'g'ri summa",
    ru: "Неверная сумма",
    en: "Invalid amount"
  },
  userNotFound: {
    uz: "Foydalanuvchi topilmadi",
    ru: "Пользователь не найден",
    en: "User not found"
  },
  accountBusy: {
    uz: "Hisobda faol to'lov mavjud",
    ru: "На счете уже есть активная транзакция",
    en: "Account already has an active transaction"
  },
  txNotFound: {
    uz: "Tranzaksiya topilmadi",
    ru: "Транзакция не найдена",
    en: "Transaction not found"
  },
  cannotPerform: {
    uz: "Operatsiyani bajarib bo'lmaydi",
    ru: "Невозможно выполнить операцию",
    en: "Cannot perform operation"
  },
  invalidParams: {
    uz: "Noto'g'ri parametrlar",
    ru: "Неверные параметры",
    en: "Invalid params"
  },
  methodNotFound: {
    uz: "Metod topilmadi",
    ru: "Метод не найден",
    en: "Method not found"
  },
  parseError: {
    uz: "JSON xatosi",
    ru: "Ошибка разбора JSON",
    en: "Parse error"
  },
  systemError: {
    uz: "Tizim xatosi",
    ru: "Системная ошибка",
    en: "System error"
  },
  cannotChangePassword: {
    uz: "Parolni o'zgartirib bo'lmadi",
    ru: "Не удалось изменить пароль",
    en: "Cannot change the password"
  }
};

function rpcError(res, id, code, message, data) {
  const response = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message }
  };

  if (data !== undefined) {
    response.error.data = data;
  }

  // Payme talabi: xatolarda ham doim HTTP 200
  return res.status(200).json(response);
}

function rpcResult(res, id, result) {
  return res.status(200).json({
    jsonrpc: "2.0",
    id,
    result
  });
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

function getTelegramUserId(account) {
  if (!account || typeof account !== "object") {
    return null;
  }

  const value =
    account.user_id ??
    account.telegram_id ??
    account.telegram_user_id ??
    account.order_id;

  if (value === undefined || value === null) {
    return null;
  }

  const id = String(value).trim();

  return id || null;
}

/*
  hooks.onPerformed({ telegramUserId, plan, expiresAt })  - to'lov bajarilganda
  hooks.onRefunded({ telegramUserId, plan })              - bajarilgan to'lov qaytarilganda
*/
function createPaymeRouter({ pool, config, hooks = {} }) {
  const router = express.Router();
  const liveKeys = {
    sandbox: config.paymeTestKey || config.paymeKey,
    production: config.paymeKey
  };

  function checkAuth(req, res, next) {
    const reject = () =>
      rpcError(res, req.body?.id, -32504, MESSAGES.unauthorized);

    console.log("📥 PAYME HIT", req.body?.method || "no-method");

    const isSandbox =
      String(req.headers["test-operation"] || "").toLowerCase() === "paycom";
    const expectedKey = isSandbox ? liveKeys.sandbox : liveKeys.production;

    if (!config.paymeLogin || !expectedKey) {
      console.error("❌ PAYME_LOGIN yoki PAYME_KEY o'rnatilmagan");
      return reject();
    }

    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith("Basic ")) {
      console.error("❌ PAYME AUTH: Authorization yo'q");
      return reject();
    }

    let decoded;

    try {
      decoded = Buffer.from(auth.substring(6).trim(), "base64").toString("utf8");
    } catch (error) {
      return reject();
    }

    const separator = decoded.indexOf(":");

    if (separator === -1) {
      return reject();
    }

    const login = decoded.substring(0, separator);
    const password = decoded.substring(separator + 1);

    if (!safeEqual(login, config.paymeLogin) || !safeEqual(password, expectedKey)) {
      console.error("❌ PAYME AUTH: login/kalit mos emas");
      return reject();
    }

    req.paymeSandbox = isSandbox;
    next();
  }

  async function telegramUserExists(telegramUserId) {
    const result = await pool.query(
      `SELECT 1 FROM telegram_users WHERE telegram_user_id = $1 LIMIT 1`,
      [String(telegramUserId)]
    );

    return result.rows.length > 0;
  }

  /*
    Summa va account tekshiruvi.
    Payme pesochitsa avval hisobni tekshiradi: mavjud bo'lmagan user_id
    uchun -31050...-31099, keyin noto'g'ri summa uchun -31001.
  */
  async function validateAmountAndAccount(params) {
    const telegramUserId = getTelegramUserId(params?.account);

    if (!telegramUserId || !(await telegramUserExists(telegramUserId))) {
      return { error: [-31050, MESSAGES.userNotFound, "user_id"] };
    }

    const amount = Number(params?.amount);
    const plan = Number.isFinite(amount) ? getPlanByAmount(amount) : null;

    if (!plan) {
      return { error: [-31001, MESSAGES.invalidAmount, "amount"] };
    }

    return { telegramUserId, amount, plan };
  }

  function isExpired(transaction) {
    return (
      Number(transaction.state) === 1 &&
      Date.now() - Number(transaction.create_time) > config.transactionTimeoutMs
    );
  }

  // Muddati o'tgan tranzaksiyani bekor qiladi (reason 4)
  async function cancelExpired(transaction) {
    await pool.query(
      `
        UPDATE payme_transactions
        SET state = -1, cancel_time = $1, reason = 4
        WHERE id = $2 AND state = 1
      `,
      [Date.now(), transaction.id]
    );
  }

  async function findTransaction(paymeId) {
    const result = await pool.query(
      `SELECT * FROM payme_transactions WHERE payme_id = $1 LIMIT 1`,
      [String(paymeId)]
    );

    return result.rows[0] || null;
  }

  const toReason = (value) =>
    value === null || value === undefined ? null : Number(value);

  router.post("/", checkAuth, async (req, res) => {
    const { method, params, id } = req.body || {};

    console.log("📥 PAYME:", method, params?.id || params?.account?.user_id || "");

    try {
      /* CheckPerformTransaction */
      if (method === "CheckPerformTransaction") {
        const check = await validateAmountAndAccount(params);

        if (check.error) {
          return rpcError(res, id, ...check.error);
        }

        return rpcResult(res, id, { allow: true });
      }

      /* CreateTransaction */
      if (method === "CreateTransaction") {
        const paymeId = params?.id;

        if (!paymeId) {
          return rpcError(res, id, -31003, MESSAGES.txNotFound);
        }

        const existing = await findTransaction(paymeId);

        if (existing) {
          if (isExpired(existing)) {
            await cancelExpired(existing);
            return rpcError(res, id, -31008, MESSAGES.cannotPerform);
          }

          if (Number(existing.state) !== 1) {
            return rpcError(res, id, -31008, MESSAGES.cannotPerform);
          }

          return rpcResult(res, id, {
            create_time: Number(existing.create_time),
            transaction: String(existing.id),
            state: 1
          });
        }

        const check = await validateAmountAndAccount(params);

        if (check.error) {
          return rpcError(res, id, ...check.error);
        }

        // Shu hisobga boshqa faol tranzaksiya bandmi?
        const active = await pool.query(
          `
            SELECT * FROM payme_transactions
            WHERE telegram_user_id = $1
              AND state = 1
              AND payme_id <> $2
          `,
          [check.telegramUserId, String(paymeId)]
        );

        const SANDBOX_STALE_MS = 60 * 1000;
        let busy = false;

        for (const row of active.rows) {
          const age = Date.now() - Number(row.create_time);
          const staleSandbox = req.paymeSandbox && age > SANDBOX_STALE_MS;

          if (isExpired(row) || staleSandbox) {
            await cancelExpired(row);
          } else {
            busy = true;
          }
        }

        if (busy) {
          return rpcError(res, id, -31050, MESSAGES.accountBusy, "account");
        }

        const createTime = Date.now();
        const paymeTime = Number(params?.time) || createTime;

        const inserted = await pool.query(
          `
            INSERT INTO payme_transactions
              (payme_id, telegram_user_id, amount, state, create_time, payme_time, plan_id)
            VALUES
              ($1, $2, $3, 1, $4, $5, $6)
            RETURNING *
          `,
          [
            String(paymeId),
            check.telegramUserId,
            check.amount,
            createTime,
            paymeTime,
            check.plan.id
          ]
        );

        const transaction = inserted.rows[0];

        return rpcResult(res, id, {
          create_time: Number(transaction.create_time),
          transaction: String(transaction.id),
          state: 1
        });
      }

      /* PerformTransaction */
      if (method === "PerformTransaction") {
        const transaction = await findTransaction(params?.id);

        if (!transaction) {
          return rpcError(res, id, -31003, MESSAGES.txNotFound);
        }

        const state = Number(transaction.state);

        if (state === 2) {
          return rpcResult(res, id, {
            transaction: String(transaction.id),
            perform_time: Number(transaction.perform_time || 0),
            state: 2
          });
        }

        if (state !== 1) {
          return rpcError(res, id, -31008, MESSAGES.cannotPerform);
        }

        if (isExpired(transaction)) {
          await cancelExpired(transaction);
          return rpcError(res, id, -31008, MESSAGES.cannotPerform);
        }

        const updated = await pool.query(
          `
            UPDATE payme_transactions
            SET state = 2, perform_time = $1
            WHERE id = $2 AND state = 1
            RETURNING *
          `,
          [Date.now(), transaction.id]
        );

        const finalTransaction =
          updated.rows[0] || (await findTransaction(params.id));

        // Obuna faqat state 1 -> 2 o'tishining o'zida bir marta beriladi
        if (updated.rows[0]) {
          const plan =
            getPlanById(transaction.plan_id) ||
            getPlanByAmount(transaction.amount);

          if (plan) {
            const alreadyClaimed = await wasRecentlyClaimed(
              pool,
              transaction.telegram_user_id
            );

            const expiresAt = alreadyClaimed
              ? (await getSubscription(pool, transaction.telegram_user_id))
                  ?.expires_at
              : await grantSubscription(
                  pool,
                  transaction.telegram_user_id,
                  plan
                );

            await markPendingClaimed(pool, transaction.telegram_user_id);

            if (hooks.onPerformed && expiresAt) {
              Promise.resolve(
                hooks.onPerformed({
                  telegramUserId: transaction.telegram_user_id,
                  plan,
                  expiresAt
                })
              ).catch((error) =>
                console.error("❌ onPerformed:", error.message)
              );
            }
          }
        }

        return rpcResult(res, id, {
          transaction: String(finalTransaction.id),
          perform_time: Number(finalTransaction.perform_time || 0),
          state: Number(finalTransaction.state)
        });
      }

      /* CancelTransaction */
      if (method === "CancelTransaction") {
        const transaction = await findTransaction(params?.id);

        if (!transaction) {
          return rpcError(res, id, -31003, MESSAGES.txNotFound);
        }

        const currentState = Number(transaction.state);

        if (currentState < 0) {
          return rpcResult(res, id, {
            transaction: String(transaction.id),
            cancel_time: Number(transaction.cancel_time || 0),
            state: currentState
          });
        }

        const requestedReason = Number(params?.reason);
        const reason = Number.isFinite(requestedReason) ? requestedReason : 10;
        const newState = currentState === 2 ? -2 : -1;

        const updated = await pool.query(
          `
            UPDATE payme_transactions
            SET state = $1, cancel_time = $2, reason = $3
            WHERE id = $4 AND state IN (1, 2)
            RETURNING *
          `,
          [newState, Date.now(), reason, transaction.id]
        );

        const finalTransaction =
          updated.rows[0] || (await findTransaction(params.id));

        // Bajarilgan to'lov qaytarilsa, obuna muddati qisqartiriladi
        if (updated.rows[0] && currentState === 2) {
          const plan =
            getPlanById(transaction.plan_id) ||
            getPlanByAmount(transaction.amount);

          if (plan) {
            await revokeSubscription(pool, transaction.telegram_user_id, plan);

            if (hooks.onRefunded) {
              Promise.resolve(
                hooks.onRefunded({
                  telegramUserId: transaction.telegram_user_id,
                  plan
                })
              ).catch((error) =>
                console.error("❌ onRefunded:", error.message)
              );
            }
          }
        }

        return rpcResult(res, id, {
          transaction: String(finalTransaction.id),
          cancel_time: Number(finalTransaction.cancel_time || 0),
          state: Number(finalTransaction.state)
        });
      }

      /* CheckTransaction */
      if (method === "CheckTransaction") {
        const transaction = await findTransaction(params?.id);

        if (!transaction) {
          return rpcError(res, id, -31003, MESSAGES.txNotFound);
        }

        return rpcResult(res, id, {
          create_time: Number(transaction.create_time),
          perform_time: Number(transaction.perform_time || 0),
          cancel_time: Number(transaction.cancel_time || 0),
          transaction: String(transaction.id),
          state: Number(transaction.state),
          reason: toReason(transaction.reason)
        });
      }

      /* GetStatement */
      if (method === "GetStatement") {
        const from = Number(params?.from);
        const to = Number(params?.to);

        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          return rpcError(res, id, -32600, MESSAGES.invalidParams);
        }

        const result = await pool.query(
          `
            SELECT * FROM payme_transactions
            WHERE COALESCE(payme_time, create_time) >= $1
              AND COALESCE(payme_time, create_time) <= $2
            ORDER BY COALESCE(payme_time, create_time) ASC
          `,
          [from, to]
        );

        const sandboxFreshAfter = req.paymeSandbox ? Date.now() - 3 * 60 * 1000 : 0;
        const rows = result.rows.filter((t) =>
          req.paymeSandbox ? Number(t.create_time) >= sandboxFreshAfter : true
        );

        return rpcResult(res, id, {
          transactions: rows.map((t) => ({
            id: t.payme_id,
            time: Number(t.payme_time || t.create_time),
            amount: Number(t.amount),
            account: { user_id: t.telegram_user_id },
            create_time: Number(t.create_time),
            perform_time: Number(t.perform_time || 0),
            cancel_time: Number(t.cancel_time || 0),
            transaction: String(t.id),
            state: Number(t.state),
            reason: toReason(t.reason)
          }))
        });
      }

      /* ChangePassword */
      if (method === "ChangePassword") {
        const nextPassword = String(params?.password || "");
        const currentKey = req.paymeSandbox ? liveKeys.sandbox : liveKeys.production;

        if (!nextPassword || nextPassword === currentKey) {
          return rpcError(res, id, -32400, MESSAGES.cannotChangePassword, "password");
        }

        if (req.paymeSandbox) {
          liveKeys.sandbox = nextPassword;
        } else {
          liveKeys.production = nextPassword;
        }

        return rpcResult(res, id, { success: true });
      }

      return rpcError(res, id, -32601, MESSAGES.methodNotFound);
    } catch (error) {
      console.error("❌ PAYME ERROR:", error);

      return rpcError(res, id, -32400, MESSAGES.systemError);
    }
  });

  return router;
}

module.exports = { createPaymeRouter, rpcError, MESSAGES };
