import * as store from './store.js';
import * as notify from './notify.js';
import { $, $$, tz, today, scheduleFor, quoteOfDay, intentionSuggestion, toast, tradition } from './core.js';
import { addDays, dateKey, zonedTimeToDate } from './tz.js';
import * as todayView from './views/today.js';
import * as timerView from './views/timer.js';
import * as checklistView from './views/checklist.js';
import * as reflectView from './views/reflect.js';
import * as settingsView from './views/settings.js';

const VIEWS = { today: todayView, timer: timerView, checklist: checklistView, reflect: reflectView, settings: settingsView };
let currentView = 'today';
let cleanup = null;

function nav(view, params) {
  if (!VIEWS[view]) view = 'today';
  currentView = view;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  cleanup?.();
  if (view === 'today') todayView.resetDay?.();
  const root = $('#view');
  root.onclick = null;
  cleanup = VIEWS[view].render(root, nav, params) || null;
  $$('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  updateHeader();
  window.scrollTo({ top: 0 });
}

function rerender() {
  cleanup?.();
  const root = $('#view');
  cleanup = VIEWS[currentView].render(root, nav) || null;
  updateHeader();
}

function updateHeader() {
  const s = store.get();
  $('#place').textContent = s.location ? s.location.name : 'Set location';
  $('#trad-symbols').textContent = s.traditions.map((t) => tradition(t).symbol).join(' ');
}

// ---------------------------------------------------------------------------
// Notification queue: next ~36 hours of reminders.

function buildQueue() {
  const s = store.get();
  const n = s.notifications;
  if (!s.location || !n.enabled) return notify.setQueue([]);
  const events = [];
  const horizon = Date.now() + 36 * 3600000;
  let d = addDays(today(), -1);
  for (let i = 0; i < 3; i++, d = addDays(d, 1)) {
    const dk = dateKey(d);
    for (const p of scheduleFor(d).items) {
      const pref = s.prefs[p.key] || {};
      if (!p.enabled || p.marker || !p.time || pref.notify === false || p.time.getTime() > horizon) continue;
      const t = tradition(p.tradition);
      const intention = s.intentions[dk]?.[p.key];
      const bodyParts = [];
      if (n.includeIntention) bodyParts.push(intention ? `Intention: ${intention}` : `Suggested intention: ${intentionSuggestion(p.key + dk)}`);
      if (n.includeQuote) {
        const q = quoteOfDay(d, p.key);
        if (q) bodyParts.push(`“${q.text}” — ${q.ref}`);
      }
      const body = bodyParts.join('\n\n') || p.desc || '';
      const before = pref.remind ?? n.remindBefore;
      if (before > 0) {
        events.push({ id: `${dk}:${p.key}:pre`, at: new Date(p.time - before * 60000), title: `${t.symbol} ${p.name} in ${before} min`, body, key: p.key });
      }
      if (n.atTime) events.push({ id: `${dk}:${p.key}:at`, at: p.time, title: `${t.symbol} Time for ${p.name}`, body, key: p.key, main: true });
    }
    if (n.dailyQuoteTime && /^\d{2}:\d{2}$/.test(n.dailyQuoteTime)) {
      const [h, m] = n.dailyQuoteTime.split(':').map(Number);
      const q = quoteOfDay(d);
      if (q) events.push({ id: `${dk}:quote`, at: zonedTimeToDate({ ...d, hour: h, minute: m }, tz()), title: '📖 Today’s reflection', body: `“${q.text}” — ${q.ref}` });
    }
  }
  notify.setQueue(events);
}

function pruneFired() {
  const cutoff = dateKey(addDays(today(), -3));
  store.update((s) => {
    for (const k of Object.keys(s.fired)) if (k.slice(0, 10) < cutoff) delete s.fired[k];
  });
}

notify.init({
  isFired: (id) => !!store.get().fired[id],
  markFired: (id) => {
    store.get().fired[id] = Date.now();
    store.save();
  },
  onFire: (e) => {
    const s = store.get();
    if (s.notifications.sound) notify.chime(e.main ? 2 : 1);
    notify.show(e.title, e.body, e.id);
    toast(e.title, 6000);
    if (currentView === 'today') rerender();
  },
});

// ---------------------------------------------------------------------------
// Onboarding

function onboarding() {
  const dlg = $('#onboarding');
  const body = $('#onb-body', dlg);
  let step = 1;
  const draft = { traditions: store.get().traditions.slice() };

  const show = () => {
    if (step === 1) {
      body.innerHTML = `
        <h2>Welcome 🕊</h2>
        <p>A free, private companion for prayer in every tradition. Which traditions do you pray in? You can pick more than one.</p>
        <form id="onb-trad">${settingsView.traditionPicker(draft.traditions)}</form>
        <div class="hero-actions"><button class="btn primary" id="onb-next">Continue</button></div>`;
      $('#onb-next', body).onclick = () => {
        draft.traditions = $$('#onb-trad input:checked', body).map((i) => i.value);
        if (!draft.traditions.length) return toast('Choose at least one tradition');
        step = 2;
        show();
      };
    } else {
      body.innerHTML = `
        <h2>Where are you?</h2>
        <p>Your location is used to calculate prayer times from the sun, and to pick the calculation method used in your region. It stays on your device.</p>
        <div id="onb-loc"></div>
        <div class="hero-actions"><button class="btn" id="onb-back">Back</button></div>`;
      $('#onb-loc', body).append(
        settingsView.locationPicker((loc) => {
          store.update((s) => {
            s.traditions = draft.traditions;
            checklistView.seedChecklists(s);
            s.onboarded = true;
          });
          settingsView.applyLocation(loc);
          dlg.close();
          nav('today');
        }),
      );
      $('#onb-back', body).onclick = () => {
        step = 1;
        show();
      };
    }
  };
  show();
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// Boot

store.load();
let rebuildTimer;
store.subscribe(() => {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(buildQueue, 300);
  updateHeader();
});

$('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) nav(b.dataset.view);
});
$('#place').addEventListener('click', () => nav('settings'));
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v !== currentView && VIEWS[v]) nav(v);
});

// Refresh at least every minute so "next prayer" and the day roll over.
let lastDay = dateKey(today());
setInterval(() => {
  const d = dateKey(today());
  if (d !== lastDay) {
    lastDay = d;
    pruneFired();
    buildQueue();
    if (currentView !== 'timer') rerender();
  }
}, 60000);
setInterval(buildQueue, 10 * 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentView === 'today') rerender();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

nav(location.hash.slice(1) || 'today');
buildQueue();
pruneFired();
if (!store.get().onboarded || !store.get().location) onboarding();
