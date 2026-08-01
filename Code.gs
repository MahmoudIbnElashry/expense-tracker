/**
 * Masrofna Bot - Telegram expense tracker.
 *
 * Entry point and update routing. Flow:
 *   Telegram -> doPost -> dedup by update_id -> route
 *     /command      -> Commands.gs
 *     text or photo -> GeminiExtractor.gs -> SheetWriter.gs -> confirmation
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('OK');
    }

    const update = JSON.parse(e.postData.contents);
    if (!update || typeof update.update_id === 'undefined') {
      return ContentService.createTextOutput('OK');
    }

    if (isDuplicateUpdate_(update.update_id)) {
      console.log('Skipping duplicate update_id ' + update.update_id);
      return ContentService.createTextOutput('OK');
    }

    handleUpdate_(update);
  } catch (err) {
    console.error('doPost error: ' + (err && err.stack ? err.stack : err));
  }

  // Always 200 OK. Any non-200 (or a timeout) makes Telegram redeliver the
  // same update, which is what caused the duplicate replies.
  return ContentService.createTextOutput('OK');
}

/**
 * Returns true if this update_id was already claimed by an earlier call.
 *
 * The check-and-set pair runs under a script lock so two concurrent
 * redeliveries of the same update cannot both see an empty cache. The claim is
 * recorded *before* processing, so a slow run that Telegram gives up on will
 * not be processed twice.
 */
function isDuplicateUpdate_(updateId) {
  const cache = CacheService.getScriptCache();
  const key = 'update_' + updateId;
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  } catch (err) {
    // Could not get the lock in time - another invocation is almost certainly
    // handling this same update. Treat as duplicate rather than risk a double.
    console.warn('Dedup lock timeout for update_id ' + updateId);
    return true;
  }

  try {
    if (cache.get(key)) return true;
    cache.put(key, '1', CONFIG.DEDUP_TTL_SECONDS);
    return false;
  } finally {
    lock.releaseLock();
  }
}

/** Routes a single Telegram update. */
function handleUpdate_(update) {
  const message = update.message || update.edited_message;
  if (!message || !message.chat) return;

  const chatId = message.chat.id;
  if (!isAllowedChat_(chatId)) {
    console.warn('Ignoring message from unauthorized chat ' + chatId);
    return;
  }

  const text = (message.text || '').trim();

  if (text.charAt(0) === '/') {
    handleCommand_(chatId, text);
    return;
  }

  const photoFileId = extractPhotoFileId_(message);
  if (photoFileId) {
    handleExpenseInput_(chatId, message, photoFileId);
    return;
  }

  if (text) {
    handleExpenseInput_(chatId, message, null);
    return;
  }

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
  if (!allowed) return true;

  const ids = allowed.split(',').map(function (id) { return id.trim(); });
  return ids.indexOf(String(chatId)) !== -1;
}

/**
 * Runs extraction on a text or photo message and logs the result.
 * `photoFileId` is null for text-only messages.
 */
function handleExpenseInput_(chatId, message, photoFileId) {
  const messageDate = formatDateCairo_(new Date(message.date * 1000));
  const caption = (message.caption || '').trim();

  let extraction;
  try {
    extraction = photoFileId
      ? extractFromPhoto_(photoFileId, caption, messageDate)
      : extractFromText_(message.text, messageDate);
  } catch (err) {
    console.error('Extraction failed: ' + (err && err.stack ? err.stack : err));
    sendTelegramMessage(chatId, "⚠️ Couldn't read that just now. Please send it again.");
    return;
  }

  // Never write a half-understood expense - ask instead.
  if (extraction.needs_clarification || !isValidAmount_(extraction.amount) || !extraction.description) {
    sendTelegramMessage(chatId, extraction.clarification_question || 'How much was it?');
    return;
  }

  const rawInput = photoFileId
    ? (caption ? 'Photo: ' + caption : 'Photo')
    : message.text;

  try {
    appendExpense_(extraction, rawInput);
  } catch (err) {
    console.error('Sheet write failed: ' + (err && err.stack ? err.stack : err));
    sendTelegramMessage(chatId, "⚠️ Couldn't save that to the sheet. Please try again.");
    return;
  }

  sendTelegramMessage(chatId,
    '✅ Logged: ' + extraction.description + ' — ' + formatMoney_(extraction.amount) + ' ' + CONFIG.CURRENCY + '\n' +
    '📌 ' + extraction.item + ' · ' + extraction.type);
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
 * Run once from the Apps Script editor after deploying, to point Telegram at
 * this web app. Replace the URL if you create a new deployment.
 */
function setWebhook() {
  const token = requireProp_('TELEGRAM_BOT_TOKEN');
  const webAppUrl = 'https://script.google.com/macros/s/AKfycbzRf-JgFH5RQPBJ3qGVQR5PH0Uqj8mPqCirGFe4KEu2UR6QsNa3SjUJB5k3F7J-eEi7dg/exec';

  const url = 'https://api.telegram.org/bot' + token + '/setWebhook' +
    '?url=' + encodeURIComponent(webAppUrl) +
    '&drop_pending_updates=true';

  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  console.log(response.getContentText());
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
