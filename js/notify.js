// Notification scheduler. Checks every few seconds for due reminders and
// shows them through the service worker (works when the app is in the
// background on most platforms) or the plain Notification API.

let queue = [];
let timer = null;
let onFire = () => {};
let isFired = () => false;
let markFired = () => {};

const GRACE_MS = 3 * 60000; // still fire if the device woke up a little late

export function supported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export async function show(title, body, tag, { silent = false } = {}) {
  if (permission() !== 'granted') return false;
  // `silent` avoids the system sound overlapping an adhan that is already playing.
  const opts = { body, tag, icon: 'icons/icon.svg', badge: 'icons/icon.svg', renotify: true, silent, ...(silent ? {} : { vibrate: [120, 60, 120] }) };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, opts);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}

/** Soft bell made with Web Audio (no audio files needed). */
let audioCtx;
export function chime(times = 1) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    for (let i = 0; i < times; i++) {
      const t = now + i * 1.6;
      for (const [freq, gain] of [[523.25, 0.3], [1046.5, 0.12], [1567.98, 0.06]]) {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
        osc.connect(g).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 2.6);
      }
    }
  } catch {
    /* audio not available */
  }
}

/** Replace the list of upcoming reminders. events: [{ id, at: Date, title, body }] */
export function setQueue(events) {
  queue = events.filter((e) => e.at instanceof Date && !Number.isNaN(e.at.getTime()));
  check();
}

export function init(handlers) {
  onFire = handlers.onFire || onFire;
  isFired = handlers.isFired || isFired;
  markFired = handlers.markFired || markFired;
  clearInterval(timer);
  timer = setInterval(check, 10000);
  document.addEventListener('visibilitychange', check);
}

function check() {
  const now = Date.now();
  for (const e of queue) {
    const t = e.at.getTime();
    if (t <= now && now - t < GRACE_MS && !isFired(e.id)) {
      markFired(e.id);
      onFire(e);
    }
  }
}

export function nextDue() {
  const now = Date.now();
  return queue.filter((e) => e.at.getTime() > now).sort((a, b) => a.at - b.at)[0] || null;
}
