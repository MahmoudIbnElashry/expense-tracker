/**
 * Masrofna Bot - Telegram expense tracker.
 *
 * Entry point and update routing. Flow:
 *   Telegram -> doPost -> dedup by update_id -> route
 *     /command      -> Commands.gs
 *     text or photo -> GeminiExtractor.gs -> SheetWriter.gs -> confirmation
 */

/**
 * Web app entry point.
 *
 * Structured as a thin shell around processUpdate_ so there is exactly ONE
 * return statement, sitting outside every try/catch/finally. No internal
 * failure - a thrown service call, a redirect, a broken trace - can produce a
 * path that returns anything other than a ContentService output.
 */
function doPost(e) {
  try {
    processUpdate_(e);
  } catch (err) {
    // Each statement is individually guarded: if this block throws, the
    // exception escapes doPost and Telegram gets a non-200 for every message.
    try { traceError_('doPost', err); } catch (ignored) {}
    try { notifyFailure_(safeChatId_(e), err); } catch (ignored) {}
  }

  try { traceSave_(); } catch (ignored) {}

  // The single exit. Telegram redelivers on any non-200.
  return ContentService.createTextOutput('OK');
}

/** Digs the chat ID out of a raw request without throwing. */
function safeChatId_(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    const message = update.message || update.edited_message;
    return message && message.chat ? message.chat.id : null;
  } catch (err) {
    return null;
  }
}

/** All the real work. Free to throw or return early; doPost absorbs both. */
function processUpdate_(e) {
  trace_('doPost.enter');

  if (!e || !e.postData || !e.postData.contents) {
    trace_('doPost.exit', 'no postData - nothing to process');
    return;
  }

  const body = e.postData.contents;
  trace_('doPost.body', body.length + ' bytes: ' + body.slice(0, 800));

  const update = JSON.parse(body);
  if (!update || typeof update.update_id === 'undefined') {
    trace_('doPost.exit', 'no update_id in payload');
    return;
  }

  const updateId = update.update_id;
  const message = update.message || update.edited_message;
  const chatId = message && message.chat ? message.chat.id : null;
  trace_('doPost.parsed', 'update_id=' + updateId + ' chatId=' + chatId);

  const claim = claimUpdate_(updateId);
  if (claim !== 'new') {
    trace_('doPost.exit', 'skipping update_id ' + updateId + ' (' + claim + ')');
    return;
  }

  let completed = false;
  try {
    handleUpdate_(update);
    completed = true;
    trace_('doPost.done');
  } finally {
    // Only a run that finished, or one that already replied, counts as
    // handled. Anything else releases the claim so Telegram's retry can
    // actually re-run it instead of being deduped into oblivion.
    if (completed || wasReplySent_()) {
      markUpdateHandled_(updateId);
    } else {
      releaseUpdateClaim_(updateId);
      trace_('dedup.released', 'update_id ' + updateId + ' is retryable');
    }
  }
}

/**
 * Best-effort "something broke" reply. Swallows its own errors so a failure
 * here can never mask the original one.
 */
function notifyFailure_(chatId, err) {
  if (!chatId) return;
  try {
    sendTelegramMessage(chatId, '⚠️ Something went wrong: ' +
      String(err && err.message ? err.message : err).slice(0, 300) +
      '\n\nSend /debug for the full trace.');
  } catch (nested) {
    traceError_('notifyFailure_', nested);
  }
}

/**
 * Two-phase deduplication.
 *
 * An earlier version claimed the update_id up front and never released it.
 * Because Telegram retries any delivery it considers failed - including ones
 * where Apps Script's 302 was rejected even though processing succeeded - a
 * single failure made that update permanently unprocessable: every retry hit
 * the claim and exited, so the message could never succeed no matter how many
 * times it was redelivered.
 *
 * Now there are two markers:
 *   inflight_<id>  short-lived, guards against genuine concurrent delivery.
 *                  Expires on its own if an execution dies without cleanup.
 *   done_<id>      long-lived, set only once the update is really handled.
 *
 * Returns 'new' (proceed), 'done' (already handled), or 'inflight'
 * (another execution has it right now).
 */
