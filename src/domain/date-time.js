// UI timestamps use local wall time, independent of the OS language settings.
// Wire/storage timestamps keep their original numeric or ISO representation.
export function formatDateTime(value, fallback = "--") {
  let timestamp = value;
  if (typeof value === 'string') {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return fallback;
    // Date.parse normalizes impossible dates (e.g. February 30). Reject them.
    const day = value.slice(0, 10);
    if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return fallback;
    timestamp = Date.parse(value);
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return fallback;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return fallback;
  const pad = (number, width = 2) => String(number).padStart(width, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${pad(date.getMilliseconds(), 3)}`;
}

export function formatClockTime(value) {
  return formatDateTime(value).split(' ').at(-1);
}

// Node TLS stores certificate validity as an English GMT string. Adapt only
// that explicit native representation at the display boundary; keep raw data.
export function formatCertificateTime(value) {
  const formatted = formatDateTime(value);
  if (formatted !== '--' || typeof value !== 'string') return formatted;
  const match = value.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +([1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) (\d{4}) GMT$/);
  if (!match) return '--';
  const timestamp = Date.parse(value);
  const date = new Date(timestamp);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[1]);
  if (!Number.isFinite(timestamp) || date.getUTCFullYear() !== Number(match[6])
    || date.getUTCMonth() !== month || date.getUTCDate() !== Number(match[2])) return '--';
  return formatDateTime(timestamp);
}
