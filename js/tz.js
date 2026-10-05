// Time-zone helpers built only on Intl (no libraries).

const partsCache = new Map();

function formatter(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      }),
    );
  }
  return partsCache.get(tz);
}

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant as seen in `tz`. */
export function zonedParts(date, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: +out.year,
    month: +out.month,
    day: +out.day,
    hour: +out.hour,
    minute: +out.minute,
    second: +out.second,
    weekday: weekdays[out.weekday],
  };
}

/** Offset of `tz` from UTC in minutes at a given instant (e.g. +60 for CET in winter). */
export function tzOffsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock time in `tz` to an absolute Date. */
export function zonedTimeToDate({ year, month, day, hour = 0, minute = 0 }, tz) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive - tzOffsetMinutes(new Date(naive), tz) * 60000;
  // second pass fixes DST transitions
  guess = naive - tzOffsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess);
}

/** Calendar date {year, month, day} for `date` in `tz`. */
export function civilDate(date, tz) {
  const { year, month, day, weekday } = zonedParts(date, tz);
  return { year, month, day, weekday };
}

/** Add whole days to a civil date. */
export function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

export function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO-8601 week key, e.g. 2026-W41. */
export function weekKey({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function monthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function formatTime(date, tz, opts = {}) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: opts.hour12,
  }).format(date);
}

export function formatDuration(ms) {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${h > 0 ? `${h}:${pad(m)}` : m}:${pad(s)}`;
}
