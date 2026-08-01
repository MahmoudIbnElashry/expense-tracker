/**
 * Masrofna Bot - Telegram to Apps Script webhook proxy (Cloudflare Worker).
 *
 * WHY THIS EXISTS
 * ---------------
 * Apps Script serves /exec with a 302 to script.googleusercontent.com, where
 * the actual response body lives. Telegram does not follow that redirect - it
 * reports "Wrong response from the webhook: 302 Found" and treats the delivery
 * as failed. Because Telegram delivers updates strictly in order and will not
 * advance past an unacknowledged one, every message ends up blocking the next,
 * even when the script processed it perfectly.
 *
 * The redirect is emitted by Google's frontend before the script's response is
 * ever served, so no change inside doPost can prevent it. This Worker sits in
 * front, follows the redirect itself, and hands Telegram a clean 200.
 *
 *   Telegram --POST--> Worker --POST--> /exec --302--> googleusercontent
 *                        |                                    |
 *                        |<--------- follows, gets 200 -------+
 *                        |
 *              returns a plain 200 to Telegram
 *
 * Measured behaviour of the redirect target: GET returns 200 text/plain "OK",
 * POST returns 405. The Fetch standard changes the method to GET when
 * following a 302, which is why redirect: 'follow' lands on the working path.
 *
 * DEPLOY
 * ------
 *   1. npm create cloudflare@latest masrofna-proxy   (or paste into the
 *      dashboard: Workers & Pages -> Create -> Worker -> Edit code)
 *   2. Set the APPS_SCRIPT_URL variable (Settings -> Variables) to the
 *      Web app /exec URL. Falls back to the constant below if unset.
 *   3. Optional but recommended: set TELEGRAM_SECRET_TOKEN to any random
 *      string, and set the matching TELEGRAM_SECRET_TOKEN script property in
 *      Apps Script, so only Telegram can drive this endpoint.
 *   4. Copy the Worker URL (https://<name>.<subdomain>.workers.dev) into the
 *      WEBHOOK_URL script property in Apps Script, then run setWebhook.
 */

// Fallback if the APPS_SCRIPT_URL environment variable is not set.
const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzMyHDVOmTr3GR9wh92vysfzCxafR51oB0E23S-mTqsAHVGsponq2phN9nzMRDF5gQTEg/exec';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      // Handy for eyeballing in a browser; Telegram only ever POSTs.
      return new Response('Masrofna proxy is up. POST only.\n', { status: 405 });
    }

    // Only enforced when configured, so adding the secret later cannot lock
    // out a working bot before setWebhook has been re-run with it.
    const secret = env.TELEGRAM_SECRET_TOKEN;
    if (secret && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      return new Response('Forbidden\n', { status: 403 });
    }

    const body = await request.text();
    const target = env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;

    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // The whole point: follow the 302 that Telegram refuses to.
        redirect: 'follow'
      });
    } catch (err) {
      // Apps Script unreachable - nothing was processed, so let Telegram
      // retry. The script's dedup releases unhandled updates for exactly this.
      return new Response('Upstream unreachable: ' + err + '\n', { status: 502 });
    }

    // Drain the body so the subrequest is cleanly finished.
    const text = await upstream.text().catch(() => '');

    // A non-200 from Apps Script still means the update reached doPost, which
    // handles its own errors and replies to the user directly. Acknowledge so
    // Telegram advances the queue rather than redelivering forever.
    return new Response(
      'OK (upstream ' + upstream.status + ': ' + text.slice(0, 100) + ')\n',
      { status: 200, headers: { 'Content-Type': 'text/plain' } }
    );
  }
};
