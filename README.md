# expense-tracker

Personal expense tracker via Telegram bot: send a text message or receipt photo, and it's automatically parsed, categorized, and logged to Google Sheets using Gemini API and Google Apps Script.

## Files

| File | Role |
| --- | --- |
| `Code.gs` | `doPost` entry point, `update_id` deduplication, update routing |
| `Commands.gs` | `/start`, `/help`, `/report`, `/id` |
| `GeminiExtractor.gs` | Schema-locked expense extraction from text and receipt photos |
| `TelegramHandler.gs` | `sendMessage`, `getFile` + file download |
| `SheetWriter.gs` | Appends rows, auto-increments the `EXP-nnnn` ID |
| `ReportGenerator.gs` | Monthly aggregation (no Gemini call) |
| `Config.gs` | Fixed Item/Type lists, defaults, property accessors |
| `Utils.gs` | Date, money, and list-matching helpers |

## Script Properties

Set these in the Apps Script editor under **Project Settings → Script Properties**.
None of them belong in this repo.

| Key | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather |
| `SHEET_ID` | yes | Expenses spreadsheet ID |
| `GEMINI_API_KEY` | yes | From Google AI Studio |
| `GEMINI_MODEL` | no | Overrides the default `gemini-2.5-flash-lite` |
| `ALLOWED_CHAT_IDS` | no | Comma-separated allowlist. Unset = every chat accepted |

Run `checkSetup` from the editor to confirm which properties are set; it prints
`SET`/`MISSING` only, never values.

## Sheet layout

`ID | Date | Description | Amount | Item | Type | Payment Method | Beneficiary | Raw Input`

The `Date` column is written as a real date value formatted `dd-mm-yyyy`, so
`/report` can filter by month reliably.

## Deploying

```sh
npx clasp push
npx clasp create-deployment --deploymentId <webhook-deployment-id> --description "..."
```

The webhook points at a pinned deployment version, so `clasp push` alone does
not change what Telegram calls — the deployment must be updated too.
