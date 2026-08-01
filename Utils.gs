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
 * Flattens a message for intent matching: lowercases, strips Arabic
 * diacritics and tatweel, folds alef/yaa/taa-marbuta spelling variants, and
 * replaces anything that is not an ASCII or Arabic letter or digit (including
 * punctuation and emoji) with a space.
 *
 * Deliberately avoids \p{...} escapes so it does not depend on Unicode
 * property support in the runtime.
 */
function normalizeForIntent_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')  // tashkeel and tatweel
    .replace(/[أإآٱ]/g, 'ا')  // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي')                  // ى -> ي
    .replace(/ة/g, 'ه')                  // ة -> ه
    .replace(/[^a-z0-9؀-ۿ\s]/g, ' ')     // punctuation, emoji, etc.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the whole message means "drop it".
 *
 * Whole-message only: a substring test would swallow real expenses like
 * "cancelled gym membership 300".
 */
function isCancelIntent_(text) {
  const normalized = normalizeForIntent_(text);
  if (!normalized) return false;
  return CANCEL_PHRASES.indexOf(normalized) !== -1;
}

/**
 * Identifies a file from its leading bytes.
 *
 * Preferred over any declared type, because Telegram's file download serves
 * application/octet-stream and its document.mime_type is whatever the sending
 * client claimed. The bytes are the only source that cannot be wrong.
 *
 * Apps Script's getBytes() returns signed Java bytes, hence the & 0xFF.
 */
function sniffMimeType_(bytes) {
  if (!bytes || bytes.length < 12) return null;

  const b = [];
  for (let i = 0; i < 12; i++) b.push(bytes[i] & 0xFF);

  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';

  // RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'image/webp';
  }

  // ISO-BMFF container: bytes 4-7 are "ftyp", 8-11 are the brand.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx'].indexOf(brand) !== -1) return 'image/heic';
    if (['mif1', 'msf1', 'heim', 'heis'].indexOf(brand) !== -1) return 'image/heif';
  }

  return null;
}

/** Maps a file path or name to a MIME type by extension. */
function mimeFromPath_(path) {
  const match = String(path || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;

  switch (match[1]) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    case 'pdf': return 'application/pdf';
    default: return null;
  }
}

function isSupportedMimeType_(mimeType) {
  return SUPPORTED_MIME_TYPES.indexOf(String(mimeType || '').toLowerCase()) !== -1;
}

/**
 * Settles on a MIME type Gemini will accept, or null.
 *
 * Order matters: the magic bytes win, then whatever Telegram declared, then
 * the file extension. `photoDefault` covers the last case - Telegram
 * re-encodes every compressed photo to JPEG, so a photo message with
 * unreadable bytes is still safely a JPEG.
 */
function resolveMimeType_(bytes, declaredMime, filePath, photoDefault) {
  const sniffed = sniffMimeType_(bytes);
  if (sniffed) return sniffed;

  if (isSupportedMimeType_(declaredMime)) return String(declaredMime).toLowerCase();

  const fromPath = mimeFromPath_(filePath);
  if (fromPath) return fromPath;

  return photoDefault || null;
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
