// Tiny persistent store — everything stays on the device (localStorage).

const KEY = 'prayer-app-v1';

export const DEFAULT_STATE = {
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
  counter: { count: 0, target: 33 },
  fired: {}, // notification de-duplication
};

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
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    saved = null;
  }
  state = merge(structuredClone(DEFAULT_STATE), saved);
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
  state = merge(structuredClone(DEFAULT_STATE), data);
  save();
}

export function reset() {
  state = structuredClone(DEFAULT_STATE);
  save();
}

export const uid = () => Math.random().toString(36).slice(2, 10);
