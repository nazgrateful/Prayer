// Solar position math used to derive every prayer time in the app.
// Based on the well-known PrayTimes.org / NOAA approximations (accurate to ~1 minute).
// All public functions return JavaScript Date objects (absolute instants) or null
// when the event does not happen on that day (e.g. polar day / polar night).

const DEG = Math.PI / 180;
const sin = (d) => Math.sin(d * DEG);
const cos = (d) => Math.cos(d * DEG);
const tan = (d) => Math.tan(d * DEG);
const arcsin = (x) => Math.asin(x) / DEG;
const arccos = (x) => Math.acos(x) / DEG;
const arctan2 = (y, x) => Math.atan2(y, x) / DEG;
const arccot = (x) => Math.atan(1 / x) / DEG;
const fix = (a, b) => a - b * Math.floor(a / b);
const fixAngle = (a) => fix(a, 360);
const fixHour = (h) => fix(h, 24);

export function julian(year, month, day) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
}

export function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * sin(g) + 0.02 * sin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = arctan2(cos(e) * sin(L), cos(L)) / 15;
  return {
    declination: arcsin(sin(e) * sin(L)),
    equation: q / 15 - fixHour(RA),
  };
}

/**
 * Solar calculator for one calendar day at one place.
 * `year/month/day` is the civil date at the location.
 */
export class SolarDay {
  constructor({ year, month, day, lat, lng, elevation = 0 }) {
    Object.assign(this, { year, month, day, lat, lng, elevation });
    this.jDate = julian(year, month, day) - lng / (15 * 24);
    this.riseSetAngle = 0.833 + 0.0347 * Math.sqrt(Math.max(0, elevation));
  }

  // --- internal: times are "local mean solar hours"; UTC hours = t - lng/15
  _midDay(t) {
    return fixHour(12 - sunPosition(this.jDate + t).equation);
  }

  _angleTime(angle, t, ccw) {
    const decl = sunPosition(this.jDate + t).declination;
    const noon = this._midDay(t);
    const x = (-sin(angle) - sin(decl) * sin(this.lat)) / (cos(decl) * cos(this.lat));
    if (x > 1 || x < -1 || Number.isNaN(x)) return NaN;
    const T = arccos(x) / 15;
    return noon + (ccw ? -T : T);
  }

  _iterate(fn, guess) {
    let h = guess;
    for (let i = 0; i < 3; i++) {
      const next = fn(h / 24);
      if (Number.isNaN(next)) return NaN;
      h = next;
    }
    return h;
  }

  _toDate(hours) {
    if (hours == null || Number.isNaN(hours)) return null;
    const utcHours = hours - this.lng / 15;
    return new Date(Date.UTC(this.year, this.month - 1, this.day) + utcHours * 3600000);
  }

  // --- public events
  noon() {
    return this._toDate(this._iterate((t) => this._midDay(t), 12));
  }

  sunrise() {
    return this.beforeNoon(this.riseSetAngle, 6);
  }

  sunset() {
    return this.afterNoon(this.riseSetAngle, 18);
  }

  /** Moment the sun is `angle` degrees below the horizon in the morning. */
  beforeNoon(angle, guess = 5) {
    return this._toDate(this._iterate((t) => this._angleTime(angle, t, true), guess));
  }

  /** Moment the sun is `angle` degrees below the horizon in the evening. */
  afterNoon(angle, guess = 19) {
    return this._toDate(this._iterate((t) => this._angleTime(angle, t, false), guess));
  }

  /** Islamic Asr: shadow length = factor * object length (+ noon shadow). */
  asr(factor = 1) {
    const fn = (t) => {
      const decl = sunPosition(this.jDate + t).declination;
      const angle = -arccot(factor + tan(Math.abs(this.lat - decl)));
      return this._angleTime(angle, t, false);
    };
    return this._toDate(this._iterate(fn, 15));
  }
}

const MS_PER_DAY = 86400000;

/** Approximate moon age in days (0 = new moon, ~14.77 = full moon). */
export function moonAge(date) {
  const synodic = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / MS_PER_DAY;
  return fix(days, synodic);
}

export function moonPhaseName(age) {
  if (age < 1.0 || age > 28.53) return 'New moon';
  if (age < 6.38) return 'Waxing crescent';
  if (age < 8.38) return 'First quarter';
  if (age < 13.77) return 'Waxing gibbous';
  if (age < 15.77) return 'Full moon';
  if (age < 21.15) return 'Waning gibbous';
  if (age < 23.15) return 'Last quarter';
  return 'Waning crescent';
}
