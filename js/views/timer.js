import * as store from '../store.js';
import { $, esc, toast } from '../core.js';
import { formatDuration } from '../tz.js';
import { chime, show } from '../notify.js';

// Timer state lives at module level so it keeps running while you switch tabs.
const T = { label: 'Prayer', total: 0, remaining: 0, endsAt: 0, running: false, lastBell: 0 };
let tick = null;
let wakeLock = null;
const PRESETS = [3, 5, 10, 15, 20, 30, 45, 60];
const TARGETS = [10, 33, 50, 99, 100, 108];

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
  const c = s.counter;
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

  <section class="card center">
    <span class="eyebrow">Counter · tasbīḥ · rosary · mala · japa</span>
    <button class="counter-btn" id="counter" aria-label="Count">
      <span id="count">${c.count}</span>
      <small>of ${c.target}</small>
    </button>
    <div class="chips">
      ${TARGETS.map((n) => `<button class="chip ${c.target === n ? 'on' : ''}" data-target="${n}">${n}</button>`).join('')}
    </div>
    <div class="hero-actions">
      <button class="btn" id="counter-undo">−1</button>
      <button class="btn" id="counter-reset">Reset</button>
    </div>
  </section>`;

  paint();

  root.onclick = (e) => {
    const min = e.target.closest('[data-min]')?.dataset.min;
    const target = e.target.closest('[data-target]')?.dataset.target;
    if (min) {
      setTimer(+min);
      return render(root);
    }
    if (target) {
      store.update((st) => {
        st.counter.target = +target;
      });
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
      case 'counter':
        bump(1);
        break;
      case 'counter-undo':
        bump(-1);
        break;
      case 'counter-reset':
        store.update((st) => {
          st.counter.count = 0;
        });
        $('#count').textContent = '0';
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

  function bump(n) {
    store.update((st) => {
      st.counter.count = Math.max(0, st.counter.count + n);
    });
    const { count, target } = store.get().counter;
    $('#count').textContent = String(count);
    if (n > 0) {
      if (count > 0 && count % target === 0) {
        navigator.vibrate?.([80, 60, 80]);
        chime(1);
        toast(`${count} — round complete`);
      } else navigator.vibrate?.(15);
    }
  }

  // Keep painting when the view is visible (interval runs regardless).
  return () => {};
}
