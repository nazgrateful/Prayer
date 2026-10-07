import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION, RELEASES, compareVersions, notesSince } from '../js/version.js';
import { readFileSync } from 'node:fs';

test('version comparison', () => {
  assert.equal(compareVersions('1.4.0', '1.0.0'), 1);
  assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.4', '1.4.0'), 0);
  assert.equal(compareVersions('0.9', '1.0.0'), -1);
});

test('release notes: newest first, current version listed, package.json in step', () => {
  assert.equal(RELEASES[0].version, APP_VERSION, 'add release notes for the current version');
  for (let i = 1; i < RELEASES.length; i++) assert.equal(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), 1);
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version, APP_VERSION);
});

test('people who never saw a "what\'s new" get every note since the first release', () => {
  assert.deepEqual(notesSince(null).map((r) => r.version), RELEASES.filter((r) => r.version !== '1.0.0').map((r) => r.version));
  assert.deepEqual(notesSince(APP_VERSION), []);
});

test('version file is available offline', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'\.\/js\/version\.js'/, 'version.js must be cached for offline use');
});
