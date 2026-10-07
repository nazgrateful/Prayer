// Tiny persistent store — everything stays on the device (localStorage).

// The storage key never changes, so existing users keep their data across
// updates. Changes to the data's shape are handled by `migrate()` below.
const KEY = 'prayer-app-v1';
export const SCHEMA_VERSION = 3;

export const DEFAULT_STATE = {
  version: SCHEMA_VERSION,
  onboarded: false,
  location: null, // { lat, lng, elevation, name, timeZone, source }
  traditions: [],
  settings: {}, // per-tradition settings, e.g. { islam: { method, asr } }
  prefs: {}, // per-prayer: { 'islam.fajr': { enabled, notify, remind, offset, duration } }
  custom: [], // custom prayers
  notifications: {
    enabled: false,
    sound: true,
    remindBefore: 10,
    atTime: true,
    includeQuote: true,
    includeIntention: true,
    dailyQuoteTime: '08:00',
  },
  clock24: null, // null = follow locale
  checklists: { daily: [], weekly: [], monthly: [] },
  checks: {}, // { 'daily:2026-10-05': { itemId: true } }
  prayed: {}, // { '2026-10-05': { 'islam.fajr': true } }
  intentions: {}, // { '2026-10-05': { 'islam.fajr': 'text' } }
  favorites: [], // quote refs
  timer: { minutes: 10, interval: 0 },
  counter: { count: 0, target: 33 }, // v1/v2 single counter — kept for safety, superseded by `dhikr`
  dhikr: {
    active: null, // phrase key, e.g. 'islam.subhanallah', 'custom.ab12cd' or 'free'; null = first phrase
    autoAdvance: true, // move to the next phrase of the same tradition when a round completes
    targets: {}, // { phraseKey: n } — user overrides of the default target
    round: {}, // { phraseKey: count in the current round }
    log: {}, // { '2026-10-07': { phraseKey: n } } — repetitions per day
    totals: {}, // { phraseKey: n } — all-time
    custom: [], // [{ id, text, meaning, target }]
  },
  fired: {}, // notification de-duplication
  adhan: {
    mode: 'full', // 'full' | 'short' | 'silent' — default for every prayer
    shortSeconds: 20, // length of the "first part" before fading out
    volume: 0.9,
    perPrayer: {}, // { fajr: 'silent' | 'short' | 'full' | 'default' }
    voice: null, // built-in muezzin id from audio/catalog.json, 'custom', or null = automatic
  },
};

/**
 * Upgrade data saved by an older version of the app. Only ever adds or
 * renames fields — it never drops what the user entered.
 */
export function migrate(saved) {
  if (!saved || typeof saved !== 'object') return saved;
  const out = { ...saved };
  const from = out.version || 1;
  // v1 → v2: adhan settings added. Defaults are filled in by merge(); nothing to convert.
  // v2 → v3: the single counter became the remembrance (dhikr) counter.
  //          Its count and target carry over to the "free count".
  if (from < 3 && !out.dhikr && out.counter && typeof out.counter === 'object') {
    const count = Math.max(0, +out.counter.count || 0);
    const target = Math.max(1, +out.counter.target || 33);
    out.dhikr = { ...structuredClone(DEFAULT_STATE.dhikr), active: count ? 'free' : null, targets: { free: target }, round: { free: count % target }, totals: count ? { free: count } : {} };
  }
  out.version = Math.max(from, SCHEMA_VERSION);
  return out;
}

let state;
const listeners = new Set();

function merge(base, saved) {
  const out = { ...base };
  for (const k of Object.keys(saved || {})) {
    const b = base[k];
    const v = saved[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? { ...b, ...v } : v;
  }
  return out;
}

export function load() {
  let raw = null;
  let saved = null;
  try {
    raw = localStorage.getItem(KEY);
    saved = JSON.parse(raw || 'null');
  } catch {
    saved = null;
  }
  if (saved && typeof saved === 'object' && (saved.version || 1) < SCHEMA_VERSION) {
    // Keep an untouched copy of the old data before upgrading, just in case.
    try {
      localStorage.setItem(`${KEY}.backup-v${saved.version || 1}`, raw);
    } catch {
      /* storage full — the upgrade below is non-destructive anyway */
    }
  }
  state = merge(structuredClone(DEFAULT_STATE), migrate(saved));
  if (saved && saved.version !== state.version) save();
  return state;
}

export function get() {
  return state || load();
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — app keeps working in memory */
  }
  for (const fn of listeners) fn(state);
}

export function update(fn) {
  fn(get());
  save();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportJSON() {
  return JSON.stringify(get(), null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (typeof data !== 'object' || !data) throw new Error('Invalid backup file');
  state = merge(structuredClone(DEFAULT_STATE), migrate(data));
  save();
}

export function reset() {
  state = structuredClone(DEFAULT_STATE);
  save();
}

export const uid = () => Math.random().toString(36).slice(2, 10);
