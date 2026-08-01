/**
 * Masrofna Bot - monthly report aggregation.
 *
 * Reads the sheet directly. No Gemini call: this is pure arithmetic.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** Builds the /report reply for a month (0-indexed) and year. */
function buildMonthlyReport_(month, year) {
  const sheet = getExpenseSheet_();
  const lastRow = sheet.getLastRow();
  const label = MONTH_NAMES[month] + ' ' + year;

  if (lastRow < 2) {
    return '📊 ' + label + '\nNo expenses logged yet.';
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, COLUMNS.BENEFICIARY).getValues();

  let total = 0;
  let count = 0;
  const byItem = {};
  const byType = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const date = cellToDate_(row[COLUMNS.DATE - 1]);
    if (!date || date.getMonth() !== month || date.getFullYear() !== year) continue;

    const amount = Number(row[COLUMNS.AMOUNT - 1]);
    if (!isFinite(amount)) continue;

    const item = String(row[COLUMNS.ITEM - 1] || DEFAULTS.ITEM).trim();
    const type = String(row[COLUMNS.TYPE - 1] || DEFAULTS.TYPE).trim();

    total += amount;
    count++;
    byItem[item] = (byItem[item] || 0) + amount;
    byType[type] = (byType[type] || 0) + amount;
  }

  if (count === 0) {
    return '📊 ' + label + '\nNo expenses logged for this month.';
  }

  const lines = [
    '📊 ' + label,
    'Total: ' + formatMoney_(total) + ' ' + CONFIG.CURRENCY + ' · ' + count + ' entries',
    '',
    'By Item'
  ];

  sortedEntries_(byItem).forEach(function (entry) {
    lines.push('• ' + entry.key + ' — ' + formatMoney_(entry.value) +
      ' (' + percent_(entry.value, total) + ')');
  });

  lines.push('', 'By Type');

  // Fixed order first so the four types always read the same way, then any
  // stray values that predate the fixed list.
  const typeKeys = TYPES.slice();
  Object.keys(byType).forEach(function (key) {
    if (typeKeys.indexOf(key) === -1) typeKeys.push(key);
  });

  typeKeys.forEach(function (key) {
    const value = byType[key] || 0;
    if (value === 0) return;
    lines.push('• ' + key + ' — ' + formatMoney_(value) + ' (' + percent_(value, total) + ')');
  });

  return lines.join('\n');
}

/** Sorts a {key: amount} map into descending [{key, value}]. */
function sortedEntries_(map) {
  return Object.keys(map)
    .map(function (key) { return { key: key, value: map[key] }; })
    .sort(function (a, b) { return b.value - a.value; });
}

function percent_(value, total) {
  if (!total) return '0%';
  return (value / total * 100).toFixed(1) + '%';
}

/**
 * Parses the argument of /report into {month, year}, defaulting to the current
 * Cairo month. Accepts "July", "July 2026", "jul 2026", "7 2026", "2026-07".
 * Returns null when the text cannot be understood.
 */
function parseReportPeriod_(argument) {
  const now = new Date();
  const currentMonth = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'MM')) - 1;
  const currentYear = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy'));

  const text = (argument || '').trim();
  if (!text) {
    return { month: currentMonth, year: currentYear };
  }

  const isoMatch = text.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (isoMatch) {
    const month = Number(isoMatch[2]) - 1;
    return month >= 0 && month <= 11 ? { month: month, year: Number(isoMatch[1]) } : null;
  }

  const tokens = text.split(/[\s,\/-]+/).filter(String);
  let month = null;
  let year = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (/^\d{4}$/.test(token)) {
      year = Number(token);
      continue;
    }

    if (/^\d{1,2}$/.test(token)) {
      const number = Number(token);
      if (number >= 1 && number <= 12 && month === null) month = number - 1;
      continue;
    }

    const name = token.toLowerCase();
    for (let m = 0; m < MONTH_NAMES.length; m++) {
      const full = MONTH_NAMES[m].toLowerCase();
      if (full === name || (name.length >= 3 && full.slice(0, 3) === name.slice(0, 3))) {
        month = m;
        break;
      }
    }
  }

  if (month === null && year === null) return null;

  return {
    month: month === null ? currentMonth : month,
    year: year === null ? currentYear : year
  };
}
