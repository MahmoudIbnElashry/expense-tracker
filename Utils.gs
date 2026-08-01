/**
 * Masrofna Bot - small shared helpers (dates, numbers, list matching).
 */

/** Formats a Date as DD-MM-YYYY in Cairo time. */
function formatDateCairo_(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'dd-MM-yyyy');
}

/** Current time as a DD-MM-YYYY string in Cairo time. */
function todayCairo_() {
  return formatDateCairo_(new Date());
}

/**
 * Parses DD-MM-YYYY into a Date at local noon.
 * Noon avoids the date shifting a day when the sheet renders it in another
 * timezone. Returns null if the string is not a valid date.
 */
function parseDdMmYyyy_(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0);

  // Reject overflow like 31-02-2026, which JS would roll into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * Coerces a sheet cell into a Date. Handles real Date values as well as
 * DD-MM-YYYY text, since the sheet may already contain rows added by hand.
 */
function cellToDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'string') return parseDdMmYyyy_(value);
  return null;
}

/** True when the value is a usable positive expense amount. */
function isValidAmount_(value) {
  const number = Number(value);
  return isFinite(number) && number > 0;
}

/** Formats a number with thousands separators, dropping a trailing ".00". */
function formatMoney_(value) {
  const number = Number(value) || 0;
  const fixed = number.toFixed(2);
  const parts = fixed.split('.');
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts[1] === '00' ? whole : whole + '.' + parts[1];
}

/**
 * Matches a model-supplied value against a fixed list, case- and
 * whitespace-insensitively. Falls back to the given default on no match.
 */
function matchFromList_(value, list, fallback) {
  if (typeof value !== 'string') return fallback;
  const needle = value.trim().toLowerCase();
  for (let i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === needle) return list[i];
  }
  return fallback;
}
