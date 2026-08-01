/**
 * Masrofna Bot - expense extraction via the Gemini API.
 *
 * Uses generateContent with a locked responseSchema, so the model can only
 * return the fields and enum values we accept. Everything is still re-checked
 * in normalizeExtraction_ before it reaches the sheet.
 */

/**
 * Built on demand rather than as a top-level const: Apps Script evaluates
 * .gs files in project order, so referencing Config.gs constants at load time
 * would break if the file order ever changed.
 */
function buildExtractionSchema_() {
  return {
    type: 'object',
    properties: {
      expenses: {
        type: 'array',
        description: 'One object per distinct purchase in the message',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'DD-MM-YYYY' },
            amount: { type: 'number', nullable: true, description: 'Total in EGP' },
            description: { type: 'string', description: '2-5 words' },
            item: { type: 'string', enum: ITEMS },
            type: { type: 'string', enum: TYPES },
            payment_method: { type: 'string', enum: PAYMENT_METHODS },
            beneficiary: { type: 'string', enum: BENEFICIARIES }
          },
          required: [
            'date', 'amount', 'description', 'item', 'type',
            'payment_method', 'beneficiary'
          ],
          propertyOrdering: [
            'date', 'amount', 'description', 'item', 'type',
            'payment_method', 'beneficiary'
          ]
        }
      },
      needs_clarification: { type: 'boolean' },
      clarification_question: { type: 'string', nullable: true }
    },
    required: ['expenses', 'needs_clarification'],
    propertyOrdering: ['needs_clarification', 'clarification_question', 'expenses']
  };
}

/** Builds the system instruction, injecting the message's own date. */
function buildSystemInstruction_(messageDate) {
  return [
    'You extract expense records from a personal-finance message and return JSON only.',
    'The user lives in Egypt. Amounts are Egyptian Pounds (EGP) unless stated otherwise.',
    'Input may be English, Arabic, or franco-Arabic. All output field values must be English.',
    '',
    'MULTIPLE EXPENSES',
    '- A message may list several separate purchases, often one per line.',
    '  Return one object in "expenses" for each distinct purchase.',
    '- A single expense is still an array, with one object in it.',
    '- Do not split one purchase into parts, and do not merge separate purchases.',
    '  "2 kilos of milk for 70" is ONE expense of 70, not two of 35.',
    '- Each expense gets its own date, payment method and beneficiary. Apply a',
    '  detail stated once for the whole message (e.g. "all on instapay") to every',
    '  expense in it.',
    '',
    'RULES',
    '- date: DD-MM-YYYY. Default to ' + messageDate + ' unless the user explicitly states another date',
    '  (e.g. "yesterday", "last Friday", "on 3 July"), in which case compute it relative to ' + messageDate + '.',
    '- amount: the total number paid, digits only, no currency symbol.',
    '- description: 2-5 words, no amount, no date. e.g. "Taxi to work", "Weekly groceries".',
    '- item: exactly one from the Item list.',
    '- type: exactly one from the Type list, always assigned in addition to the item.',
    '- payment_method: default "Cash" when not mentioned.',
    '- beneficiary: default "Personal" when not mentioned. Tamim is the user\'s son,',
    '  Asmaa is the user\'s wife. Use "Family" for the household as a whole.',
    '',
    'CLARIFICATION',
    '- If the amount or what was bought cannot be determined confidently for ANY',
    '  expense in the message, set needs_clarification to true and put ONE short',
    '  question in clarification_question. Name which item is unclear when the',
    '  message contains several.',
    '- Never invent an amount or a description. Guessing is worse than asking.',
    '- When needs_clarification is true, still return your best effort in "expenses".',
    '',
    'Item list: ' + ITEMS.join(' | '),
    'Type list: ' + TYPES.join(' | '),
    '',
    'Item guidance:',
    '- Education: school and nursery fees, tuition, courses, textbooks, stationery',
    '  and school supplies, exam and enrolment fees. Anything paid FOR schooling.',
    '- Family Allowance: discretionary spending money handed to Tamim or Asmaa to',
    '  use as they wish. Not school costs, which are Education.',
    '',
    'Type guidance:',
    '- Commitments: recurring or obligatory (rent, bills, tuition, installments, allowance).',
    '- Consumption Expenses: day-to-day living (groceries, transport, medicine, household).',
    '- Luxury / Leisure: optional enjoyment (dining out, outings, entertainment, gifts to self).',
    '- Investment: savings, insurance, assets, anything that retains or grows value.'
  ].join('\n');
}

/** Extracts an expense from a text message. */
function extractFromText_(text, messageDate) {
  return callGemini_([{ text: 'Expense message:\n' + text }], messageDate);
}

