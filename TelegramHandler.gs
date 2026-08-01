/**
 * Masrofna Bot - Telegram Bot API calls.
 */

/** Sends a plain-text reply. No parse_mode, so nothing needs escaping. */
function sendTelegramMessage(chatId, text) {
  const token = requireProp_('TELEGRAM_BOT_TOKEN');
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    console.error('sendMessage failed (' + response.getResponseCode() + '): ' +
      response.getContentText().slice(0, 300));
  }
}

/**
 * Downloads a Telegram file by file_id via getFile -> file download.
 * Returns a Blob.
 */
function downloadTelegramFile_(fileId) {
  const token = requireProp_('TELEGRAM_BOT_TOKEN');

  const infoResponse = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/getFile?file_id=' + encodeURIComponent(fileId),
    { muteHttpExceptions: true });

  if (infoResponse.getResponseCode() !== 200) {
    throw new Error('getFile failed with status ' + infoResponse.getResponseCode());
  }

  const info = JSON.parse(infoResponse.getContentText());
  if (!info.ok || !info.result || !info.result.file_path) {
    throw new Error('getFile returned no file_path');
  }

  const fileResponse = UrlFetchApp.fetch(
    'https://api.telegram.org/file/bot' + token + '/' + info.result.file_path,
    { muteHttpExceptions: true });

  if (fileResponse.getResponseCode() !== 200) {
    throw new Error('File download failed with status ' + fileResponse.getResponseCode());
  }

  return fileResponse.getBlob();
}
