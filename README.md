# LEYLI MEDIA Premium

Telegram bot + mini app + Payme Merchant API. Bitta Render servisida ishlaydi.

## Foydalanuvchi oqimi

1. `/start` → **Obuna ulash** mini appni ochadi.
2. Mini app ism, username va Telegram ID ni Telegramdan oladi. Hech narsa kiritilmaydi.
3. **Payme orqali to‘lash** → checkout havolasi `user_id` va summa bilan ochiladi.
4. To‘lovdan keyin bot bir martalik kanal havolasini yuboradi.
5. 30 kun tugagach foydalanuvchi kanaldan chiqariladi, 3 kun oldin eslatma keladi.

## Render sozlamalari

| O‘zgaruvchi | Qiymat |
|---|---|
| `DATABASE_URL` | Render Postgres |
| `BOT_TOKEN` | BotFather tokeni |
| `CHANNEL_ID` | Premium kanal (`-100...`). Bot admin bo‘lishi kerak |
| `PUBLIC_URL` | `https://leyli-media-backend.onrender.com` |
| `PAYME_LOGIN` | `Paycom` |
| `PAYME_KEY` | Sandbox: `test_key`. Ishlab chiqarish: haqiqiy kalit |
| `PAYME_MERCHANT_ID` | Payme kassa ID |
| `PAYME_TEST_MODE` | Sandbox: `true`. Keyin `false` |
| `PAYME_TEST_USER_ID` | Sandbox: `12345`. Keyin o‘chiring |
| `CRON_SECRET` | Tasodifiy so‘z (muddat vazifasi uchun) |
| `SUPPORT_URL` | Ixtiyoriy |

Start command: `npm start`

## Payme kabinet

Kassa account maydoni faqat **`user_id`** bo‘lishi kerak (FISH/telefon emas).

Sandbox: https://test.paycom.uz — endpoint `https://<servis>/payme`

## Telegram

- Botni yopiq kanalga **admin** qiling (foydalanuvchi qo‘shish/chiqarish, havola yaratish).
- Eski Apps Script webhook o‘chiriladi: server ishga tushganda yangi webhook o‘rnatiladi.
- BotFather’da `/setdomain` ga Render domenini yozing (mini app uchun).

## Muddat vazifasi

Server har 10 daqiqada tekshiradi. Render Free uxlasa, tashqi cron:

`GET https://<servis>/cron/expire?secret=CRON_SECRET`
