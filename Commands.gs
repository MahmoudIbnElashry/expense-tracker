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
    console.error('Report failed: ' + (err && err.stack ? err.stack : err));
    sendTelegramMessage(chatId, "⚠️ Couldn't build the report. Please try again.");
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
    '/id — show this chat ID'
  ].join('\n');
}
