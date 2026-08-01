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
 *   WEBHOOK_URL         - the Cloudflare Worker proxy URL Telegram should
 *                         call. Required in practice: Telegram will not
 *                         follow the 302 that Apps Script serves /exec with.
 *                         See worker/masrofna-proxy.js.
 *   TELEGRAM_SECRET_TOKEN - shared secret sent to setWebhook; must match the
 *                         Worker's TELEGRAM_SECRET_TOKEN variable.
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

/**
 * Fixed Item list - Gemini must classify into exactly one of these.
 *
 * Adding or renaming an entry only affects rows written from then on. Nothing
 * rewrites the sheet, and /report aggregates whatever string each row already
 * holds, so historical rows keep their original classification.
 */
const ITEMS = [
  'Food & Groceries',
  'Snacks',
  'Transportation',
  'Medical & Health',
  'Cleaning & Household Supplies',
  'Bills & Utilities',
  'Activities & Entertainment',
  'Education',
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

/**
 * Messages that mean "drop it" rather than "log this".
 *
 * Matched against the whole normalized message, never as a substring, so
 * "cancel gym membership 300" is still treated as an expense. Compared after
 * normalizeForIntent_ strips punctuation, diacritics, and alef/yaa variants -
 * so entries here are written in their already-normalized form.
 */
const CANCEL_PHRASES = [
  // English
  'cancel', 'cancelled', 'canceled', 'forget it', 'forget this', 'forget that',
  'never mind', 'nevermind', 'nvm', 'no', 'nope', 'no thanks', 'no thank you',
  'nothing', 'none', 'skip', 'skip it', 'stop', 'ignore', 'ignore it',
  'ignore this', 'drop it', 'leave it', 'abort', 'undo', 'na',
  // Arabic
  'لا', 'لاء', 'لا شكرا', 'الغي', 'الغاء', 'الغيها', 'بلاش', 'خلاص', 'انسي', 'انساها',
  'مش مهم', 'مش مهمه', 'سيبك', 'سيبها', 'مفيش', 'مفيش حاجه', 'مش عايز',
  'مش عايزه', 'ولا حاجه', 'مش هحسبها',
  // Franco-Arabic
  'khalas', 'balash', 'kansel', 'cancel it', 'mesh mohem', 'mish mohem',
  'la', 'la2', 'msh mohem'
];

/**
 * MIME types Gemini accepts as inline data. Anything else is rejected before
 * the request, since the API answers an unknown type with a 400.
 */
const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
];

/**
 * Cap on the raw attachment size. Inline data shares a 20MB total request
 * budget with the prompt, and base64 inflates bytes by about a third, so this
 * leaves comfortable headroom.
 */
const MAX_INLINE_BYTES = 10 * 1024 * 1024;

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
