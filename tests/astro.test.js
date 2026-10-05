import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySchedule, TRADITIONS, regionalDefaults } from '../js/traditions.js';
import { zonedTimeToDate, zonedParts, weekKey, addDays } from '../js/tz.js';
import { buildICS } from '../js/ics.js';
import { moonAge } from '../js/astro.js';

const hm = (date, tz) => {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
};
const near = (date, tz, hhmm, tol = 2, label = '') => {
  const [h, m] = hhmm.split(':').map(Number);
  const diff = Math.abs(hm(date, tz) - (h * 60 + m));
  assert.ok(diff <= tol, `${label} expected ~${hhmm}, got ${zonedParts(date, tz).hour}:${zonedParts(date, tz).minute}`);
};
const find = (items, key) => items.find((i) => i.key === key);

test('sunrise and sunset match published values (London, midsummer)', () => {
  const tz = 'Europe/London';
  const { items } = daySchedule({ date: { year: 2024, month: 6, day: 21, weekday: 5 }, location: { lat: 51.5074, lng: -0.1278, timeZone: tz }, traditions: ['islam'] });
  near(find(items, 'islam.sunrise').time, tz, '04:43', 2, 'sunrise');
  near(find(items, 'islam.maghrib').time, tz, '21:21', 2, 'sunset');
  near(find(items, 'islam.dhuhr').time, tz, '13:02', 2, 'noon');
});

test('sunrise and sunset match published values (New York, midwinter)', () => {
  const tz = 'America/New_York';
  const { items } = daySchedule({ date: { year: 2024, month: 12, day: 21, weekday: 6 }, location: { lat: 40.7128, lng: -74.006, timeZone: tz }, traditions: ['christianity'] });
  near(find(items, 'christianity.lauds').time, tz, '07:16', 2, 'sunrise');
  near(find(items, 'christianity.vespers').time, tz, '16:32', 2, 'sunset');
});

test('Makkah Umm al-Qura times', () => {
  const tz = 'Asia/Riyadh';
  const { items } = daySchedule({
    date: { year: 2024, month: 3, day: 20, weekday: 3 },
    location: { lat: 21.4225, lng: 39.8262, timeZone: tz },
    traditions: ['islam'],
    settings: { islam: { method: 'Makkah' } },
  });
  near(find(items, 'islam.fajr').time, tz, '05:08', 3, 'fajr');
  near(find(items, 'islam.asr').time, tz, '15:52', 3, 'asr');
  // Isha is exactly 90 minutes after Maghrib with this method
  assert.equal(find(items, 'islam.isha').time - find(items, 'islam.maghrib').time, 90 * 60000);
});

test('Hanafi Asr is later than standard Asr', () => {
  const loc = { lat: 24.86, lng: 67.0, timeZone: 'Asia/Karachi' };
  const date = { year: 2025, month: 1, day: 15, weekday: 3 };
  const std = find(daySchedule({ date, location: loc, traditions: ['islam'], settings: { islam: { asr: 'standard' } } }).items, 'islam.asr').time;
  const han = find(daySchedule({ date, location: loc, traditions: ['islam'], settings: { islam: { asr: 'hanafi' } } }).items, 'islam.asr').time;
  assert.ok(han > std);
});

test('every tradition yields valid, ordered times in many places', () => {
  const places = [
    { lat: 51.5, lng: -0.12, timeZone: 'Europe/London' },
    { lat: -33.87, lng: 151.21, timeZone: 'Australia/Sydney' },
    { lat: 28.61, lng: 77.21, timeZone: 'Asia/Kolkata' },
    { lat: 64.15, lng: -21.94, timeZone: 'Atlantic/Reykjavik' },
    { lat: 69.65, lng: 18.96, timeZone: 'Europe/Oslo' }, // polar
    { lat: -54.8, lng: -68.3, timeZone: 'America/Argentina/Ushuaia' },
  ];
  for (const location of places) {
    for (let i = 0; i < 365; i += 30) {
      const date = addDays({ year: 2026, month: 1, day: 1 }, i);
      const { items } = daySchedule({ date, location, traditions: Object.keys(TRADITIONS) });
      for (const p of items) assert.ok(p.time instanceof Date && !Number.isNaN(p.time.getTime()), `${p.key} invalid at ${location.timeZone} day ${i}`);
      for (let k = 1; k < items.length; k++) assert.ok(items[k].time >= items[k - 1].time);
      const isl = items.filter((p) => p.tradition === 'islam' && p.id !== 'tahajjud');
      const order = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((id) => isl.find((p) => p.id === id).time);
      for (let k = 1; k < order.length; k++) assert.ok(order[k] > order[k - 1], `islamic order broken at ${location.timeZone} day ${i}`);
    }
  }
});

