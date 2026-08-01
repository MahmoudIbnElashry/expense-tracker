/**
 * Masrofna Bot - writes extracted expenses to the Google Sheet.
 *
 * Column order: ID | Date | Description | Amount | Item | Type |
 *               Payment Method | Beneficiary | Raw Input
 */

/** Opens the Expenses sheet, falling back to the first sheet. */
function getExpenseSheet_() {
  const spreadsheet = SpreadsheetApp.openById(requireProp_('SHEET_ID'));
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME) || spreadsheet.getSheets()[0];
  if (!sheet) {
    throw new Error('No sheet found in spreadsheet');
  }
  return sheet;
}

/**
 * Appends one expense row and returns its generated ID.
 *
 * The read-max-ID and append pair runs under a script lock so two messages
 * arriving together cannot be assigned the same ID.
 */
function appendExpense_(extraction, rawInput) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);

  try {
    const sheet = getExpenseSheet_();
    const id = nextExpenseId_(sheet);
    const date = parseDdMmYyyy_(extraction.date) || new Date();

    sheet.appendRow([
      id,
      date,
      extraction.description,
      extraction.amount,
      extraction.item,
      extraction.type,
      extraction.payment_method,
      extraction.beneficiary,
      rawInput
    ]);

    // Keep the date column reading as DD-MM-YYYY regardless of sheet locale.
    sheet.getRange(sheet.getLastRow(), COLUMNS.DATE).setNumberFormat('dd-mm-yyyy');

    return id;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Builds the next ID from the highest existing EXP-nnnn in column A.
 * Scanning for the max (rather than reading the last row) survives rows that
 * were deleted, reordered, or sorted.
 */
function nextExpenseId_(sheet) {
  const lastRow = sheet.getLastRow();
  let highest = CONFIG.ID_START - 1;

  if (lastRow > 1) {
    const ids = sheet.getRange(2, COLUMNS.ID, lastRow - 1, 1).getValues();
    const pattern = new RegExp('^' + CONFIG.ID_PREFIX + '(\\d+)$', 'i');

    for (let i = 0; i < ids.length; i++) {
      const match = String(ids[i][0]).trim().match(pattern);
      if (match) {
        const number = Number(match[1]);
        if (number > highest) highest = number;
      }
    }
  }

  return CONFIG.ID_PREFIX + (highest + 1);
}
