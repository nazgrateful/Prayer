// Prayer schedules for each tradition. Every schedule is derived from the
// sun's position at the user's location, so times follow the seasons and
// the place automatically.

import { SolarDay, moonAge, moonPhaseName } from './astro.js';
import { zonedTimeToDate, addDays } from './tz.js';

const MIN = 60000;
const plus = (date, minutes) => (date ? new Date(date.getTime() + minutes * MIN) : null);
const between = (a, b, fraction) => (a && b ? new Date(a.getTime() + (b - a) * fraction) : null);

// ---------------------------------------------------------------------------
// Islamic calculation methods
// fajr/isha: sun angle below horizon, or `ishaMinutes` after maghrib.
export const ISLAMIC_METHODS = {
  MWL: { name: 'Muslim World League', fajr: 18, isha: 17 },
  ISNA: { name: 'Islamic Society of North America', fajr: 15, isha: 15 },
  Egypt: { name: 'Egyptian General Authority of Survey', fajr: 19.5, isha: 17.5 },
  Makkah: { name: 'Umm al-Qura, Makkah', fajr: 18.5, ishaMinutes: 90, ramadanIshaMinutes: 120 },
  Karachi: { name: 'University of Islamic Sciences, Karachi', fajr: 18, isha: 18 },
  Tehran: { name: 'Institute of Geophysics, Tehran', fajr: 17.7, isha: 14, maghrib: 4.5, midnight: 'jafari' },
  Jafari: { name: 'Shia Ithna-Ashari (Jafari)', fajr: 16, isha: 14, maghrib: 4, midnight: 'jafari' },
  Gulf: { name: 'Gulf Region', fajr: 19.5, ishaMinutes: 90 },
  Kuwait: { name: 'Kuwait', fajr: 18, isha: 17.5 },
  Qatar: { name: 'Qatar', fajr: 18, ishaMinutes: 90 },
  Singapore: { name: 'Singapore / Malaysia / Indonesia', fajr: 20, isha: 18 },
  France: { name: 'Union des Organisations Islamiques de France', fajr: 12, isha: 12 },
  Turkey: { name: 'Diyanet, Turkey', fajr: 18, isha: 17 },
  Russia: { name: 'Spiritual Administration of Muslims of Russia', fajr: 16, isha: 15 },
};

/** Hijri (Umm al-Qura) month number 1–12 for a civil date, or null if unsupported. */
export function hijriMonth({ year, month, day }) {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(year, month - 1, day, 12)));
    return +parts.find((p) => p.type === 'month').value || null;
  } catch {
    return null;
  }
}

