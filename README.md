# Masrofna (مصروفنا) — Expense Tracker Bot

A personal expense tracker that runs entirely through Telegram. Send a plain-language message or a photo of a receipt, and it's automatically parsed, categorized, and logged to a Google Sheet — no forms, no apps, no manual data entry.

```
120 taxi to work
```
```
✅ Logged: Taxi to work — 120 EGP
📌 Transportation · Consumption Expenses
```

Built with Telegram Bot API, Google Apps Script, the Gemini API, and Google Sheets, with a small Cloudflare Worker in front to handle webhook delivery reliably.

## Features

- **Natural language input** — text in English, Arabic, or a mix. No fixed format required.
- **Receipt photos** — send a picture and the amount, item, and date are read directly from it.
- **Multiple expenses in one message** — list several purchases (e.g. a shopping trip) and each is logged as its own row.
- **Automatic categorization** — every expense is classified into an *Item* (what it was) and a *Type* (Commitments / Consumption Expenses / Luxury / Investment).
- **Monthly reports** — `/report` or `/report July 2026` for a spending breakdown by item and type, computed directly from the sheet (no AI call needed).
- **Private by default** — only whitelisted Telegram chat IDs can use the bot.
- **Cancel anytime** — `/cancel`, or just say "never mind" mid-conversation.

## How it works

```
Telegram ─▶ Cloudflare Worker ─▶ Google Apps Script (Web App) ─▶ Gemini API
                                          │
                                          ▼
                                    Google Sheet
```

Telegram delivers each message to a small Cloudflare Worker, which forwards it to the Apps Script Web App (Apps Script's `/exec` endpoint always issues a redirect, which Telegram won't follow directly — the Worker resolves that). Apps Script asks Gemini to extract structured data from the message or photo, appends it to a Google Sheet, and replies over the Telegram Bot API.

## Setup

You'll need: a Google account, a Telegram account, [Node.js](https://nodejs.org), and [Git](https://git-scm.com).

1. **Clone this repo**
   ```bash
   git clone https://github.com/<your-username>/expense-tracker.git
   cd expense-tracker
   ```

2. **Install `clasp`** (Google's Apps Script CLI)
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

3. **Create the Apps Script project and push the code**
   ```bash
   clasp create-script --type standalone --title "Your Bot Name"
   clasp push
   ```

4. **Create a Telegram bot** via [@BotFather](https://t.me/BotFather) and save the token it gives you.

5. **Get a Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey).

6. **Create a Google Sheet** with a tab named `Expenses` and these columns in row 1:
   ```
   ID | Date | Description | Amount | Item | Type | Payment Method | Beneficiary | Raw Input
   ```

7. **Set Script Properties** in the Apps Script editor (Project Settings → Script Properties):

   | Property | Value |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | from BotFather |
   | `GEMINI_API_KEY` | from AI Studio |
   | `SHEET_ID` | the Sheet's ID (from its URL) |
   | `ALLOWED_CHAT_IDS` | your Telegram chat ID(s), comma-separated |
   | `GEMINI_MODEL` | current model name, e.g. `gemini-3.1-flash-lite` |

   Get your chat ID by messaging [@userinfobot](https://t.me/userinfobot).

8. **Deploy as a Web App** (Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone).

9. **Deploy the Cloudflare Worker** (`worker/masrofna-proxy.js`) via the Cloudflare dashboard, and set its `APPS_SCRIPT_URL` variable to your deployed `/exec` URL.

10. **Register the webhook** by setting `WEBHOOK_URL` (your Worker's URL) in Script Properties, then running the `setWebhook` function once from the Apps Script editor.

Message your bot and try it out.

## Commands

| Command | Description |
|---|---|
| `/help` | Usage instructions |
| `/report` | This month's spending summary |
| `/report July 2026` | Summary for a specific month |
| `/cancel` | Dismiss a pending clarification |
| `/id` | Show your Telegram chat ID |
| `/ping` | Connectivity check (Sheet, Gemini, config) |

## Notes

- Secrets (bot token, API key) are never stored in the repository — they live in Apps Script's Script Properties, which each user sets up independently after cloning.
- The Item and Type categories in the code reflect one household's spending patterns; adjust the lists in `Config.gs` and the extraction prompt in `GeminiExtractor.gs` to fit your own.
- Gemini model names and availability change over time — if the bot stops responding, check current models at [ai.google.dev](https://ai.google.dev/gemini-api/docs/models) and update the `GEMINI_MODEL` property (no redeploy needed).

## License

MIT
