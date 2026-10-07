// Adhan (call to prayer) playback for the Islamic prayers.
//
// Modes: 'full' plays the whole recording, 'short' plays the opening
// (the first takbīr) and fades out, 'silent' plays nothing.
//
// Audio source: the muezzin the user picked — one of the built-in recordings
// listed in audio/catalog.json, or their own file (stored in IndexedDB).
// Without a choice: own file → first built-in voice → audio/adhan.mp3.
// Fajr uses a Fajr-specific recording when one exists, else the regular one.

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

// ---------------------------------------------------------------------------
// Built-in muezzin menu: audio/catalog.json lists recordings shipped with the app.
//   { "voices": [ { "id", "name", "origin", "file", "fajrFile"?, "credit", "license" } ] }

let catalogPromise = null;
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('audio/catalog.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { voices: [] }))
      .then((j) => (Array.isArray(j.voices) ? j.voices.filter((v) => v && v.id && v.name && v.file) : []))
      .catch(() => []);
  }
  return catalogPromise;
}

async function fromCustom(kind) {
  for (const k of kind === 'fajr' ? ['fajr', 'regular'] : ['regular']) {
    const file = await getFile(MEDIA_KEYS[k]);
    if (file?.blob) return { blob: file.blob, label: file.name, custom: true, kind: k, voice: 'custom' };
  }
  return null;
}

async function fromVoice(v, kind) {
  const useFajr = kind === 'fajr' && v.fajrFile;
  const url = `audio/${useFajr ? v.fajrFile : v.file}`;
  return (await bundled(url)) ? { url, label: v.name, custom: false, kind: useFajr ? 'fajr' : 'regular', voice: v.id } : null;
}

async function fromLegacy(kind) {
  for (const k of kind === 'fajr' ? ['fajr', 'regular'] : ['regular']) {
    if (await bundled(BUNDLED[k])) return { url: BUNDLED[k], label: 'Built-in recording', custom: false, kind: k, voice: null };
  }
  return null;
}

/**
 * Find the recording for 'regular' or 'fajr'.
 * voice: 'custom' (the user's own file), a catalog id, or null for automatic
 * (own file → first built-in voice → audio/adhan.mp3).
 */
async function locate(kind, voice) {
  const voices = await loadCatalog();
  if (voice === 'custom') {
    const own = await fromCustom(kind);
    if (own) return own;
  } else if (voice) {
    const v = voices.find((x) => x.id === voice);
    const r = v && (await fromVoice(v, kind));
    if (r) return r;
  }
  return (await fromCustom(kind)) || (voices[0] && (await fromVoice(voices[0], kind))) || fromLegacy(kind);
}

/** Playable source: { url, label, revoke, custom, kind, voice } or null. */
export async function resolveSource(kind, voice = null) {
  const r = await locate(kind, voice);
  if (!r) return null;
  if (r.blob) return { ...r, url: URL.createObjectURL(r.blob), blob: undefined, revoke: true };
  return { ...r, revoke: false };
}

/** Same lookup as resolveSource, without creating object URLs (for display). */
export async function describeSource(kind, voice = null) {
  const r = await locate(kind, voice);
  return r && { label: r.label, custom: r.custom, kind: r.kind, voice: r.voice };
}

/** Download a built-in recording once so it also plays offline (stored by the service worker). */
export function warm(voice) {
  const urls = [voice.file, voice.fajrFile].filter(Boolean).map((f) => `audio/${f}`);
  return Promise.all(urls.map((u) => fetch(u).then((r) => r.ok && r.arrayBuffer()).catch(() => null)));
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
export async function play(prayerId, { mode = 'full', shortSeconds = 20, volume = 0.9, title, voice = null } = {}) {
  if (mode === 'silent') return { status: 'silent' };
  const src = await resolveSource(prayerId === 'fajr' ? 'fajr' : 'regular', voice);
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