/** Extracts an expense from a photo (receipt), with an optional caption. */
function extractFromPhoto_(fileId, caption, messageDate) {
  const blob = downloadTelegramFile_(fileId);
  const mimeType = blob.getContentType() || 'image/jpeg';

  const parts = [{
    inlineData: {
      mimeType: mimeType,
      data: Utilities.base64Encode(blob.getBytes())
    }
  }];

  parts.push({
    text: caption
      ? 'Receipt photo. User note: ' + caption + '\nRead the total from the receipt.'
      : 'Receipt photo. Read the total paid and what was bought.'
  });

  return callGemini_(parts, messageDate);
}

/** The API version to call, overridable via the GEMINI_API_VERSION property. */
function geminiApiVersion_() {
  return String(getProp_('GEMINI_API_VERSION') || CONFIG.GEMINI_API_VERSION).trim();
}

/**
 * The model name to call. Set the GEMINI_MODEL script property to change it -
 * no code change or redeploy required.
 *
 * IF /ping OR AN EXPENSE STARTS RETURNING 404, THE MODEL WAS PROBABLY RETIRED.
 * Run /models (or testGeminiModels in the editor) and pick a current name from
 * https://ai.google.dev/gemini-api/docs/models, then update the property.
 * Note that a retired model can still appear in ListModels for a while even
 * though generateContent already 404s on it - that is how gemini-2.5-flash-lite
 * failed here, so trust the 404 over the listing.
 *
 * Trims whitespace and strips a leading "models/", because the docs and the
 * ListModels response both use the fully-qualified "models/<name>" form while
 * the request path already supplies the "models/" segment. Pasting the
 * qualified name into the GEMINI_MODEL property would otherwise produce
 * .../models/models/<name>:generateContent - a 404.
 */
function geminiModelName_() {
  const raw = String(getProp_('GEMINI_MODEL') || CONFIG.GEMINI_MODEL).trim();
  return raw.replace(/^models\//, '');
}

/** Builds a fully-qualified Generative Language API URL. */
function geminiUrl_(path) {
  return CONFIG.GEMINI_HOST + '/' + geminiApiVersion_() + '/' + path;
}

/** Calls generateContent and returns a normalized extraction object. */
function callGemini_(parts, messageDate) {
  const apiKey = requireProp_('GEMINI_API_KEY');
  const model = geminiModelName_();

  const generationConfig = {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: buildExtractionSchema_()
  };

  // Thinking costs latency, which matters on a webhook Telegram will retry.
  // The two model families take different knobs and an invalid one is a 400,
  // so send each only where it is valid:
  //   2.5  -> thinkingBudget: 0 disables thinking outright
  //   3.x  -> thinkingLevel, opt-in via GEMINI_THINKING_LEVEL (e.g. "low"),
  //           left unset by default so the API default applies
  if (model.indexOf('gemini-2.5') === 0) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  } else {
    const thinkingLevel = getProp_('GEMINI_THINKING_LEVEL');
    if (thinkingLevel) {
      generationConfig.thinkingConfig = { thinkingLevel: thinkingLevel.trim() };
    }
  }

  const payload = {
    systemInstruction: { parts: [{ text: buildSystemInstruction_(messageDate) }] },
    contents: [{ role: 'user', parts: parts }],
    generationConfig: generationConfig
  };

  // The key goes in a header, not the URL, so it can never leak into a logged
  // error string.
  const endpoint = geminiUrl_('models/' + model + ':generateContent');
  trace_('gemini.request', 'POST ' + endpoint + ' parts=' + parts.length +
    ' keyLength=' + apiKey.length + ' keyPrefix=' + apiKey.slice(0, 5));

  let response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    traceError_('gemini.fetch', err);
    throw err;
  }

  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status !== 200) {
    // Log the whole body, not a summary. The API's own error message names
    // the exact problem (bad model, wrong API version, disabled API), and
    // it never echoes the key back - that stays in the request header.
    trace_('gemini.error', 'status=' + status + ' endpoint=' + endpoint + ' body=' + text);
    throw new Error('Gemini ' + status + ' for ' + endpoint + '\n' + text.slice(0, 600));
  }

  trace_('gemini.response', 'status=' + status + ' bytes=' + text.length);

  const body = JSON.parse(text);
  const candidate = body.candidates && body.candidates[0];
  const responseParts = candidate && candidate.content && candidate.content.parts;

  if (body.usageMetadata) {
    trace_('gemini.usage', body.usageMetadata);
  }

  if (!responseParts || !responseParts.length) {
    throw new Error('Gemini returned no content (finishReason: ' +
      (candidate ? candidate.finishReason : 'none') + ', body: ' + text.slice(0, 300) + ')');
  }

  const raw = responseParts.map(function (p) { return p.text || ''; }).join('');
  trace_('gemini.raw', raw.slice(0, 600));
  return normalizeExtraction_(parseJsonLoose_(raw), messageDate);
}

