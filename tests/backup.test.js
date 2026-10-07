import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const store = await import('../js/store.js');
const backup = await import('../js/backup.js');

const USER = {
  version: 3,
  onboarded: true,
  location: { lat: 21.4225, lng: 39.8262, timeZone: 'Asia/Riyadh', name: 'Makkah' },
  traditions: ['islam'],
  prayed: { '2026-10-06': { 'islam.fajr': true }, '2026-10-07': { 'islam.dhuhr': true } },
  intentions: { '2026-10-07': { 'islam.fajr': 'For my parents' } },
  checklists: { daily: [{ id: 'a', text: 'Read Qurʾān' }], weekly: [], monthly: [] },
  dhikr: { active: 'islam.subhanallah', autoAdvance: true, targets: {}, round: { 'islam.subhanallah': 5 }, log: {}, totals: { 'islam.subhanallah': 500 }, custom: [] },
  adhan: { mode: 'short', shortSeconds: 20, volume: 0.9, perPrayer: { fajr: 'silent' }, voice: 'makkah' },
};

beforeEach(() => {
  mem.clear();
  mem.set('prayer-app-v1', JSON.stringify(USER));
  store.load();
});

test('a backup round-trips every saved value', async () => {
  const text = await backup.buildBackup({ includeMedia: false });
  const obj = JSON.parse(text);
  assert.equal(obj.format, 'prayer-backup');
  assert.ok(obj.exportedAt);

  // New phone: empty app, then restore
  mem.clear();
  store.load();
  assert.equal(store.get().onboarded, false);
  await backup.restore(backup.parse(text));
  const s = store.get();
  for (const [k, v] of Object.entries(USER)) assert.deepEqual(s[k], v, `field "${k}" differs after restore`);
  assert.deepEqual(JSON.parse(mem.get('prayer-app-v1')).prayed, USER.prayed, 'restored data is saved to storage');
});

test('older plain backups (from the previous Download backup button) still restore', async () => {
  const old = JSON.stringify({ ...USER, version: undefined, counter: { count: 4, target: 33 }, dhikr: undefined, adhan: undefined });
  mem.clear();
  store.load();
  await backup.restore(backup.parse(old));
  const s = store.get();
  assert.deepEqual(s.prayed, USER.prayed);
  assert.equal(s.location.name, 'Makkah');
  assert.equal(s.dhikr.totals.free, 4, 'old counter carried over');
});

test('files that are not backups are refused with a clear message', () => {
  assert.throws(() => backup.parse('hello'), /isn’t a Prayer backup/);
  assert.throws(() => backup.parse('{"foo":1}'), /isn’t a Prayer backup/);
  assert.throws(() => backup.parse('[1,2]'), /isn’t a Prayer backup/);
});

test('restoring keeps a safety copy, and undo puts the previous data back', async () => {
  const other = JSON.stringify({ format: 'prayer-backup', data: { onboarded: true, traditions: ['christianity'], prayed: {} } });
  await backup.restore(backup.parse(other));
  assert.deepEqual(store.get().traditions, ['christianity']);
  assert.ok(backup.hasUndo());
  assert.ok(backup.undoRestore());
  assert.deepEqual(store.get().traditions, ['islam']);
  assert.deepEqual(store.get().prayed, USER.prayed);
  assert.equal(backup.hasUndo(), false);
});

test('summary describes the backup for the confirmation prompt', async () => {
  const p = backup.parse(await backup.buildBackup({ includeMedia: false }));
  const s = backup.summary(p);
  assert.match(s, /Makkah/);
  assert.match(s, /2 day\(s\) of prayer history/);
});

test('backup file name is dated and ends in .json', () => {
  assert.equal(backup.fileName(new Date('2026-10-07T12:00:00Z')), 'prayer-backup-2026-10-07.json');
});
