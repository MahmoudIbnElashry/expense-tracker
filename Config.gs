/**
 * Masrofna Bot - shared configuration and constants.
 *
 * All .gs files in an Apps Script project share one global scope, so these
 * constants are visible everywhere. Secrets are never stored here - they are
 * read at runtime from Script Properties.
 *
 * Required Script Properties:
 *   TELEGRAM_BOT_TOKEN  - from @BotFather
 *   SHEET_ID            - the expenses spreadsheet ID
 *   GEMINI_API_KEY      - from Google AI Studio
 *
 * Optional Script Properties:
 *   GEMINI_MODEL        - override the default model name. Check
 *                         https://ai.google.dev/gemini-api/docs/models or run
 *                         /models if generateContent starts returning 404.
 *   GEMINI_API_VERSION  - override the default API version (v1beta)
 *   GEMINI_THINKING_LEVEL - thinkingLevel for Gemini 3.x models (e.g. "low")
 *   ALLOWED_CHAT_IDS    - comma-separated chat IDs; if set, all others ignored
 */

const CONFIG = {
  TIMEZONE: 'Africa/Cairo',
  CURRENCY: 'EGP',
  SHEET_NAME: 'Expenses',
  ID_PREFIX: 'EXP-',
  ID_START: 1001,
  // Fallback only - the GEMINI_MODEL script property overrides this, so
  // swapping models needs no redeploy. Kept current rather than left at a
  // retired model, so a missing or misspelled property degrades to something
  // that actually works.
  GEMINI_MODEL: 'gemini-3.1-flash-lite',
  GEMINI_HOST: 'https://generativelanguage.googleapis.com',
  GEMINI_API_VERSION: 'v1beta',
  // How long a *handled* update stays remembered. CacheService caps entries
  // at 6 hours, well past Telegram's retry window for a single update.
  DEDUP_TTL_SECONDS: 21600,
  // How long an *in-progress* claim survives. Long enough to cover the
  // slowest run (Gemini plus a sheet write), short enough that an execution
  // killed mid-flight frees the update for retry within a couple of minutes.
  DEDUP_INFLIGHT_SECONDS: 120,
  LOCK_TIMEOUT_MS: 30000
};

/** Fixed Item list - Gemini must classify into exactly one of these. */
const ITEMS = [
  'Food & Groceries',
  'Snacks',
  'Transportation',
  'Medical & Health',
  'Cleaning & Household Supplies',
  'Bills & Utilities',
  'Activities & Entertainment',
  'Family Allowance',
  'Clothing & Personal Care',
  'Charity & Gifts',
  'Savings & Insurance',
  'Other / Miscellaneous'
];

/** Fixed Type list - always assigned in addition to the Item. */
const TYPES = [
  'Commitments',
  'Consumption Expenses',
  'Luxury / Leisure',
  'Investment'
];

const PAYMENT_METHODS = ['Cash', 'Credit Card', 'Instapay', 'Other'];

const BENEFICIARIES = ['Personal', 'Tamim', 'Asmaa', 'Family', 'Other'];

/** Fallbacks used when Gemini returns a value outside the fixed lists. */
const DEFAULTS = {
  ITEM: 'Other / Miscellaneous',
  TYPE: 'Consumption Expenses',
  PAYMENT_METHOD: 'Cash',
  BENEFICIARY: 'Personal'
};

/** Column order of the Expenses sheet (1-indexed positions). */
const COLUMNS = {
  ID: 1,
  DATE: 2,
  DESCRIPTION: 3,
  AMOUNT: 4,
  ITEM: 5,
  TYPE: 6,
  PAYMENT_METHOD: 7,
  BENEFICIARY: 8,
  RAW_INPUT: 9
};

/** Reads a Script Property, returning null when unset. */
function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/** Reads a Script Property, throwing a clear error when unset. */
function requireProp_(key) {
  const value = getProp_(key);
  if (!value) {
    throw new Error('Missing Script Property: ' + key);
  }
  return value;
}