/**
 * Asks the API which models this key can actually reach, which is exactly
 * what a 404 from generateContent tells you to do. Returns a report string.
 *
 * Probes each API version so a version mismatch is visible rather than
 * inferred, and never prints the key.
 */
function probeGeminiModels_() {
  const apiKey = requireProp_('GEMINI_API_KEY');
  const lines = [
    'Key: ' + apiKey.length + ' chars, prefix "' + apiKey.slice(0, 5) + '"',
    'Configured: ' + geminiModelName_() + ' on ' + geminiApiVersion_()
  ];

  ['v1beta', 'v1'].forEach(function (version) {
    const url = CONFIG.GEMINI_HOST + '/' + version + '/models?pageSize=200';
    lines.push('');
    lines.push('--- ' + version + ' ---');

    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'x-goog-api-key': apiKey },
        muteHttpExceptions: true
      });
    } catch (err) {
      lines.push('fetch failed: ' + err);
      return;
    }

    const status = response.getResponseCode();
    const text = response.getContentText();

    if (status !== 200) {
      lines.push('HTTP ' + status + ': ' + text.slice(0, 300));
      return;
    }

    let models;
    try {
      models = JSON.parse(text).models || [];
    } catch (err) {
      lines.push('unparseable response: ' + text.slice(0, 200));
      return;
    }

    const usable = models.filter(function (m) {
      const methods = m.supportedGenerationMethods || [];
      return methods.indexOf('generateContent') !== -1;
    }).map(function (m) {
      return String(m.name).replace(/^models\//, '');
    });

    lines.push(usable.length + ' models support generateContent');

    // Flash-Lite first - that is what this bot wants.
    const lite = usable.filter(function (n) { return n.indexOf('flash-lite') !== -1; });
    if (lite.length) lines.push('flash-lite: ' + lite.join(', '));

    const flash = usable.filter(function (n) {
      return n.indexOf('flash') !== -1 && n.indexOf('flash-lite') === -1;
    });
    if (flash.length) lines.push('flash: ' + flash.slice(0, 10).join(', '));

    lines.push('configured model present: ' + (usable.indexOf(geminiModelName_()) !== -1));
  });

  return lines.join('\n');
}

/** Parses JSON, tolerating a stray markdown code fence. */
function parseJsonLoose_(text) {
  const cleaned = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    traceError_('gemini.parse (retrying on brace slice)', err);
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Gemini response was not valid JSON: ' + cleaned.slice(0, 200));
  }
}

/**
 * Normalizes the model response into { expenses, needs_clarification,
 * clarification_question }.
 *
 * Clarification is all-or-nothing across the message: if any one expense is
 * unusable, nothing is logged. Logging a partial set would mean the user has
 * to resend, and resending the whole message would then duplicate the rows
 * that did go through.
 */
function normalizeExtraction_(raw, messageDate) {
  const data = raw || {};
  const list = Array.isArray(data.expenses) ? data.expenses : [];
  const expenses = list.map(function (entry) {
    return normalizeExpense_(entry, messageDate);
  });

  const anyUnusable = expenses.some(function (expense) {
    return !isValidAmount_(expense.amount) || !expense.description;
  });

  return {
    expenses: expenses,
    needs_clarification: data.needs_clarification === true ||
      expenses.length === 0 ||
      anyUnusable,
    clarification_question: typeof data.clarification_question === 'string' &&
      data.clarification_question.trim()
      ? data.clarification_question.trim()
      : null
  };
}

/** Clamps one expense's fields to the fixed lists and applies the defaults. */
function normalizeExpense_(raw, messageDate) {
  const data = raw || {};
  const amount = Number(data.amount);
  const description = typeof data.description === 'string' ? data.description.trim() : '';

  return {
    date: parseDdMmYyyy_(data.date) ? data.date.trim() : messageDate,
    amount: isValidAmount_(amount) ? amount : null,
    description: description,
    item: matchFromList_(data.item, ITEMS, DEFAULTS.ITEM),
    type: matchFromList_(data.type, TYPES, DEFAULTS.TYPE),
    payment_method: matchFromList_(data.payment_method, PAYMENT_METHODS, DEFAULTS.PAYMENT_METHOD),
    beneficiary: matchFromList_(data.beneficiary, BENEFICIARIES, DEFAULTS.BENEFICIARY)
  };
}
