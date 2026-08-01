/**
 * Masrofna Bot - editor-run tests.
 *
 * These call doPost directly with a synthetic Telegram update, so the whole
 * pipeline can be exercised from the Apps Script editor. The editor's own
 * execution log always renders, unlike web app execution rows in the
 * Executions list - which is what made the @5 regression hard to see.
 *
 * Select a function in the editor toolbar and press Run.
 */

/** Simulates the /help command end to end. */
function testHelp() {
  runSyntheticUpdate_('/help');
}

/** Simulates the /ping connectivity check. */
function testPing() {
  runSyntheticUpdate_('/ping');
}

/** Simulates a plain expense message: Gemini extraction plus a sheet write. */
function testExpense() {
  runSyntheticUpdate_('120 taxi to work');
}

/** Simulates the monthly report. */
function testReport() {
  runSyntheticUpdate_('/report');
}

/**
 * Builds a Telegram-shaped update, feeds it to doPost, and reports both the
 * HTTP body doPost produced and the trace it recorded.
 *
 * "doPost returned: NOTHING" is the signal that doPost threw instead of
 * returning - the failure mode that makes every message fail at once.
 */
function runSyntheticUpdate_(text) {
  const chatId = firstAllowedChatId_();
  console.log('Simulating ' + JSON.stringify(text) + ' from chatId ' + chatId);

  const update = {
    update_id: Date.now(), // Always unique, so dedup never skips the test.
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      text: text
    }
  };

  const output = doPost({ postData: { contents: JSON.stringify(update) } });

  console.log('doPost returned: ' + (output ? JSON.stringify(output.getContent()) : 'NOTHING'));
  console.log('--- trace ---\n' + traceCurrent_());
}

/**
 * The chat to send test replies to: the first entry in ALLOWED_CHAT_IDS, or
 * TEST_CHAT_ID when the allowlist is open.
 */
function firstAllowedChatId_() {
  const allowed = getProp_('ALLOWED_CHAT_IDS');
  if (allowed && allowed.trim()) {
    return Number(allowed.split(',')[0].trim());
  }

  const testChat = getProp_('TEST_CHAT_ID');
  if (testChat) return Number(testChat);

  throw new Error('Set ALLOWED_CHAT_IDS or TEST_CHAT_ID in Script Properties ' +
    'so the test knows where to send replies. Send /id to the bot to get yours.');
}

/**
 * Dumps the last persisted trace, whichever execution produced it - editor
 * run or Telegram-delivered web app request. This is the primary diagnostic
 * when the Executions list will not expand web app rows.
 *
 * Same content as Project Settings -> Script Properties -> LAST_TRACE.
 */
function showLastTrace() {
  console.log(traceLoad_());
}

/**
 * Proves the deployed authorization actually covers writing to the sheet,
 * not just reading it. Appends a row, reads it back, then deletes it.
 *
 * Note that SpreadsheetApp.openById already requires the same
 * https://www.googleapis.com/auth/spreadsheets scope that appendRow does -
 * Apps Script has no separate read-only spreadsheet scope - so a working
 * /ping already implies write access. This makes that explicit rather than
 * inferred.
 */
function testSheetWrite() {
  const sheet = getExpenseSheet_();
  console.log('Sheet "' + sheet.getName() + '" rows before: ' + sheet.getLastRow());

  sheet.appendRow(['TEST-DELETE-ME', new Date(), 'scope probe', 0, '', '', '', '', 'testSheetWrite']);
  SpreadsheetApp.flush();

  const row = sheet.getLastRow();
  const wrote = sheet.getRange(row, COLUMNS.ID).getValue();
  console.log('Wrote row ' + row + ' with ID ' + wrote);

  sheet.deleteRow(row);
  SpreadsheetApp.flush();
  console.log('Test row removed. Rows after: ' + sheet.getLastRow());
  console.log('WRITE SCOPE OK');
}

/**
 * Lists the Gemini models the configured key can reach, on every API version.
 * Run this first when generateContent returns 404 - it answers which model
 * name and API version are actually valid, instead of guessing.
 */
function testGeminiModels() {
  console.log(probeGeminiModels_());
}

/**
 * Verifies the tracing layer cannot throw, since that is what took down every
 * request in @5. Run this after any change to Trace.gs.
 */
function testTraceIsSafe() {
  const circular = {};
  circular.self = circular; // JSON.stringify throws on this.

  trace_('probe.string', 'plain');
  trace_('probe.object', { a: 1 });
  trace_('probe.circular', circular);
  trace_('probe.undefined', undefined);
  trace_('probe.null', null);
  traceError_('probe.error', new Error('synthetic'));
  traceError_('probe.nonError', 'just a string');
  traceSave_();

  console.log('Tracing survived every input. Trace:\n' + traceCurrent_());
}

/**
 * Confirms the registered webhook matches this script's WEB_APP_URL.
 * Run this whenever a deployment is created or changed.
 */
function testWebhookMatchesDeployment() {
  getWebhookInfo();
  console.log('Expected url: ' + WEB_APP_URL);
}
