const { Pool } = require("pg");

function createPool(connectionString) {
  return new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

async function initDatabase(pool, config) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      id SERIAL PRIMARY KEY,
      telegram_user_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

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
    )
  `);

  // Eski bazalar uchun yangi ustunlar
  await pool.query(`
    ALTER TABLE payme_transactions
    ADD COLUMN IF NOT EXISTS payme_time BIGINT
  `);

  await pool.query(`
    ALTER TABLE payme_transactions
    ADD COLUMN IF NOT EXISTS plan_id TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      telegram_user_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      reminded BOOLEAN NOT NULL DEFAULT FALSE,
      kicked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Faqat Payme sandbox testi uchun (PAYME_TEST_USER_ID=12345).
  // Sandbox tasdiqlangandan keyin bu o'zgaruvchini o'chiring.
  if (config && config.paymeTestUserId) {
    await pool.query(
      `
        INSERT INTO telegram_users (telegram_user_id, first_name)
        VALUES ($1, 'PAYME TEST')
        ON CONFLICT (telegram_user_id) DO NOTHING
      `,
      [String(config.paymeTestUserId)]
    );

    // Sandbox qayta yugurganda eski to'lanmagan test to'lovlari Create ni bloklamasin
    await pool.query(
      `
        UPDATE payme_transactions
        SET state = -1, cancel_time = $1, reason = 4
        WHERE telegram_user_id = $2 AND state = 1
      `,
      [Date.now(), String(config.paymeTestUserId)]
    );
  }

  console.log("✅ Database tables tayyor");
}

async function upsertUser(pool, user) {
  await pool.query(
    `
      INSERT INTO telegram_users
        (telegram_user_id, username, first_name, last_name, updated_at)
      VALUES
        ($1, $2, $3, $4, NOW())
      ON CONFLICT (telegram_user_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = NOW()
    `,
    [
      String(user.id),
      user.username || null,
      user.first_name || null,
      user.last_name || null
    ]
  );
}

module.exports = { createPool, initDatabase, upsertUser };
