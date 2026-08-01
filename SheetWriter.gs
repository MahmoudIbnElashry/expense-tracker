/**
 * Masrofna Bot - writes extracted expenses to the Google Sheet.
 *
 * Column order: ID | Date | Description | Amount | Item | Type |
 *               Payment Method | Beneficiary | Raw Input
 */

/** Opens the Expenses sheet, falling back to the first sheet. */
function getExpenseSheet_() {
  const spreadsheet = SpreadsheetApp.openById(requireProp_('SHEET_ID'));
  const named = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  const sheet = named || spreadsheet.getSheets()[0];
  if (!sheet) {
    throw new Error('No sheet found in spreadsheet');
  }
  if (!named) {
    trace_('sheet.fallback', 'no tab named "' + CONFIG.SHEET_NAME +
      '", using first tab "' + sheet.getName() + '"');
  }
  return sheet;
}

/**
 * Appends every expense from one message and returns the generated IDs.
 *
 * The whole batch runs under a single script lock and a single setValues, so
 * concurrent messages cannot interleave IDs and a multi-expense message is
 * written as one unit rather than row by row.
 */
function appendExpenses_(expenses, rawInput) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);

  try {
    const sheet = getExpenseSheet_();
    const startNumber = nextExpenseNumber_(sheet);
    const ids = [];

    const rows = expenses.map(function (expense, index) {
      const id = CONFIG.ID_PREFIX + (startNumber + index);
      ids.push(id);
      return [
        id,
        parseDdMmYyyy_(expense.date) || new Date(),
        expense.description,
        expense.amount,
        expense.item,
        expense.type,
        expense.payment_method,
        expense.beneficiary,
        rawInput
      ];
    });

    const firstRow = sheet.getLastRow() + 1;
    trace_('sheet.append', 'tab="' + sheet.getName() + '" rows=' + rows.length +
      ' startRow=' + firstRow + ' ids=' + ids.join(','));

    sheet.getRange(firstRow, 1, rows.length, rows[0].length).setValues(rows);

    // Keep the date column reading as DD-MM-YYYY regardless of sheet locale.
    sheet.getRange(firstRow, COLUMNS.DATE, rows.length, 1).setNumberFormat('dd-mm-yyyy');

    return ids;
  } finally {
    lock.releaseLock();
  }
}

/**
 * The next ID number, from the highest existing EXP-nnnn in column A.
 * Scanning for the max (rather than reading the last row) survives rows that
 * were deleted, reordered, or sorted.
 */
function nextExpenseNumber_(sheet) {
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

  return highest + 1;
}