function claimUpdate_(updateId) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  } catch (err) {
    // Another invocation holds the lock, so it is handling this update.
    traceError_('dedup.lockTimeout for update_id ' + updateId, err);
    return 'inflight';
  }

  try {
    if (cache.get(doneKey_(updateId))) return 'done';
    if (cache.get(inflightKey_(updateId))) return 'inflight';

    cache.put(inflightKey_(updateId), '1', CONFIG.DEDUP_INFLIGHT_SECONDS);
    return 'new';
  } catch (err) {
    // A cache failure must not block the message. A rare duplicate reply is a
    // far better outcome than an expense that can never be logged.
    traceError_('dedup.cache', err);
    return 'new';
  } finally {
    lock.releaseLock();
  }
}

/** Marks an update as fully handled so retries are suppressed. */
function markUpdateHandled_(updateId) {
  try {
    const cache = CacheService.getScriptCache();
    cache.put(doneKey_(updateId), '1', CONFIG.DEDUP_TTL_SECONDS);
    cache.remove(inflightKey_(updateId));
  } catch (err) {
    traceError_('dedup.markHandled', err);
  }
}

/** Drops the in-flight claim so Telegram's next retry can re-run the update. */
function releaseUpdateClaim_(updateId) {
  try {
    CacheService.getScriptCache().remove(inflightKey_(updateId));
  } catch (err) {
    traceError_('dedup.release', err);
  }
}

function doneKey_(updateId) {
  return 'done_' + updateId;
}

function inflightKey_(updateId) {
  return 'inflight_' + updateId;
}

/**
 * Tracks whether a reply actually reached Telegram this execution. An update
 * that produced a reply is treated as handled even if a later step threw, so
 * a retry cannot double-reply.
 */
var REPLY_SENT = false;

function markReplySent_() {
  REPLY_SENT = true;
}

function wasReplySent_() {
  return REPLY_SENT === true;
}

/** Routes a single Telegram update. */
function handleUpdate_(update) {
  const message = update.message || update.edited_message;
  if (!message || !message.chat) {
    trace_('route.skip', 'update has no message.chat');
    return;
  }

  const chatId = message.chat.id;
  if (!isAllowedChat_(chatId)) {
    trace_('allowlist.rejected', 'chatId=' + chatId);
    return;
  }
  trace_('allowlist.passed', 'chatId=' + chatId);

  const text = (message.text || '').trim();

  if (text.charAt(0) === '/') {
    trace_('route.command', text.split(/\s+/)[0]);
    handleCommand_(chatId, text);
    return;
  }

  const photoFileId = extractPhotoFileId_(message);
  if (photoFileId) {
    trace_('route.photo');
    handleExpenseInput_(chatId, message, photoFileId);
    return;
  }

  if (text) {
    // Checked before Gemini. Without this, "forget it" and "no thanks" are
    // just more vague messages, so each one comes back with another
    // clarifying question and there is no way out of the exchange.
    if (isCancelIntent_(text)) {
      trace_('route.cancel', JSON.stringify(text.slice(0, 80)));
      sendTelegramMessage(chatId, 'Cancelled — nothing logged.');
      return;
    }

    trace_('route.text', JSON.stringify(text.slice(0, 200)));
    handleExpenseInput_(chatId, message, null);
    return;
  }

  trace_('route.unsupported', 'no text and no photo - sending usage hint');
  sendTelegramMessage(chatId,
    'Send an expense as text (e.g. "120 taxi to work") or a receipt photo.\n' +
    'Use /report for a monthly summary.');
}

/**
 * Optional allowlist. When ALLOWED_CHAT_IDS is unset every chat is accepted,
 * which matters because the web app is deployed as "Anyone".
 */
function isAllowedChat_(chatId) {
  const allowed = getProp_('ALLOWED_CHAT_IDS');
  if (!allowed) {
    trace_('allowlist.open', 'ALLOWED_CHAT_IDS not set');
    return true;
  }

  const ids = allowed.split(',').map(function (id) { return id.trim(); });
  const match = ids.indexOf(String(chatId)) !== -1;
  trace_('allowlist.check', 'chatId=' + chatId + ' configured=[' + ids.join(', ') + '] match=' + match);
  return match;
}

/**
 * Runs extraction on a text or photo message and logs the result.
 * `photoFileId` is null for text-only messages.
 */
