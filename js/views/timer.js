import * as store from '../store.js';
import { $, esc, toast } from '../core.js';
import { formatDuration } from '../tz.js';
import { chime, show } from '../notify.js';
import { render as renderDhikr } from './dhikr.js';

// Timer state lives at module level so it keeps running while you switch tabs.
const T = { label: 'Prayer', total: 0, remaining: 0, endsAt: 0, running: false, lastBell: 0 };
let tick = null;
let wakeLock = null;
const PRESETS = [3, 5, 10, 15, 20, 30, 45, 60];

export function startTimerFor(prayer) {
  setTimer(prayer.duration || 10, prayer.name);
  start();
}

function setTimer(minutes, label = T.label) {
  stop();
  T.total = T.remaining = Math.max(1, minutes) * 60000;
  T.label = label;
  store.update((s) => {
    s.timer.minutes = minutes;
  });
}

function start() {
  if (T.remaining <= 0) T.remaining = T.total;
  T.endsAt = Date.now() + T.remaining;
  T.lastBell = Date.now();
  T.running = true;
  chime(1);
  requestWake();
  clearInterval(tick);
  tick = setInterval(step, 250);
}

function stop() {
  if (T.running) T.remaining = Math.max(0, T.endsAt - Date.now());
  T.running = false;
  clearInterval(tick);
  releaseWake();
}

function step() {
  T.remaining = Math.max(0, T.endsAt - Date.now());
  const interval = store.get().timer.interval;
  if (interval && T.remaining > 0 && Date.now() - T.lastBell >= interval * 60000) {
    T.lastBell = Date.now();
    chime(1);
  }
  if (T.remaining <= 0) {
    stop();
    chime(3);
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    show(`${T.label} — time complete`, 'May your prayer be accepted.', 'timer');
    toast(`${T.label} timer complete`);
  }
  paint();
}

async function requestWake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
}
function releaseWake() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function paint() {
  const ring = $('#ring-progress');
  if (!ring) return;
  const frac = T.total ? T.remaining / T.total : 0;
  ring.style.strokeDashoffset = String(2 * Math.PI * 90 * (1 - frac));
  $('#timer-display').textContent = formatDuration(T.remaining);
  $('#timer-toggle').textContent = T.running ? 'Pause' : T.remaining > 0 && T.remaining < T.total ? 'Resume' : 'Start';
}

export function render(root) {
  const s = store.get();
  if (!T.total) T.total = T.remaining = s.timer.minutes * 60000;
  const C = 2 * Math.PI * 90;

  root.innerHTML = `
  <section class="card center">
    <span class="eyebrow">Prayer timer</span>
    <input class="timer-label" id="timer-label" value="${esc(T.label)}" aria-label="Timer label" maxlength="40">
    <div class="ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="90" class="ring-bg"/>
        <circle cx="100" cy="100" r="90" class="ring-fg" id="ring-progress" stroke-dasharray="${C}" stroke-dashoffset="0"/>
      </svg>
      <div class="ring-text" id="timer-display">${formatDuration(T.remaining)}</div>
    </div>
    <div class="chips">
      ${PRESETS.map((m) => `<button class="chip ${s.timer.minutes === m ? 'on' : ''}" data-min="${m}">${m} min</button>`).join('')}
    </div>
    <div class="inline-form">
      <label>Custom <input type="number" min="1" max="600" id="custom-min" value="${s.timer.minutes}"> min</label>
      <label>Bell every <select id="interval">
        ${[0, 1, 2, 5, 10, 15].map((v) => `<option value="${v}" ${s.timer.interval === v ? 'selected' : ''}>${v ? `${v} min` : 'never'}</option>`).join('')}
      </select></label>
    </div>
    <div class="hero-actions">
      <button class="btn" id="timer-reset">Reset</button>
      <button class="btn primary" id="timer-toggle">Start</button>
    </div>
    <p class="muted small">The screen stays awake while the timer runs (where supported).</p>
  </section>

  <section class="card center" id="dhikr"></section>`;

  paint();
  renderDhikr($('#dhikr', root));

  root.onclick = (e) => {
    if (e.target.closest('#dhikr')) return; // handled by the remembrance counter
    const min = e.target.closest('[data-min]')?.dataset.min;
    if (min) {
      setTimer(+min);
      return render(root);
    }
    switch (e.target.closest('button')?.id) {
      case 'timer-toggle':
        T.running ? stop() : start();
        paint();
        break;
      case 'timer-reset':
        stop();
        T.remaining = T.total;
        paint();
        break;
    }
  };

  $('#custom-min').onchange = (e) => {
    const v = Math.min(600, Math.max(1, Math.round(+e.target.value || 1)));
    setTimer(v);
    render(root);
  };
  $('#interval').onchange = (e) =>
    store.update((st) => {
      st.timer.interval = +e.target.value;
    });
  $('#timer-label').oninput = (e) => {
    T.label = e.target.value || 'Prayer';
  };

  // Keep painting when the view is visible (interval runs regardless).
  return () => {};
}
