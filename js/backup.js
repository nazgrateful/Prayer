// Backup & restore that works on every phone:
//  • iPhone/iPad and Android: the system share sheet (Save to Files, Google
//    Drive, iCloud Drive, email, messaging apps…)
//  • everywhere else: a normal file download
//  • last resort: copy the backup as text and paste it back later
// A backup contains all settings and history plus the user's own adhan
// recordings. Older backups (plain settings JSON) can still be restored.

import * as store from './store.js';
import { getFile, putFile } from './media.js';
import { MEDIA_KEYS } from './adhan.js';

export const FORMAT = 'prayer-backup';
const SAFETY_KEY = 'prayer-app-v1.before-restore';

const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

/** The user's own recordings, as { key: { name, type, data } }. */
async function collectMedia() {
  const out = {};
  for (const key of Object.values(MEDIA_KEYS)) {
    const f = await getFile(key);
    if (f?.blob) out[key] = { name: f.name, type: f.type || f.blob.type, data: await blobToDataURL(f.blob) };
  }
  return out;
}

export async function hasOwnRecordings() {
  for (const key of Object.values(MEDIA_KEYS)) if ((await getFile(key))?.blob) return true;
  return false;
}

/** Full backup as a JSON string. */
export async function buildBackup({ includeMedia = true } = {}) {
  const backup = {
    format: FORMAT,
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    data: JSON.parse(store.exportJSON()),
  };
  if (includeMedia) {
    const media = await collectMedia();
    if (Object.keys(media).length) backup.media = media;
  }
  return JSON.stringify(backup);
}

export function fileName(date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  return `prayer-backup-${d}.json`;
}

/**
 * A ready-to-share backup. Built ahead of time so the share sheet can open
 * straight from the tap (iPhones only allow sharing directly after a tap).
 */
export async function prepare(opts) {
  const text = await buildBackup(opts);
  const file = new File([text], fileName(), { type: 'application/json' });
  return { text, file };
}

/**
 * Save the prepared backup: share sheet when the phone supports sharing
 * files, otherwise a download. Resolves to 'shared' | 'downloaded' | 'cancelled'.
 */
export async function save(prepared) {
  const { file, text } = prepared;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Prayer backup' });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      /* sharing failed — fall back to a download */
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name, rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}

/** Copy a (recordings-free, so it stays small) backup to the clipboard. */
export async function copyText() {
  const text = await buildBackup({ includeMedia: false });
  await navigator.clipboard.writeText(text);
  return text;
}

/**
 * Read a backup — this app's backup format, or an older plain settings
 * export. Throws a friendly error if the text isn't a backup.
 */
export function parse(text) {
  let obj;
  try {
    obj = JSON.parse(String(text).trim());
  } catch {
    throw new Error('This isn’t a Prayer backup (the file or text could not be read).');
  }
  const data = obj?.format === FORMAT ? obj.data : obj;
  const looksRight = data && typeof data === 'object' && ('traditions' in data || 'onboarded' in data || 'checklists' in data);
  if (!looksRight) throw new Error('This isn’t a Prayer backup.');
  return { data, media: obj?.format === FORMAT ? obj.media || {} : {}, exportedAt: obj?.exportedAt || null };
}

/** Short description for the confirmation prompt. */
export function summary({ data, media, exportedAt }) {
  const parts = [];
  if (exportedAt) parts.push(`made ${new Date(exportedAt).toLocaleString()}`);
  if (data.location?.name) parts.push(`location: ${data.location.name}`);
  if (data.traditions?.length) parts.push(`${data.traditions.length} tradition(s)`);
  const days = Object.keys(data.prayed || {}).length;
  if (days) parts.push(`${days} day(s) of prayer history`);
  const n = Object.keys(media || {}).length;
  if (n) parts.push(`${n} adhan recording(s)`);
  return parts.join(' · ');
}

/** Replace this device's data with the backup (after keeping a safety copy). */
export async function restore(parsed) {
  try {
    localStorage.setItem(SAFETY_KEY, store.exportJSON());
  } catch {
    /* storage full — continue; the restore itself is what the user asked for */
  }
  store.importJSON(JSON.stringify(parsed.data));
  for (const [key, m] of Object.entries(parsed.media || {})) {
    if (!Object.values(MEDIA_KEYS).includes(key) || !m?.data) continue;
    const blob = await dataURLToBlob(m.data);
    await putFile(key, new File([blob], m.name || 'adhan', { type: m.type || blob.type }));
  }
}

/** Data as it was just before the last restore, if any (to undo it). */
export function hasUndo() {
  try {
    return !!localStorage.getItem(SAFETY_KEY);
  } catch {
    return false;
  }
}

export function undoRestore() {
  const prev = localStorage.getItem(SAFETY_KEY);
  if (!prev) return false;
  store.importJSON(prev);
  localStorage.removeItem(SAFETY_KEY);
  return true;
}

const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Plain-language advice on keeping data safe (HTML list). */
export function keepDataTips() {
  const erase = isIOS()
    ? 'Deleting the app from your Home Screen, or clearing website data in <em>Settings › Safari › Advanced › Website Data</em>, erases it.'
    : 'Uninstalling the app, or clearing this site’s data in your browser settings, erases it.';
  return `<ul class="tips">
    <li><strong>Updates never erase your data.</strong> They install by themselves — just keep using the app.</li>
    <li>Your data is kept <strong>only on this phone</strong>, inside this app. ${erase}</li>
    <li><strong>Save a backup</strong> every now and then, and always before changing phones, reinstalling the app or changing its icon.</li>
    <li>On a new phone, open the app and use <strong>Restore from file</strong> to get everything back.</li>
  </ul>`;
}
