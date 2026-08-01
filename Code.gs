/**
 * Masrofna Bot - Expense Tracker
 * Step 1: Basic Telegram webhook handler (connectivity test only)
 *
 * This version does NOT call Gemini or write to the Sheet yet.
 * It only confirms that Telegram -> Apps Script webhook is working
 * by echoing back whatever text message it receives.
 */

function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);

    // Only handle plain text messages for this first test
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      sendTelegramMessage(chatId, "Got it: " + text);
    }

    return ContentService.createTextOutput("OK");
  } catch (err) {
    // Log the error so we can debug from Apps Script's execution log
    console.error("doPost error: " + err.message);
    return ContentService.createTextOutput("Error");
  }
}

function sendTelegramMessage(chatId, text) {
  const token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN");
  const url = "https://api.telegram.org/bot" + token + "/sendMessage";

  const payload = {
    chat_id: chatId,
    text: text
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  UrlFetchApp.fetch(url, options);
}

/**
 * Run this ONCE manually from the Apps Script editor after deploying
 * the Web App, to tell Telegram where to send updates.
 * Replace WEB_APP_URL with the deployment URL you get after `clasp deploy`.
 */
function setWebhook() {
  const token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN");
  const webAppUrl = "https://script.google.com/macros/s/AKfycbzRf-JgFH5RQPBJ3qGVQR5PH0Uqj8mPqCirGFe4KEu2UR6QsNa3SjUJB5k3F7J-eEi7dg/exec";

  const url = "https://api.telegram.org/bot" + token + "/setWebhook?url=" + encodeURIComponent(webAppUrl);
  const response = UrlFetchApp.fetch(url);
  console.log(response.getContentText());
}