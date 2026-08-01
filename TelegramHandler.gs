/**
 * Masrofna Bot - Telegram Bot API calls.
 */

/** Sends a plain-text reply. No parse_mode, so nothing needs escaping. */
function sendTelegramMessage(chatId, text) {
  const token = requireProp_('TELEGRAM_BOT_TOKEN');
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      // Telegram rejects messages over 4096 characters.
      payload: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000) }),
      muteHttpExceptions: true
    });
  } catch (err) {
    traceError_('telegram.sendMessage fetch', err);
    throw err;
  }

  const status = response.getResponseCode();
  if (status !== 200) {
    // Telegram error bodies do not contain the token, so this is safe to log.
    traceError_('telegram.sendMessage status=' + status,
      new Error(response.getContentText().slice(0, 300)));
  } else {
    // Recorded so dedup can treat a replied-to update as handled even if a
    // later step throws - otherwise a retry would send the reply twice.
    markReplySent_();
    trace_('telegram.sent', 'chatId=' + chatId + ' chars=' + String(text).length);
  }
}

/**
 * Downloads a Telegram file by file_id via getFile -> file download.
 *
 * Returns { blob, filePath }. The path is carried out because the download
 * response is served as application/octet-stream, so its extension is one of
 * the few hints available about what the file actually is.
 */
function downloadTelegramFile_(fileId) {
  const token = requireProp_('TELEGRAM_BOT_TOKEN');
  trace_('telegram.getFile', 'fileId=' + fileId);

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

  const blob = fileResponse.getBlob();
  trace_('telegram.fileDownloaded', 'path=' + info.result.file_path +
    ' servedType=' + blob.getContentType() + ' bytes=' + blob.getBytes().length);

  return { blob: blob, filePath: info.result.file_path };
}
