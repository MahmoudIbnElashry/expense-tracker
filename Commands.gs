/**
 * Masrofna Bot - slash command handling.
 */

function handleCommand_(chatId, text) {
  // Strip the @BotName suffix Telegram adds in groups.
  const parts = text.split(/\s+/);
  const command = parts[0].split('@')[0].toLowerCase();
  const argument = text.slice(parts[0].length).trim();

  switch (command) {
    case '/start':
    case '/help':
      sendTelegramMessage(chatId, helpText_());
      return;

    case '/report':
      handleReportCommand_(chatId, argument);
      return;

    case '/id':
      sendTelegramMessage(chatId, 'This chat ID: ' + chatId);
      return;

    case '/debug':
      handleDebugCommand_(chatId);
      return;

    case '/ping':
      handlePingCommand_(chatId);
      return;

    case '/models':
      handleModelsCommand_(chatId);
      return;

    default:
      sendTelegramMessage(chatId, 'Unknown command. Try /help.');
  }
}

function handleReportCommand_(chatId, argument) {
  const period = parseReportPeriod_(argument);
  if (!period) {
    sendTelegramMessage(chatId, 'Try /report July 2026 — or just /report for this month.');
    return;
  }

  try {
    sendTelegramMessage(chatId, buildMonthlyReport_(period.month, period.year));
  } catch (err) {
    traceError_('report', err);
    sendTelegramMessage(chatId,
      "⚠️ Couldn't build the report.\n" + String(err.message).slice(0, 300));
  }
}

/**
 * Sends back the trace from the *previous* message, since the current /debug
 * execution overwrites the stored trace when it finishes.
 */
function handleDebugCommand_(chatId) {
  const previous = traceLoad_();
  sendTelegramMessage(chatId, 'Trace from the previous message:\n\n' + previous.slice(0, 3800));
}

/**
 * Checks each dependency in isolation and reports what works, so a failing
 * step can be identified without reading any logs.
 */
function handlePingCommand_(chatId) {
  const lines = ['Connectivity check'];

  ['TELEGRAM_BOT_TOKEN', 'SHEET_ID', 'GEMINI_API_KEY'].forEach(function (key) {
    const value = getProp_(key);
    lines.push((value ? '✅' : '❌') + ' ' + key + (value ? ' (' + value.length + ' chars)' : ' MISSING'));
  });

  lines.push('• model: ' + (getProp_('GEMINI_MODEL') || CONFIG.GEMINI_MODEL));
  lines.push('• allowlist: ' + (getProp_('ALLOWED_CHAT_IDS') || 'open'));
  lines.push('• this chat: ' + chatId);

  try {
    const sheet = getExpenseSheet_();
    lines.push('✅ sheet "' + sheet.getName() + '" rows=' + sheet.getLastRow());
  } catch (err) {
    lines.push('❌ sheet: ' + String(err.message).slice(0, 200));
  }

  try {
    const started = Date.now();
    const result = extractFromText_('test 5 coffee', todayCairo_());
    lines.push('✅ gemini ' + (Date.now() - started) + 'ms -> ' +
      result.item + ' / ' + result.amount);
  } catch (err) {
    lines.push('❌ gemini: ' + String(err.message).slice(0, 400));
  }

  sendTelegramMessage(chatId, lines.join('\n'));
}

/** Reports which Gemini models the configured key can actually reach. */
function handleModelsCommand_(chatId) {
  try {
    sendTelegramMessage(chatId, probeGeminiModels_());
  } catch (err) {
    traceError_('models', err);
    sendTelegramMessage(chatId, '⚠️ Model probe failed:\n' + String(err.message).slice(0, 500));
  }
}

function helpText_() {
  return [
    'Masrofna — expense tracker',
    '',
    'Just send what you spent, e.g.:',
    '• "120 taxi to work"',
    '• "اشتريت أكل بـ 350"',
    '• a photo of a receipt',
    '',
    'Commands:',
    '/report — this month\'s summary',
    '/report July 2026 — a specific month',
    '/id — show this chat ID',
    '/ping — check sheet + Gemini connectivity',
    '/models — list reachable Gemini models',
    '/debug — trace from the previous message'
  ].join('\n');
}