test('preferences: offsets, hiding and custom prayers', () => {
  const location = { lat: 40.71, lng: -74.0, timeZone: 'America/New_York' };
  const date = { year: 2026, month: 10, day: 5, weekday: 1 };
  const base = find(daySchedule({ date, location, traditions: ['islam'] }).items, 'islam.dhuhr').time;
  const res = daySchedule({
    date,
    location,
    traditions: ['islam'],
    prefs: { 'islam.dhuhr': { offset: 5 }, 'islam.asr': { enabled: false } },
    custom: [{ id: 'c1', name: 'Duha', anchor: 'sunrise', offset: 20 }, { id: 'c2', name: 'Family', anchor: 'fixed', time: '20:15' }],
  });
  assert.equal(find(res.items, 'islam.dhuhr').time - base, 5 * 60000);
  assert.equal(find(res.items, 'islam.asr').enabled, false);
  assert.equal(find(res.items, 'custom.c1').time - find(res.items, 'islam.sunrise').time, 20 * 60000);
  near(find(res.items, 'custom.c2').time, location.timeZone, '20:15', 0);
});

test('weekly observances appear on the right days', () => {
  const location = { lat: 31.77, lng: 35.21, timeZone: 'Asia/Jerusalem' };
  const fri = daySchedule({ date: { year: 2026, month: 10, day: 9, weekday: 5 }, location, traditions: ['judaism', 'islam'] }).items;
  const sun = daySchedule({ date: { year: 2026, month: 10, day: 11, weekday: 0 }, location, traditions: ['christianity'] }).items;
  const candles = find(fri, 'judaism.candles');
  assert.ok(candles);
  // Jerusalem custom: 40 minutes before sunset
  assert.equal(find(fri, 'islam.maghrib').time - candles.time, 40 * 60000);
  assert.equal(find(fri, 'islam.dhuhr').name, 'Jumuʿah');
  assert.ok(find(sun, 'christianity.mass'));
});

test('regional defaults follow the location', () => {
  assert.equal(regionalDefaults('America/Chicago').islam.method, 'ISNA');
  assert.equal(regionalDefaults('Asia/Karachi').islam.asr, 'hanafi');
  assert.equal(regionalDefaults('Asia/Riyadh').islam.method, 'Makkah');
  assert.equal(regionalDefaults('Europe/Berlin').islam.method, 'MWL');
});

test('time-zone helpers handle DST', () => {
  const d = zonedTimeToDate({ year: 2026, month: 3, day: 29, hour: 12, minute: 0 }, 'Europe/London'); // BST starts that day
  assert.equal(d.toISOString(), '2026-03-29T11:00:00.000Z');
  const w = zonedTimeToDate({ year: 2026, month: 1, day: 10, hour: 12, minute: 0 }, 'America/New_York');
  assert.equal(w.toISOString(), '2026-01-10T17:00:00.000Z');
  assert.equal(weekKey({ year: 2026, month: 1, day: 1 }), '2026-W01');
  assert.equal(weekKey({ year: 2027, month: 1, day: 1 }), '2026-W53');
});

test('moon age is near zero at a known new moon', () => {
  const age = moonAge(new Date(Date.UTC(2024, 3, 8, 18, 21))); // total solar eclipse = new moon
  assert.ok(age < 0.6 || age > 28.9, `age ${age}`);
});

test('ICS export contains events with alarms', () => {
  const ics = buildICS([{ uid: 'a', title: 'Fajr; dawn', start: new Date(Date.UTC(2026, 9, 5, 4, 30)), minutes: 10, remindBefore: 10 }]);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART:20261005T043000Z/);
  assert.match(ics, /SUMMARY:Fajr\\; dawn/);
  assert.match(ics, /TRIGGER:-PT10M/);
});
