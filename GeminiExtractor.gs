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
      date: { type: 'string', description: 'DD-MM-YYYY' },
      amount: { type: 'number', nullable: true, description: 'Total in EGP' },
      description: { type: 'string', description: '2-5 words' },
      item: { type: 'string', enum: ITEMS },
      type: { type: 'string', enum: TYPES },
      payment_method: { type: 'string', enum: PAYMENT_METHODS },
      beneficiary: { type: 'string', enum: BENEFICIARIES },
      needs_clarification: { type: 'boolean' },
      clarification_question: { type: 'string', nullable: true }
    },
    required: [
      'date', 'amount', 'description', 'item', 'type',
      'payment_method', 'beneficiary', 'needs_clarification'
    ],
    propertyOrdering: [
      'needs_clarification', 'clarification_question', 'date', 'amount',
      'description', 'item', 'type', 'payment_method', 'beneficiary'
    ]
  };
}

/** Builds the system instruction, injecting the message's own date. */
function buildSystemInstruction_(messageDate) {
  return [
    'You extract a single expense record from a personal-finance message and return JSON only.',
    'The user lives in Egypt. Amounts are Egyptian Pounds (EGP) unless stated otherwise.',
    'Input may be English, Arabic, or franco-Arabic. All output field values must be English.',
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
    '- If the amount or what was bought cannot be determined confidently, set',
    '  needs_clarification to true and put ONE short question in clarification_question.',
    '- Never invent an amount or a description. Guessing is worse than asking.',
    '- When needs_clarification is true, still fill the other fields with your best effort.',
    '',
    'Item list: ' + ITEMS.join(' | '),
    'Type list: ' + TYPES.join(' | '),
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

/** Calls generateContent and returns a normalized extraction object. */
function callGemini_(parts, messageDate) {
  const apiKey = requireProp_('GEMINI_API_KEY');
  const model = getProp_('GEMINI_MODEL') || CONFIG.GEMINI_MODEL;

  const generationConfig = {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: buildExtractionSchema_()
  };

  // Gemini 2.5 supports disabling thinking outright, which keeps the webhook
  // fast. Newer families use a different knob, so only send it for 2.5.
  if (model.indexOf('gemini-2.5') === 0) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const payload = {
    systemInstruction: { parts: [{ text: buildSystemInstruction_(messageDate) }] },
    contents: [{ role: 'user', parts: parts }],
    generationConfig: generationConfig
  };

  // The key goes in a header, not the URL, so it can never leak into a logged
  // error string.
  const response = UrlFetchApp.fetch(CONFIG.GEMINI_BASE_URL + model + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Gemini API returned ' + status + ': ' + response.getContentText().slice(0, 400));
  }

  const body = JSON.parse(response.getContentText());
  const candidate = body.candidates && body.candidates[0];
  const responseParts = candidate && candidate.content && candidate.content.parts;

  if (!responseParts || !responseParts.length) {
    throw new Error('Gemini returned no content (finishReason: ' +
      (candidate ? candidate.finishReason : 'none') + ')');
  }

  const raw = responseParts.map(function (p) { return p.text || ''; }).join('');
  return normalizeExtraction_(parseJsonLoose_(raw), messageDate);
}

/** Parses JSON, tolerating a stray markdown code fence. */
function parseJsonLoose_(text) {
  const cleaned = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Gemini response was not valid JSON: ' + cleaned.slice(0, 200));
  }
}

/** Clamps every field to the fixed lists and applies the documented defaults. */
function normalizeExtraction_(raw, messageDate) {
  const data = raw || {};
  const amount = Number(data.amount);
  const description = typeof data.description === 'string' ? data.description.trim() : '';

  const needsClarification = data.needs_clarification === true ||
    !isValidAmount_(amount) ||
    !description;

  return {
    date: parseDdMmYyyy_(data.date) ? data.date.trim() : messageDate,
    amount: isValidAmount_(amount) ? amount : null,
    description: description,
    item: matchFromList_(data.item, ITEMS, DEFAULTS.ITEM),
    type: matchFromList_(data.type, TYPES, DEFAULTS.TYPE),
    payment_method: matchFromList_(data.payment_method, PAYMENT_METHODS, DEFAULTS.PAYMENT_METHOD),
    beneficiary: matchFromList_(data.beneficiary, BENEFICIARIES, DEFAULTS.BENEFICIARY),
    needs_clarification: needsClarification,
    clarification_question: typeof data.clarification_question === 'string' && data.clarification_question.trim()
      ? data.clarification_question.trim()
      : null
  };
}
