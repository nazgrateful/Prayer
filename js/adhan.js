// Adhan (call to prayer) playback for the Islamic prayers.
//
// Modes: 'full' plays the whole recording, 'short' plays the opening
// (the first takbīr) and fades out, 'silent' plays nothing.
//
// Audio source, in order of preference:
//   1. a recording the user chose on their device (stored in IndexedDB)
//   2. a recording shipped with the app at audio/adhan.mp3 (audio/adhan-fajr.mp3 for Fajr)
// Fajr falls back to the regular adhan when no Fajr-specific recording exists.

import { getFile } from './media.js';

export const ADHAN_MODES = {
  full: 'Full adhan',
  short: 'First part only',
  silent: 'Silent',
};

// Prayers that have an adhan. Jumuʿah uses the 'dhuhr' id.
export const ADHAN_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const MEDIA_KEYS = { regular: 'adhan', fajr: 'adhan-fajr' };
const BUNDLED = { regular: 'audio/adhan.mp3', fajr: 'audio/adhan-fajr.mp3' };

/** Effective mode for one prayer: its own override, else the default. */
export function modeFor(adhan, prayerId) {
  if (!adhan || !ADHAN_PRAYERS.includes(prayerId)) return 'silent';
  const own = adhan.perPrayer?.[prayerId];
  const mode = own && own !== 'default' ? own : adhan.mode;
  return ADHAN_MODES[mode] ? mode : 'full';
}

const bundledCache = new Map();
async function bundled(path) {
  if (!bundledCache.has(path)) {
    const isAudio = (r) => !!r && r.ok && (r.headers.get('content-type') || '').startsWith('audio');
    bundledCache.set(
      path,
      (async () => {
        try {
          if (typeof caches !== 'undefined' && isAudio(await caches.match(path, { ignoreSearch: true }))) return true; // offline copy
        } catch {
          /* ignore */
        }
        return fetch(path, { method: 'HEAD', cache: 'no-cache' }).then(isAudio).catch(() => false);
      })(),
    );
  }
  return bundledCache.get(path);
}

/** Where the audio for 'regular' or 'fajr' would come from: { url, label, revoke } or null. */
export async function resolveSource(kind) {
  const chain = kind === 'fajr' ? ['fajr', 'regular'] : ['regular'];
  for (const k of chain) {
    const file = await getFile(MEDIA_KEYS[k]);
    if (file?.blob) return { url: URL.createObjectURL(file.blob), label: file.name, revoke: true, custom: true, kind: k };
    if (await bundled(BUNDLED[k])) return { url: BUNDLED[k], label: 'Built-in recording', revoke: false, custom: false, kind: k };
  }
  return null;
}

/** Same lookup as resolveSource, without creating object URLs (for display). */
export async function describeSource(kind) {
  const chain = kind === 'fajr' ? ['fajr', 'regular'] : ['regular'];
  for (const k of chain) {
    const file = await getFile(MEDIA_KEYS[k]);
    if (file?.blob) return { label: file.name, custom: true, kind: k };
    if (await bundled(BUNDLED[k])) return { label: 'Built-in recording', custom: false, kind: k };
  }
  return null;
}

let current = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(current));

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function nowPlaying() {
  return current;
}

/**
 * Play the adhan for `prayerId`.
 * Resolves to { status: 'playing' | 'silent' | 'nosource' | 'blocked' }.
 */
export async function play(prayerId, { mode = 'full', shortSeconds = 20, volume = 0.9, title } = {}) {
  if (mode === 'silent') return { status: 'silent' };
  const src = await resolveSource(prayerId === 'fajr' ? 'fajr' : 'regular');
  if (!src) return { status: 'nosource' };
  stop();
  const audio = new Audio(src.url);
  audio.volume = Math.min(1, Math.max(0, volume));
  try {
    await audio.play();
  } catch {
    if (src.revoke) URL.revokeObjectURL(src.url);
    return { status: 'blocked' }; // browser autoplay rules: needs a tap first
  }
  const entry = { audio, prayerId, mode, src, title: title || 'Adhan', timer: null, fade: null };
  current = entry;
  audio.onended = () => current === entry && stop();
  if (mode === 'short') entry.timer = setTimeout(() => fadeOut(entry), Math.max(3, shortSeconds) * 1000);
  setMediaSession(entry);
  emit();
  return { status: 'playing' };
}

function fadeOut(entry, ms = 2500) {
  if (current !== entry) return;
  const start = entry.audio.volume;
  const t0 = Date.now();
  entry.fade = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    entry.audio.volume = start * (1 - k);
    if (k >= 1) stop();
  }, 80);
}

export function stop() {
  const e = current;
  if (!e) return;
  current = null;
  clearTimeout(e.timer);
  clearInterval(e.fade);
  e.audio.pause();
  e.audio.removeAttribute('src');
  if (e.src.revoke) URL.revokeObjectURL(e.src.url);
  try {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  } catch {
    /* ignore */
  }
  emit();
}

// Lock-screen / headset controls where supported.
function setMediaSession(entry) {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: entry.title, artist: 'Prayer', artwork: [{ src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }] });
    for (const action of ['pause', 'stop']) navigator.mediaSession.setActionHandler(action, () => stop());
  } catch {
    /* ignore */
  }
}