// Region → sensible defaults, chosen from the IANA time zone of the location.
const REGION_RULES = [
  [/^America\//, { method: 'ISNA' }],
  [/^Canada\//, { method: 'ISNA' }],
  [/^Asia\/Riyadh/, { method: 'Makkah' }],
  [/^Asia\/(Aden)/, { method: 'Makkah' }],
  [/^Africa\/(Cairo|Khartoum|Tripoli)|^Asia\/(Beirut|Damascus|Amman|Baghdad|Gaza|Hebron)/, { method: 'Egypt' }],
  [/^Asia\/(Karachi|Kolkata|Calcutta|Dhaka|Kabul|Colombo|Kathmandu)/, { method: 'Karachi', asr: 'hanafi' }],
  [/^Asia\/Tehran/, { method: 'Tehran' }],
  [/^Asia\/(Dubai|Muscat|Bahrain)/, { method: 'Gulf' }],
  [/^Asia\/Kuwait/, { method: 'Kuwait' }],
  [/^Asia\/Qatar/, { method: 'Qatar' }],
  [/^Asia\/(Singapore|Kuala_Lumpur|Kuching|Jakarta|Makassar|Jayapura|Pontianak|Brunei)/, { method: 'Singapore' }],
  [/^Europe\/Paris/, { method: 'France' }],
  [/^Europe\/Istanbul|^Asia\/(Istanbul|Baku)/, { method: 'Turkey', asr: 'standard' }],
  [/^Europe\/(Moscow|Kazan|Samara|Volgograd)|^Asia\/(Yekaterinburg|Omsk|Novosibirsk|Tashkent|Almaty|Bishkek|Dushanbe)/, { method: 'Russia', asr: 'hanafi' }],
];

/** Suggested settings for each tradition based on where the user is. */
export function regionalDefaults(timeZone = '', lat = 0) {
  const islam = { method: 'MWL', asr: 'standard', highLatitude: 'angle' };
  for (const [re, val] of REGION_RULES) {
    if (re.test(timeZone)) {
      Object.assign(islam, val);
      break;
    }
  }
  return {
    islam,
    judaism: {
      // Jerusalem custom is 40 minutes; most other communities use 18.
      candleMinutes: /^Asia\/(Jerusalem|Tel_Aviv)/.test(timeZone) ? 40 : 18,
    },
    christianity: { style: 'hours' },
    _highLatitude: Math.abs(lat) > 48,
  };
}

// ---------------------------------------------------------------------------
// Day context shared by every tradition.

export function buildDay({ date, location, settings = {} }) {
  const { lat, lng, elevation = 0, timeZone } = location;
  const solar = new SolarDay({ ...date, lat, lng, elevation });
  const next = addDays(date, 1);
  const prev = addDays(date, -1);
  const solarNext = new SolarDay({ ...next, lat, lng, elevation });
  const solarPrev = new SolarDay({ ...prev, lat, lng, elevation });

  const memo = new Map();
  const m = (k, fn) => {
    if (!memo.has(k)) memo.set(k, fn());
    return memo.get(k);
  };

  const sun = {
    noon: () => m('noon', () => solar.noon()),
    sunrise: () => m('sunrise', () => solar.sunrise()),
    sunset: () => m('sunset', () => solar.sunset()),
    nextSunrise: () => m('nextSunrise', () => solarNext.sunrise()),
    prevSunset: () => m('prevSunset', () => solarPrev.sunset()),
    dawn: (angle) => m(`dawn${angle}`, () => solar.beforeNoon(angle, 5)),
    nextDawn: (angle) => m(`ndawn${angle}`, () => solarNext.beforeNoon(angle, 5)),
    dusk: (angle) => m(`dusk${angle}`, () => solar.afterNoon(angle, 19)),
    asr: (factor) => m(`asr${factor}`, () => solar.asr(factor)),
  };

  // Polar day/night: fall back to a 12-hour day centered on solar noon.
  const polar = !sun.sunrise() || !sun.sunset();
  if (polar) {
    const noon = sun.noon();
    memo.set('sunrise', sun.sunrise() || plus(noon, -360));
    memo.set('sunset', sun.sunset() || plus(noon, 360));
    memo.set('nextSunrise', sun.nextSunrise() || plus(noon, 1080));
    memo.set('prevSunset', sun.prevSunset() || plus(noon, -1080));
  }

  const night = () => sun.nextSunrise() - sun.sunset();
  // Length of a halachic / seasonal hour (1/12 of daylight).
  const dayHour = () => (sun.sunset() - sun.sunrise()) / 12;

  return {
    date,
    location,
    settings,
    sun,
    polar,
    night,
    dayHour,
    weekday: date.weekday,
    wall: (h, min = 0) => zonedTimeToDate({ ...date, hour: h, minute: min }, timeZone),
    moonAge: () => moonAge(sun.noon()),
  };
}

// ---------------------------------------------------------------------------
// Traditions

function islamSchedule(ctx) {
  const s = { ...regionalDefaults(ctx.location.timeZone).islam, ...(ctx.settings.islam || {}) };
  const method = ISLAMIC_METHODS[s.method] || ISLAMIC_METHODS.MWL;
  const { sun } = ctx;
  const sunrise = sun.sunrise();
  const sunset = sun.sunset();
  const nightMs = ctx.night();

  // High-latitude safeguard: never let Fajr/Isha drift further than a
  // portion of the night from sunrise/sunset (angle-based rule).
  const clampMorning = (time, angle, rise = sunrise) => {
    const limit = s.highLatitude === 'seventh' ? nightMs / 7 : s.highLatitude === 'middle' ? nightMs / 2 : (angle / 60) * nightMs;
    const earliest = new Date(rise.getTime() - limit);
    return !time || ctx.polar || time < earliest || time >= rise ? earliest : time;
  };
  const clampEvening = (time, angle) => {
    const limit = s.highLatitude === 'seventh' ? nightMs / 7 : s.highLatitude === 'middle' ? nightMs / 2 : (angle / 60) * nightMs;
    const latest = new Date(sunset.getTime() + limit);
    return !time || ctx.polar || time > latest || time <= sunset ? latest : time;
  };

  const fajr = clampMorning(sun.dawn(method.fajr), method.fajr);
  const dhuhr = sun.noon();
  let asr = sun.asr(s.asr === 'hanafi' ? 2 : 1);
  if (!asr || asr <= dhuhr || asr >= sunset) asr = between(dhuhr, sunset, 0.5);
  const maghrib = method.maghrib ? clampEvening(sun.dusk(method.maghrib), method.maghrib) : sunset;
  const ishaMinutes = method.ramadanIshaMinutes && hijriMonth(ctx.date) === 9 ? method.ramadanIshaMinutes : method.ishaMinutes;
  const isha = ishaMinutes ? plus(maghrib, ishaMinutes) : clampEvening(sun.dusk(method.isha), method.isha);
  const nightEnd = clampMorning(sun.nextDawn(method.fajr), method.fajr, sun.nextSunrise());
  const lastThird = between(sunset, nightEnd, 2 / 3);
  const friday = ctx.weekday === 5;

  return [
    { id: 'fajr', name: 'Fajr', time: fajr, end: sunrise, duration: 10, desc: 'Dawn prayer — 2 rakʿah' },
    { id: 'sunrise', name: 'Sunrise', time: sunrise, marker: true, desc: 'End of Fajr time' },
    friday
      ? { id: 'dhuhr', name: 'Jumuʿah', time: dhuhr, end: asr, duration: 45, desc: 'Friday congregational prayer' }
      : { id: 'dhuhr', name: 'Dhuhr', time: dhuhr, end: asr, duration: 10, desc: 'Midday prayer — 4 rakʿah' },
    { id: 'asr', name: 'ʿAsr', time: asr, end: sunset, duration: 10, desc: `Afternoon prayer — ${s.asr === 'hanafi' ? 'Hanafi' : 'standard'} shadow rule` },
    { id: 'maghrib', name: 'Maghrib', time: maghrib, end: isha, duration: 10, desc: 'Sunset prayer — 3 rakʿah' },
    { id: 'isha', name: 'ʿIshaʾ', time: isha, duration: 15, desc: 'Night prayer — 4 rakʿah' },
    { id: 'tahajjud', name: 'Tahajjud', time: lastThird, optional: true, duration: 20, desc: 'Night vigil — last third of the night' },
  ];
}

function christianSchedule(ctx) {
  const { sun, wall } = ctx;
  const sunday = ctx.weekday === 0;
  const list = [
    { id: 'lauds', name: 'Lauds (Morning Prayer)', time: sun.sunrise(), duration: 15, desc: 'Liturgy of the Hours at sunrise' },
    { id: 'angelus-am', name: 'Angelus', time: wall(6, 0), duration: 5, optional: true, desc: 'Traditional 6 am Angelus' },
    { id: 'terce', name: 'Terce (Mid-morning)', time: wall(9, 0), duration: 5, optional: true, desc: 'Third hour' },
    { id: 'sext', name: 'Sext · Angelus (Midday)', time: wall(12, 0), duration: 5, desc: 'Sixth hour and noon Angelus' },
    { id: 'none', name: 'None · Hour of Mercy', time: wall(15, 0), duration: 10, optional: true, desc: 'Ninth hour — Divine Mercy Chaplet' },
    { id: 'vespers', name: 'Vespers (Evening Prayer)', time: sun.sunset(), duration: 15, desc: 'Liturgy of the Hours at sunset' },
    { id: 'compline', name: 'Compline (Night Prayer)', time: wall(21, 0), duration: 10, desc: 'Before sleep' },
  ];
  if (sunday) list.splice(1, 0, { id: 'mass', name: 'Lord’s Day worship', time: wall(10, 0), duration: 60, desc: 'Sunday service / Mass (adjust to your parish)' });
  return list;
}

function judaismSchedule(ctx) {
  const s = { ...regionalDefaults(ctx.location.timeZone).judaism, ...(ctx.settings.judaism || {}) };
  const { sun } = ctx;
  const sunrise = sun.sunrise();
  const sunset = sun.sunset();
  const hour = ctx.dayHour();
  const tzeit = sun.dusk(8.5) || plus(sunset, 42);
  const list = [
    { id: 'shacharit', name: 'Shacharit', time: sunrise, end: new Date(sunrise.getTime() + 4 * hour), duration: 30, desc: 'Morning service · ends at Sof Zman Tefillah (4 seasonal hours)' },
    { id: 'shema', name: 'Sof Zman Kriat Shema', time: new Date(sunrise.getTime() + 3 * hour), marker: true, desc: 'Latest time for the morning Shema (GRA)' },
    { id: 'mincha', name: 'Mincha', time: new Date(sun.noon().getTime() + hour / 2), end: sunset, duration: 15, desc: 'Afternoon service from Mincha Gedolah' },
    { id: 'maariv', name: 'Maariv', time: tzeit, duration: 15, desc: 'Evening service after nightfall (Tzeit haKochavim)' },
  ];
  if (ctx.weekday === 5) {
    list.push({ id: 'candles', name: 'Shabbat candle lighting', time: plus(sunset, -s.candleMinutes), duration: 5, desc: `${s.candleMinutes} min before sunset` });
  }
  if (ctx.weekday === 6) {
    list.push({ id: 'havdalah', name: 'Havdalah', time: tzeit, duration: 10, desc: 'Shabbat ends at nightfall' });
  }
  return list;
}

function hinduSchedule(ctx) {
  const { sun } = ctx;
  const sunrise = sun.sunrise();
  return [
    { id: 'brahma', name: 'Brahma Muhurta', time: plus(sunrise, -96), end: plus(sunrise, -48), duration: 30, desc: 'Auspicious time for meditation & japa' },
    { id: 'pratah', name: 'Prātaḥ Sandhyā', time: plus(sunrise, -24), end: plus(sunrise, 24), duration: 20, desc: 'Morning sandhyā vandana — Gayatri at sunrise' },
    { id: 'madhyahna', name: 'Mādhyāhnika Sandhyā', time: sun.noon(), duration: 15, desc: 'Midday sandhyā' },
    { id: 'sayam', name: 'Sāyaṁ Sandhyā', time: plus(sun.sunset(), -24), end: plus(sun.sunset(), 24), duration: 20, desc: 'Evening sandhyā & aarti (lamp lighting)' },
  ];
}

function sikhSchedule(ctx) {
  const { sun, wall } = ctx;
  // Amrit vela: last quarter (pahar) of the night.
  const amrit = between(sun.prevSunset(), sun.sunrise(), 0.75);
  return [
    { id: 'amritvela', name: 'Amrit Vela · Nitnem', time: amrit, end: sun.sunrise(), duration: 45, desc: 'Japji Sahib, Jaap Sahib, Tav-Prasad Savaiye, Chaupai Sahib, Anand Sahib' },
    { id: 'ardas-am', name: 'Ardas', time: sun.sunrise(), duration: 10, optional: true, desc: 'Morning supplication' },
    { id: 'rehras', name: 'Rehras Sahib', time: sun.sunset(), duration: 20, desc: 'Evening prayer at sunset' },
    { id: 'sohila', name: 'Kirtan Sohila', time: wall(21, 30), duration: 10, desc: 'Before sleep' },
  ];
}

function buddhistSchedule(ctx) {
  const { sun, wall } = ctx;
  const age = ctx.moonAge();
  const list = [
    { id: 'morning', name: 'Morning chanting & meditation', time: sun.sunrise(), duration: 30, desc: 'Refuges, precepts, metta' },
    { id: 'midday', name: 'Midday mindfulness', time: sun.noon(), duration: 10, optional: true, desc: 'Pause and recollect — traditional end of the meal period' },
    { id: 'evening', name: 'Evening chanting', time: sun.sunset(), duration: 30, desc: 'Puja, reflection and meditation' },
    { id: 'night', name: 'Dedication of merit', time: wall(21, 0), duration: 5, optional: true, desc: 'Share the merit of the day' },
  ];
  const phase = moonPhaseName(age);
  if (['New moon', 'Full moon', 'First quarter', 'Last quarter'].includes(phase)) {
    list.push({ id: 'uposatha', name: `Uposatha (${phase.toLowerCase()})`, time: wall(7, 0), duration: 60, desc: 'Observance day — approximate; check your local calendar' });
  }
  return list;
}

function bahaiSchedule(ctx) {
  const { sun } = ctx;
  const sunrise = sun.sunrise();
  const noon = sun.noon();
  const sunset = sun.sunset();
  return [
    { id: 'medium-am', name: 'Medium Obligatory Prayer (morning)', time: sunrise, end: noon, duration: 10, desc: 'Between sunrise and noon' },
    { id: 'short', name: 'Short / Medium Obligatory Prayer (noon)', time: noon, end: sunset, duration: 5, desc: 'Short prayer: between noon and sunset' },
    { id: 'medium-pm', name: 'Medium Obligatory Prayer (evening)', time: sunset, end: plus(sunset, 120), duration: 10, desc: 'From sunset until two hours after' },
  ];
}

function zoroastrianSchedule(ctx) {
  const { sun, wall } = ctx;
  const sunset = sun.sunset();
  const midnight = between(sunset, sun.nextSunrise(), 0.5);
  const midnightPrev = between(sun.prevSunset(), sun.sunrise(), 0.5);
  return [
    { id: 'ushahin', name: 'Ushahin Gāh', time: midnightPrev, end: sun.sunrise(), optional: true, duration: 10, desc: 'Midnight until dawn' },
    { id: 'havan', name: 'Hāvan Gāh', time: sun.sunrise(), end: sun.noon(), duration: 10, desc: 'Sunrise to noon' },
    { id: 'rapithwin', name: 'Rapithwin Gāh', time: sun.noon(), end: wall(15, 0), duration: 10, desc: 'Noon to mid-afternoon' },
    { id: 'uzerin', name: 'Uzerin Gāh', time: wall(15, 0), end: sunset, duration: 10, desc: 'Afternoon until sunset' },
    { id: 'aiwisruthrem', name: 'Aiwisruthrem Gāh', time: sunset, end: midnight, duration: 10, desc: 'Sunset to midnight' },
  ];
}

function spiritualSchedule(ctx) {
  const { sun, wall } = ctx;
  return [
    { id: 'morning', name: 'Morning intention', time: sun.sunrise(), duration: 10, desc: 'Set an intention for the day' },
    { id: 'midday', name: 'Midday pause', time: sun.noon(), duration: 5, desc: 'Breathe, check in with yourself' },
    { id: 'evening', name: 'Evening gratitude', time: sun.sunset(), duration: 10, desc: 'Three things you are thankful for' },
    { id: 'night', name: 'Night reflection', time: wall(21, 30), duration: 10, desc: 'Review the day with kindness' },
  ];
}

export const TRADITIONS = {
  islam: { id: 'islam', name: 'Islam', symbol: '☪', color: '#2f9e6e', book: 'Qurʾān', schedule: islamSchedule },
  christianity: { id: 'christianity', name: 'Christianity', symbol: '✝', color: '#4c6ef5', book: 'Bible', schedule: christianSchedule },
  judaism: { id: 'judaism', name: 'Judaism', symbol: '✡', color: '#1c7ed6', book: 'Tanakh & Talmud', schedule: judaismSchedule },
  hinduism: { id: 'hinduism', name: 'Hinduism', symbol: 'ॐ', color: '#f08c00', book: 'Gita & Upanishads', schedule: hinduSchedule },
  sikhism: { id: 'sikhism', name: 'Sikhism', symbol: '☬', color: '#e8590c', book: 'Guru Granth Sahib', schedule: sikhSchedule },
  buddhism: { id: 'buddhism', name: 'Buddhism', symbol: '☸', color: '#c2255c', book: 'Dhammapada & Suttas', schedule: buddhistSchedule },
  bahai: { id: 'bahai', name: 'Baháʼí Faith', symbol: '✶', color: '#7048e8', book: 'Baháʼí Writings', schedule: bahaiSchedule },
  zoroastrianism: { id: 'zoroastrianism', name: 'Zoroastrianism', symbol: '🔥', color: '#d6336c', book: 'Avesta', schedule: zoroastrianSchedule },
  spiritual: { id: 'spiritual', name: 'Spiritual / Interfaith', symbol: '❋', color: '#0c8599', book: 'Wisdom traditions', schedule: spiritualSchedule },
};

export const CUSTOM_ANCHORS = {
  fixed: 'Fixed clock time',
  sunrise: 'Sunrise',
  noon: 'Solar noon',
  sunset: 'Sunset',
};

/**
 * Full schedule for a day: every selected tradition plus the user's custom
 * prayers, with per-prayer preferences (enabled, offset) applied, sorted by time.
 */
export function daySchedule({ date, location, traditions, settings = {}, prefs = {}, custom = [] }) {
  const ctx = buildDay({ date, location, settings });
  const out = [];
  for (const tid of traditions) {
    const t = TRADITIONS[tid];
    if (!t) continue;
    for (const p of t.schedule(ctx)) {
      const key = `${tid}.${p.id}`;
      const pref = prefs[key] || {};
      const enabled = pref.enabled ?? !p.optional;
      const offset = pref.offset || 0;
      out.push({
        ...p,
        key,
        tradition: tid,
        enabled,
        time: plus(p.time, offset),
        end: p.end ? plus(p.end, offset) : null,
        duration: pref.duration || p.duration || 10,
      });
    }
  }
  for (const c of custom) {
    let base;
    if (c.anchor === 'fixed') {
      const [h, mm] = (c.time || '00:00').split(':').map(Number);
      base = ctx.wall(h, mm);
    } else {
      base = ctx.sun[c.anchor]?.();
    }
    const key = `custom.${c.id}`;
    const pref = prefs[key] || {};
    out.push({
      id: c.id,
      key,
      tradition: 'custom',
      name: c.name,
      desc: c.anchor === 'fixed' ? 'Custom prayer' : `${c.offset >= 0 ? '+' : ''}${c.offset || 0} min from ${CUSTOM_ANCHORS[c.anchor].toLowerCase()}`,
      time: plus(base, c.anchor === 'fixed' ? 0 : c.offset || 0),
      enabled: pref.enabled ?? true,
      duration: pref.duration || c.duration || 10,
    });
  }
  out.sort((a, b) => (a.time?.getTime() ?? Infinity) - (b.time?.getTime() ?? Infinity));
  return { items: out, polar: ctx.polar, ctx };
}
