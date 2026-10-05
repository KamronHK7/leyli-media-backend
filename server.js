require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================
   DATABASE TABLE
========================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payme_transactions (
      id SERIAL PRIMARY KEY,
      payme_id TEXT UNIQUE NOT NULL,
      telegram_user_id TEXT,
      amount BIGINT NOT NULL,
      state INTEGER NOT NULL DEFAULT 1,
      create_time BIGINT NOT NULL,
      perform_time BIGINT DEFAULT 0,
      cancel_time BIGINT DEFAULT 0,
      reason INTEGER DEFAULT NULL
    );
  `);

  console.log("✅ Database table tayyor");
}

/* =========================
   BASIC AUTH
========================= */

function checkPaymeAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    return res.status(401).json({
      error: {
        code: -32504,
        message: "Unauthorized"
      }
    });
  }

  const encoded = auth.replace("Basic ", "");

  let decoded;

  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (error) {
    return res.status(401).json({
      error: {
        code: -32504,
        message: "Unauthorized"
      }
    });
  }

  const [login, password] = decoded.split(":");

  if (
    login !== process.env.PAYME_LOGIN ||
    password !== process.env.PAYME_KEY
  ) {
    return res.status(401).json({
      error: {
        code: -32504,
        message: "Unauthorized"
      }
    });
  }

  next();
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Leyli Media Backend ishlayapti"
  });
});

/* =========================
   DATABASE TEST
========================= */

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      database: "connected",
      time: result.rows[0].now
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Database ulanmagan"
    });
  }
});

/* =========================
   PAYME MERCHANT API
========================= */

app.post("/payme", checkPaymeAuth, async (req, res) => {
  const { method, params, id } = req.body;

  console.log("📥 PAYME:", method);
  console.log(JSON.stringify(req.body, null, 2));

  try {

    /* =========================
       CheckPerformTransaction
    ========================= */

  if (method === "CheckPerformTransaction") {
  console.log("🔥 CHECK PERFORM ISHLADI");
  console.log("PARAMS:", JSON.stringify(params, null, 2));

  const amount = Number(params?.amount);
  const account = params?.account || {};

  console.log("💰 AMOUNT:", amount);
  console.log("👤 ACCOUNT:", account);

  // 20 000 so'm = 2 000 000 tiyin
  const REQUIRED_AMOUNT = 2000000;

  // SUMMA TEKSHIRISH
  if (amount !== REQUIRED_AMOUNT) {
    return res.status(200).json({
      jsonrpc: "2.0",
      id: id,
      error: {
        code: -31001,
        message: {
          uz: "Noto'g'ri summa",
          ru: "Неверная сумма",
          en: "Invalid amount"
        },
        data: "amount"
      }
    });
  }

  // USER ID OLISH
  const telegramUserId =
    account.user_id ||
    account.telegram_id ||
    account.order_id;

  console.log("👤 USER ID:", telegramUserId);

  // USER ID YO'Q
  if (!telegramUserId) {
    return res.status(200).json({
      jsonrpc: "2.0",
      id: id,
      error: {
        code: -31050,
        message: {
          uz: "Foydalanuvchi topilmadi",
          ru: "Пользователь не найден",
          en: "User not found"
        },
        data: "account"
      }
    });
  }

  // HAMMASI TO'G'RI
  console.log("✅ CHECK PERFORM OK");

  return res.status(200).json({
    jsonrpc: "2.0",
    id: id,
    result: {
      allow: true
    }
  });
}
    /* =========================
       CreateTransaction
    ========================= */

    if (method === "CreateTransaction") {
      const paymeId = params?.id;
      const amount = Number(params?.amount);
      const account = params?.account || {};

      const REQUIRED_AMOUNT = 2000000;

      if (amount !== REQUIRED_AMOUNT) {
        return res.json({
          id,
          error: {
            code: -31001,
            message: {
              uz: "Noto'g'ri summa",
              ru: "Неверная сумма",
              en: "Invalid amount"
            },
            data: "amount"
          }
        });
      }

      const telegramUserId =
        account.user_id ||
        account.telegram_id ||
        account.order_id;

      if (!telegramUserId) {
        return res.json({
          id,
          error: {
            code: -31050,
            message: {
              uz: "Foydalanuvchi topilmadi",
              ru: "Пользователь не найден",
              en: "User not found"
            },
            data: "account"
          }
        });
      }

      const existing = await pool.query(
        `SELECT * FROM payme_transactions
         WHERE payme_id = $1`,
        [paymeId]
      );

      if (existing.rows.length > 0) {
        const transaction = existing.rows[0];

        return res.json({
          id,
          result: {
            create_time: Number(transaction.create_time),
            transaction: String(transaction.id),
            state: Number(transaction.state)
          }
        });
      }

      const createTime = Date.now();

      const result = await pool.query(
        `INSERT INTO payme_transactions
        (
          payme_id,
          telegram_user_id,
          amount,
          state,
          create_time
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [
          paymeId,
          String(telegramUserId),
          amount,
          1,
          createTime
        ]
      );

      const transaction = result.rows[0];

      return res.json({
        id,
        result: {
          create_time: createTime,
          transaction: String(transaction.id),
          state: 1
        }
      });
    }

    /* =========================
       PerformTransaction
    ========================= */

    if (method === "PerformTransaction") {
      const paymeId = params?.id;

      const result = await pool.query(
        `SELECT * FROM payme_transactions
         WHERE payme_id = $1`,
        [paymeId]
      );

      if (result.rows.length === 0) {
        return res.json({
          id,
          error: {
            code: -31003,
            message: {
              uz: "Tranzaksiya topilmadi",
              ru: "Транзакция не найдена",
              en: "Transaction not found"
            }
          }
        });
      }

      const transaction = result.rows[0];

      if (Number(transaction.state) === 2) {
        return res.json({
          id,
          result: {
            transaction: String(transaction.id),
            perform_time: Number(transaction.perform_time || 0),
            state: 2
          }
        });
      }

      const performTime = Date.now();

      await pool.query(
        `UPDATE payme_transactions
         SET state = 2,
             perform_time = $1
         WHERE payme_id = $2`,
        [performTime, paymeId]
      );

      return res.json({
        id,
        result: {
          transaction: String(transaction.id),
          perform_time: performTime,
          state: 2
        }
      });
    }

    /* =========================
       CancelTransaction
    ========================= */

    if (method === "CancelTransaction") {
      const paymeId = params?.id;
      const reason = params?.reason || 10;

      const result = await pool.query(
        `SELECT * FROM payme_transactions
         WHERE payme_id = $1`,
        [paymeId]
      );

      if (result.rows.length === 0) {
        return res.json({
          id,
          error: {
            code: -31003,
            message: {
              uz: "Tranzaksiya topilmadi",
              ru: "Транзакция не найдена",
              en: "Transaction not found"
            }
          }
        });
      }

      const transaction = result.rows[0];

      const cancelTime = Date.now();

      let newState = -1;

      if (Number(transaction.state) === 2) {
        newState = -2;
      }

      await pool.query(
        `UPDATE payme_transactions
         SET state = $1,
             cancel_time = $2,
             reason = $3
         WHERE payme_id = $4`,
        [
          newState,
          cancelTime,
          reason,
          paymeId
        ]
      );

      return res.json({
        id,
        result: {
          transaction: String(transaction.id),
          cancel_time: cancelTime,
          state: newState,
          reason
        }
      });
    }

    /* =========================
       CheckTransaction
    ========================= */

    if (method === "CheckTransaction") {
      const paymeId = params?.id;

      const result = await pool.query(
        `SELECT * FROM payme_transactions
         WHERE payme_id = $1`,
        [paymeId]
      );

      if (result.rows.length === 0) {
        return res.json({
          id,
          error: {
            code: -31003,
            message: {
              uz: "Tranzaksiya topilmadi",
              ru: "Транзакция не найдена",
              en: "Transaction not found"
            }
          }
        });
      }

      const transaction = result.rows[0];

      return res.json({
        id,
        result: {
          create_time: Number(transaction.create_time),
          perform_time: Number(transaction.perform_time || 0),
          cancel_time: Number(transaction.cancel_time || 0),
          transaction: String(transaction.id),
          state: Number(transaction.state),
          reason: transaction.reason
        }
      });
    }

    /* =========================
       UNKNOWN METHOD
    ========================= */

    return res.json({
      id,
      error: {
        code: -32601,
        message: {
          uz: "Metod topilmadi",
          ru: "Метод не найден",
          en: "Method not found"
        }
      }
    });

  } catch (error) {
    console.error("❌ PAYME ERROR:", error);

    return res.json({
      id,
      error: {
        code: -32400,
        message: {
          uz: "Tizim xatosi",
          ru: "Системная ошибка",
          en: "System error"
        }
      }
    });
  }
});

/* =========================
   START SERVER
========================= */

async function start() {

  try {

    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `🚀 Leyli Media Backend ${PORT}-portda ishga tushdi`
      );
    });

  } catch (error) {

    console.error("❌ Server ishga tushmadi:", error);

    process.exit(1);
  }
}

start();