function handleExpenseInput_(chatId, message, photoFileId) {
  // message.date is seconds since epoch. If it were ever missing, the old
  // code threw here - outside every try - and the request ended with no reply
  // and no log. Compute it defensively and trace what was used.
  let messageDate;
  try {
    const seconds = Number(message.date);
    const stamp = isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
    messageDate = formatDateCairo_(stamp);
    trace_('date.resolved', 'raw=' + message.date + ' -> ' + messageDate);
  } catch (err) {
    traceError_('date.resolve', err);
    messageDate = todayCairo_();
  }

  const caption = (message.caption || '').trim();

  let extraction;
  try {
    trace_('gemini.start', photoFileId ? 'photo' : 'text');
    extraction = photoFileId
      ? extractFromPhoto_(photoFileId, caption, messageDate)
      : extractFromText_(message.text, messageDate);
    trace_('gemini.done', extraction);
  } catch (err) {
    traceError_('gemini', err);
    sendTelegramMessage(chatId,
      "⚠️ Couldn't read that just now.\n" + String(err.message).slice(0, 300));
    return;
  }

  // Never write a half-understood expense - ask instead. All-or-nothing
  // across the message: a partial write would be duplicated if the user
  // resends the whole thing.
  if (extraction.needs_clarification) {
    trace_('clarify', 'count=' + extraction.expenses.length +
      ' question=' + JSON.stringify(extraction.clarification_question));
    // The hint matters: nothing is stored between messages, so the way out of
    // a clarification is to say so, and that has to be discoverable.
    sendTelegramMessage(chatId,
      (extraction.clarification_question || 'How much was it?') +
      '\n\n(or /cancel to drop it)');
    return;
  }

  const rawInput = photoFileId
    ? (caption ? 'Photo: ' + caption : 'Photo')
    : message.text;

  let ids;
  try {
    trace_('sheet.start', extraction.expenses.length + ' expense(s)');
    ids = appendExpenses_(extraction.expenses, rawInput);
    trace_('sheet.done', 'ids=' + ids.join(','));
  } catch (err) {
    traceError_('sheet', err);
    sendTelegramMessage(chatId,
      "⚠️ Couldn't save that to the sheet.\n" + String(err.message).slice(0, 300));
    return;
  }

  trace_('reply.start');
  sendTelegramMessage(chatId, formatConfirmation_(extraction.expenses));
  trace_('reply.done');
}

/**
 * One expense keeps the original two-line format. Several get a total plus
 * one line each, so a shopping trip stays readable in a phone notification.
 */
function formatConfirmation_(expenses) {
  if (expenses.length === 1) {
    const only = expenses[0];
    return '✅ Logged: ' + only.description + ' — ' +
      formatMoney_(only.amount) + ' ' + CONFIG.CURRENCY + '\n' +
      '📌 ' + only.item + ' · ' + only.type;
  }

  const total = expenses.reduce(function (sum, expense) {
    return sum + Number(expense.amount);
  }, 0);

  const lines = ['✅ Logged ' + expenses.length + ' expenses — ' +
    formatMoney_(total) + ' ' + CONFIG.CURRENCY + ' total'];

  expenses.forEach(function (expense) {
    lines.push('• ' + expense.description + ' — ' +
      formatMoney_(expense.amount) + ' · ' + expense.item);
  });

  return lines.join('\n');
}

/** Returns the file_id of the highest-resolution photo, or null. */
function extractPhotoFileId_(message) {
  if (message.photo && message.photo.length) {
    // Telegram orders photo sizes smallest to largest.
    return message.photo[message.photo.length - 1].file_id;
  }
  // Receipts sent from the gallery as a file arrive as a document.
  if (message.document && /^image\//.test(message.document.mime_type || '')) {
    return message.document.file_id;
  }
  return null;
}

/**
 * The deployed Web app URL.
 *
 * Must be the "Web app" URL from Manage deployments - the one under
 * /macros/s/<deploymentId>/exec. The dialog also shows a "Library" URL
 * (/macros/library/d/<scriptId>/<version>) for the same deployment; that one
 * has no HTTP endpoint and makes every Telegram POST return 404.
 *
 * Redeploying an existing deployment keeps this URL, so it only changes if a
 * brand new deployment is created.
 */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzMyHDVOmTr3GR9wh92vysfzCxafR51oB0E23S-mTqsAHVGsponq2phN9nzMRDF5gQTEg/exec';

