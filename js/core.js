// Shared helpers used by every view.

import * as store from './store.js';
import { daySchedule, TRADITIONS } from './traditions.js';
import { civilDate, addDays, dateKey, formatTime, deviceTimeZone } from './tz.js';
import { quotesFor, intentionsFor, seededIndex } from './content.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function tz() {
  return store.get().location?.timeZone || deviceTimeZone();
}

export function today() {
  return civilDate(new Date(), tz());
}

export function fmt(date) {
  const c = store.get().clock24;
  return formatTime(date, tz(), { hour12: c == null ? undefined : !c });
}

export function tradition(id) {
  return TRADITIONS[id] || { id: 'custom', name: 'Personal', symbol: '✦', color: '#868e96' };
}

const cache = new Map();
store.subscribe(() => cache.clear());

/** Schedule for a civil date, memoised until settings change. */
export function scheduleFor(date) {
  const s = store.get();
  if (!s.location) return { items: [], polar: false };
  const k = dateKey(date);
  if (!cache.has(k)) {
    cache.set(
      k,
      daySchedule({
        date,
        location: s.location,
        traditions: s.traditions,
        settings: s.settings,
        prefs: s.prefs,
        custom: s.custom,
      }),
    );
  }
  return cache.get(k);
}

/** Upcoming enabled prayers across today and the next days. */
export function upcoming(count = 3, from = new Date()) {
  const out = [];
  let d = civilDate(from, tz());
  for (let i = 0; i < 3 && out.length < count; i++, d = addDays(d, 1)) {
    for (const p of scheduleFor(d).items) {
      if (p.enabled && !p.marker && p.time && p.time > from) out.push({ ...p, dateKey: dateKey(d) });
    }
  }
  return out.slice(0, count);
}

/** The prayer currently in its window (started, not yet ended), if any. */
export function current(now = new Date()) {
  const items = scheduleFor(civilDate(now, tz())).items.filter((p) => p.enabled && !p.marker && p.time);
  let cur = null;
  for (const p of items) {
    const end = p.end || new Date(p.time.getTime() + p.duration * 60000);
    if (p.time <= now && now < end) cur = p;
  }
  return cur;
}

export function quoteOfDay(date = today(), salt = '') {
  const list = quotesFor(store.get().traditions);
  return list[seededIndex(dateKey(date) + salt, list.length)];
}

export function intentionSuggestion(seed) {
  const list = intentionsFor(store.get().traditions);
  return list[seededIndex(seed, list.length)];
}

let toastTimer;
export function toast(msg, ms = 3200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function relative(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h} h ${m % 60} min`;
}

/** Long date line, with Hijri / Hebrew dates when those traditions are selected. */
export function dateLine(date) {
  const s = store.get();
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
  const parts = [new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d)];
  const extra = (calendar) => {
    try {
      return new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
    } catch {
      return null;
    }
  };
  if (s.traditions.includes('islam')) parts.push(extra('islamic-umalqura'));
  if (s.traditions.includes('judaism')) parts.push(extra('hebrew'));
  return parts.filter(Boolean).join(' · ');
}
