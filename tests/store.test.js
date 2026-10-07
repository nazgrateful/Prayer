import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage for Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../js/store.js');
const { modeFor, ADHAN_PRAYERS } = await import('../js/adhan.js');

// Exactly what version 1 of the app saved (no `version`, no `adhan`).
const V1_SAVE = {
  onboarded: true,
  location: { lat: 51.5074, lng: -0.1278, elevation: 11, name: 'London, United Kingdom', timeZone: 'Europe/London', source: 'search' },
  traditions: ['islam', 'christianity'],
  settings: { islam: { method: 'MWL', asr: 'hanafi', highLatitude: 'seventh' }, judaism: { candleMinutes: 18 } },
  prefs: { 'islam.fajr': { offset: 3, notify: false, duration: 12 }, 'islam.tahajjud': { enabled: true } },
  custom: [{ id: 'abc123', name: 'Duha', anchor: 'sunrise', offset: 20, duration: 10 }],
  notifications: { enabled: true, sound: false, remindBefore: 15, atTime: true, includeQuote: false, includeIntention: true, dailyQuoteTime: '07:30' },
  clock24: true,
  checklists: {
    daily: [{ id: 'd1', text: 'Pray all five daily prayers', tradition: 'islam' }, { id: 'd2', text: 'Call my mother' }],
    weekly: [{ id: 'w1', text: 'Attend Jumuʿah', tradition: 'islam' }],
    monthly: [],
  },
  checks: { 'daily:2026-10-05': { d1: true }, 'weekly:2026-W41': { w1: true } },
  prayed: { '2026-10-05': { 'islam.fajr': true, 'islam.dhuhr': true } },
  intentions: { '2026-10-05': { 'islam.fajr': 'For my parents' } },
  favorites: ['Qurʾān 13:28', 'Psalm 46:10'],
  timer: { minutes: 15, interval: 5 },
  counter: { count: 66, target: 33 },
  fired: { '2026-10-05:islam.fajr:at': 1780000000000 },
};

beforeEach(() => mem.clear());

test('upgrading keeps every piece of existing user data', () => {
  mem.set('prayer-app-v1', JSON.stringify(V1_SAVE));
  const s = store.load();
  for (const [k, v] of Object.entries(V1_SAVE)) assert.deepEqual(s[k], v, `field "${k}" changed during upgrade`);
  assert.equal(s.version, store.SCHEMA_VERSION);
  assert.deepEqual(s.adhan, store.DEFAULT_STATE.adhan);
});

test('upgrading writes a backup of the old data and persists the new version', () => {
  const raw = JSON.stringify(V1_SAVE);
  mem.set('prayer-app-v1', raw);
  store.load();
  assert.equal(mem.get('prayer-app-v1.backup-v1'), raw, 'backup must be byte-for-byte identical');
  const persisted = JSON.parse(mem.get('prayer-app-v1'));
  assert.equal(persisted.version, 2);
  for (const [k, v] of Object.entries(V1_SAVE)) assert.deepEqual(persisted[k], v);
});

test('loading again after the upgrade changes nothing and makes no new backup', () => {
  mem.set('prayer-app-v1', JSON.stringify(V1_SAVE));
  store.load();
  const after = mem.get('prayer-app-v1');
  mem.delete('prayer-app-v1.backup-v1');
  const s = store.load();
  assert.equal(JSON.stringify(s), after);
  assert.equal(mem.has('prayer-app-v1.backup-v1'), false);
});

test('saved adhan choices survive reloads', () => {
  mem.set('prayer-app-v1', JSON.stringify(V1_SAVE));
  store.load();
  store.update((s) => {
    s.adhan.mode = 'short';
    s.adhan.perPrayer = { fajr: 'silent' };
  });
  const s = store.load();
  assert.equal(s.adhan.mode, 'short');
  assert.deepEqual(s.adhan.perPrayer, { fajr: 'silent' });
  assert.equal(s.adhan.shortSeconds, 20); // untouched defaults remain
  assert.deepEqual(s.prayed, V1_SAVE.prayed);
});

test('restoring an old backup file also upgrades without losing data', () => {
  store.load();
  store.importJSON(JSON.stringify(V1_SAVE));
  const s = store.get();
  for (const [k, v] of Object.entries(V1_SAVE)) assert.deepEqual(s[k], v);
  assert.equal(s.adhan.mode, 'full');
});

test('a fresh install starts with defaults and no backup', () => {
  const s = store.load();
  assert.equal(s.onboarded, false);
  assert.equal(s.adhan.mode, 'full');
  assert.equal([...mem.keys()].some((k) => k.includes('backup')), false);
});

test('adhan mode: per-prayer overrides, default, and non-adhan prayers', () => {
  const a = { mode: 'short', perPrayer: { fajr: 'silent', isha: 'full', asr: 'default' } };
  assert.equal(modeFor(a, 'fajr'), 'silent');
  assert.equal(modeFor(a, 'isha'), 'full');
  assert.equal(modeFor(a, 'asr'), 'short');
  assert.equal(modeFor(a, 'maghrib'), 'short');
  assert.equal(modeFor(a, 'tahajjud'), 'silent'); // no adhan for voluntary prayers
  assert.equal(modeFor(a, 'sunrise'), 'silent');
  assert.equal(modeFor({ mode: 'bogus', perPrayer: {} }, 'dhuhr'), 'full');
  assert.deepEqual(ADHAN_PRAYERS, ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
});