/**
 * The URL Telegram should call.
 *
 * Normally the Cloudflare Worker proxy (see worker/masrofna-proxy.js), set in
 * the WEBHOOK_URL script property. Telegram will not follow the 302 that
 * Apps Script serves /exec with, so registering WEB_APP_URL directly makes
 * Telegram mark every delivery failed and stall the queue behind it.
 */
function webhookUrl_() {
  const configured = getProp_('WEBHOOK_URL');
  return configured && configured.trim() ? configured.trim() : WEB_APP_URL;
}

/**
 * Run once from the Apps Script editor after deploying, or whenever the
 * proxy URL changes, to tell Telegram where to send updates.
 */
function setWebhook() {
  const url = webhookUrl_();

  if (!/^https:\/\//.test(url)) {
    throw new Error('WEBHOOK_URL must be an https URL. Got: ' + url);
  }
  if (url.indexOf('/macros/library/') !== -1) {
    throw new Error('That is the Library URL, which has no HTTP endpoint. ' +
      'Use the "Web app" entry from Manage deployments.');
  }
  if (url === WEB_APP_URL) {
    console.warn('Registering the Apps Script URL directly. Telegram does not ' +
      'follow its 302, so deliveries will be marked failed and the update ' +
      'queue will stall. Set WEBHOOK_URL to the Cloudflare Worker instead.');
  }

  const token = requireProp_('TELEGRAM_BOT_TOKEN');
  let request = 'https://api.telegram.org/bot' + token + '/setWebhook' +
    '?url=' + encodeURIComponent(url) +
    '&drop_pending_updates=true';

  // Must match TELEGRAM_SECRET_TOKEN in the Worker, when that is configured.
  const secret = getProp_('TELEGRAM_SECRET_TOKEN');
  if (secret) {
    request += '&secret_token=' + encodeURIComponent(secret.trim());
  }

  const response = UrlFetchApp.fetch(request, { muteHttpExceptions: true });
  console.log('Registered: ' + url);
  console.log(response.getContentText());
}

/**
 * Diagnostic: shows what Telegram currently thinks the webhook is, including
 * the last delivery error. Safer than opening the getWebhookInfo URL in a
 * browser, which puts the bot token into browser history.
 */
function getWebhookInfo() {
  const token = requireProp_('TELEGRAM_BOT_TOKEN');
  const response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/getWebhookInfo',
    { muteHttpExceptions: true });

  const info = JSON.parse(response.getContentText());
  console.log(JSON.stringify(info, null, 2));

  const expected = webhookUrl_();
  if (info.result && info.result.url !== expected) {
    console.warn('Registered webhook is ' + info.result.url +
      ' but this script expects ' + expected + '. Run setWebhook.');
  }
  if (info.result && info.result.pending_update_count > 0) {
    console.warn('pending_update_count=' + info.result.pending_update_count +
      '. Telegram is not accepting the webhook response, so the queue is ' +
      'stalled. Check that WEBHOOK_URL points at the Cloudflare Worker.');
  }
}

/**
 * Diagnostic: reports which Script Properties are set, without ever printing
 * their values. Run manually from the editor.
 */
function checkSetup() {
  const props = PropertiesService.getScriptProperties();
  ['TELEGRAM_BOT_TOKEN', 'SHEET_ID', 'GEMINI_API_KEY'].forEach(function (key) {
    console.log(key + ': ' + (props.getProperty(key) ? 'SET' : 'MISSING'));
  });
  console.log('GEMINI_MODEL: ' + (getProp_('GEMINI_MODEL') || CONFIG.GEMINI_MODEL + ' (default)'));
  console.log('ALLOWED_CHAT_IDS: ' + (getProp_('ALLOWED_CHAT_IDS') ? 'SET' : 'not set (all chats allowed)'));

  try {
    const sheet = getExpenseSheet_();
    console.log('Sheet "' + sheet.getName() + '" reachable, rows: ' + sheet.getLastRow());
  } catch (err) {
    console.error('Sheet check failed: ' + err.message);
  }
}
