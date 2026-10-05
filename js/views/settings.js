import * as store from '../store.js';
import { $, $$, esc, tz, today, scheduleFor, toast, download, tradition } from '../core.js';
import { TRADITIONS, ISLAMIC_METHODS, CUSTOM_ANCHORS, regionalDefaults } from '../traditions.js';
import { fromGPS, searchCity, manual, reverseName } from '../location.js';
import { addDays, dateKey } from '../tz.js';
import { buildICS } from '../ics.js';
import * as notify from '../notify.js';
import { seedChecklists } from './checklist.js';

let openSection = null;

/** Save a new location and adapt calculation settings to the region. */
export function applyLocation(loc) {
  const d = regionalDefaults(loc.timeZone, loc.lat);
  const changes = [];
  store.update((s) => {
    const prev = s.location;
    s.location = loc;
    // Only re-tune when the region (time zone) actually changes.
    if (!prev || prev.timeZone !== loc.timeZone) {
      s.settings.islam = { ...(s.settings.islam || {}), method: d.islam.method, asr: d.islam.asr };
      s.settings.judaism = { ...(s.settings.judaism || {}), candleMinutes: d.judaism.candleMinutes };
      if (s.traditions.includes('islam')) changes.push(`Islamic method: ${ISLAMIC_METHODS[d.islam.method].name}`);
    }
  });
  toast(`Location set to ${loc.name}${changes.length ? ` · ${changes.join(', ')}` : ''}`, 4500);
  if (loc.source === 'gps') {
    reverseName(loc.lat, loc.lng).then((name) => {
      if (name && store.get().location?.lat === loc.lat) store.update((s) => (s.location.name = name));
    });
  }
}

export function locationPicker(onPicked) {
  const wrap = document.createElement('div');
  wrap.className = 'loc-picker';
  wrap.innerHTML = `
    <button class="btn primary block" data-loc="gps">📍 Use my current location</button>
    <form class="add-form" data-loc="search-form">
      <input name="q" placeholder="Search city, e.g. Cairo, London, Delhi" autocomplete="off" required>
      <button class="btn">Search</button>
    </form>
    <ul class="results"></ul>
    <details>
      <summary>Enter coordinates manually</summary>
      <form class="grid-form" data-loc="manual-form">
        <label>Latitude <input name="lat" type="number" step="any" required></label>
        <label>Longitude <input name="lng" type="number" step="any" required></label>
        <label>Elevation (m) <input name="elevation" type="number" step="1" value="0"></label>
        <label>Time zone <input name="timeZone" value="${esc(tz())}" placeholder="Europe/London"></label>
        <label class="span2">Name <input name="name" placeholder="Home"></label>
        <button class="btn span2">Use these coordinates</button>
      </form>
    </details>
    <p class="error small" role="alert"></p>`;
  const err = $('.error', wrap);
  const results = $('.results', wrap);
  let found = [];
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-loc="gps"]')) {
      err.textContent = '';
      e.target.disabled = true;
      e.target.textContent = 'Locating…';
      try {
        onPicked(await fromGPS());
      } catch (x) {
        err.textContent = x.message;
      }
      e.target.disabled = false;
      e.target.textContent = '📍 Use my current location';
    }
    const r = e.target.closest('[data-result]');
    if (r) onPicked(found[+r.dataset.result]);
  });
  $('[data-loc="search-form"]', wrap).onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    results.innerHTML = '<li class="muted">Searching…</li>';
    try {
      found = await searchCity(e.target.q.value.trim());
      results.innerHTML = found.length
        ? found.map((c, i) => `<li><button class="link-btn" data-result="${i}">${esc(c.name)} <small class="muted">${esc(c.timeZone)}</small></button></li>`).join('')
        : '<li class="muted">No matches.</li>';
    } catch (x) {
      results.innerHTML = '';
      err.textContent = `${x.message || 'Search failed'} — you can enter coordinates manually.`;
    }
  };
  $('[data-loc="manual-form"]', wrap).onsubmit = (e) => {
    e.preventDefault();
    try {
      onPicked(manual(Object.fromEntries(new FormData(e.target))));
    } catch (x) {
      err.textContent = x.message;
    }
  };
  return wrap;
}

export function traditionPicker(selected) {
  return `<div class="trad-grid">
    ${Object.values(TRADITIONS)
      .map(
        (t) => `<label class="trad" style="--accent:${t.color}">
        <input type="checkbox" name="trad" value="${t.id}" ${selected.includes(t.id) ? 'checked' : ''}>
        <span class="trad-sym">${t.symbol}</span><span>${esc(t.name)}</span></label>`,
      )
      .join('')}
  </div>`;
}

function section(id, title, body) {
  return `<details class="card settings-sec" data-sec="${id}" ${openSection === id ? 'open' : ''}><summary><h3>${title}</h3></summary>${body}</details>`;
}

function upcomingNotifyEvents(days) {
  const s = store.get();
  const events = [];
  let d = today();
  for (let i = 0; i < days; i++, d = addDays(d, 1)) {
    for (const p of scheduleFor(d).items) {
      if (!p.enabled || p.marker || !p.time || (s.prefs[p.key]?.notify ?? true) === false) continue;
      events.push({
        uid: `${dateKey(d)}-${p.key}`,
        title: `${tradition(p.tradition).symbol} ${p.name}`,
        start: p.time,
        minutes: p.duration,
        description: p.desc || '',
        remindBefore: s.prefs[p.key]?.remind ?? s.notifications.remindBefore,
      });
    }
  }
  return events;
}

export function render(root, nav) {
  const s = store.get();
  const loc = s.location;
  const isl = { ...regionalDefaults(tz()).islam, ...(s.settings.islam || {}) };
  const jud = { ...regionalDefaults(tz()).judaism, ...(s.settings.judaism || {}) };
  // Union of the coming week so weekly prayers (Shabbat, Sunday worship…) can be configured too.
  const raw = [];
  for (let i = 0, d = today(); i < 7; i++, d = addDays(d, 1)) for (const p of scheduleFor(d).items) if (!raw.some((r) => r.key === p.key)) raw.push(p);
  const n = s.notifications;
  const perm = notify.permission();

  root.innerHTML = `
  ${section('location', '📍 Location', `
    ${loc ? `<p><strong>${esc(loc.name)}</strong><br><span class="muted small">${loc.lat}°, ${loc.lng}° · ${esc(loc.timeZone)}${loc.elevation ? ` · ${loc.elevation} m` : ''}</span></p>` : '<p class="muted">No location set yet.</p>'}
    <div id="loc-picker"></div>
    <p class="muted small">Prayer times are calculated on your device from the sun’s position. Your location never leaves the device (except the city name you type into search).</p>`)}

  ${section('traditions', '🕊 Traditions', `
    <p class="muted small">Choose one or more. Interfaith households can combine schedules.</p>
    <form id="trad-form">${traditionPicker(s.traditions)}</form>
    ${s.traditions.includes('islam') ? `
      <h4>☪ Islamic calculation</h4>
      <label class="field">Method <select data-setting="islam.method">
        ${Object.entries(ISLAMIC_METHODS).map(([k, m]) => `<option value="${k}" ${isl.method === k ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select></label>
      <label class="field">ʿAsr <select data-setting="islam.asr">
        <option value="standard" ${isl.asr === 'standard' ? 'selected' : ''}>Standard (Shāfiʿī, Mālikī, Ḥanbalī)</option>
        <option value="hanafi" ${isl.asr === 'hanafi' ? 'selected' : ''}>Ḥanafī</option>
      </select></label>
      <label class="field">High-latitude rule <select data-setting="islam.highLatitude">
        <option value="angle" ${isl.highLatitude === 'angle' ? 'selected' : ''}>Angle-based (recommended)</option>
        <option value="seventh" ${isl.highLatitude === 'seventh' ? 'selected' : ''}>One-seventh of the night</option>
        <option value="middle" ${isl.highLatitude === 'middle' ? 'selected' : ''}>Middle of the night</option>
      </select></label>` : ''}
    ${s.traditions.includes('judaism') ? `
      <h4>✡ Jewish times</h4>
      <label class="field">Candle lighting before sunset <select data-setting="judaism.candleMinutes">
        ${[18, 20, 22, 30, 40].map((v) => `<option value="${v}" ${+jud.candleMinutes === v ? 'selected' : ''}>${v} minutes</option>`).join('')}
      </select></label>` : ''}
  `)}

  ${section('prayers', '🕰 Prayers & adjustments', `
    <p class="muted small">Show or hide prayers, toggle reminders, shift a time by a few minutes to match your mosque, church or community, and set the default timer length.</p>
    <div class="pref-table">
      <div class="pref-head"><span>Prayer</span><span>Show</span><span>🔔</span><span>± min</span><span>Timer</span></div>
      ${raw.filter((p) => !p.marker).map((p) => {
        const pr = s.prefs[p.key] || {};
        return `<div class="pref-row" data-key="${esc(p.key)}">
          <span><span class="dot" style="color:${tradition(p.tradition).color}">${tradition(p.tradition).symbol}</span> ${esc(p.name)}</span>
          <input type="checkbox" data-pref="enabled" ${p.enabled ? 'checked' : ''} aria-label="Show ${esc(p.name)}">
          <input type="checkbox" data-pref="notify" ${(pr.notify ?? true) ? 'checked' : ''} aria-label="Remind ${esc(p.name)}">
          <input type="number" data-pref="offset" value="${pr.offset || 0}" step="1" min="-120" max="120" aria-label="Offset minutes">
          <input type="number" data-pref="duration" value="${p.duration}" step="1" min="1" max="240" aria-label="Timer minutes">
        </div>`;
      }).join('') || '<p class="muted">Select a tradition first.</p>'}
    </div>
    <h4>Custom prayers</h4>
    <ul class="simple-list">
      ${s.custom.map((c) => `<li class="spread"><span>${esc(c.name)} · <span class="muted">${c.anchor === 'fixed' ? esc(c.time) : `${c.offset >= 0 ? '+' : ''}${c.offset} min ${esc(CUSTOM_ANCHORS[c.anchor].toLowerCase())}`}</span></span><button class="icon-btn" data-del-custom="${c.id}" aria-label="Delete">✕</button></li>`).join('') || '<li class="muted">None yet.</li>'}
    </ul>
    <form class="grid-form" id="custom-form">
      <label class="span2">Name <input name="name" required maxlength="40" placeholder="e.g. Family rosary, Duha, Meditation"></label>
      <label>Based on <select name="anchor">${Object.entries(CUSTOM_ANCHORS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Time / offset <input name="when" placeholder="07:30 or +20" required></label>
      <button class="btn span2">Add custom prayer</button>
    </form>
  `)}

  ${section('notifications', '🔔 Notifications & reminders', `
    <label class="switch"><input type="checkbox" id="notif-enabled" ${n.enabled && perm === 'granted' ? 'checked' : ''}><span>Enable prayer notifications</span></label>
    ${perm === 'denied' ? '<p class="error small">Notifications are blocked in your browser settings for this site.</p>' : ''}
    ${perm === 'unsupported' ? '<p class="error small">This browser does not support notifications. Use the calendar export below instead.</p>' : ''}
    <label class="field">Remind me before <select data-notif="remindBefore">
      ${[0, 5, 10, 15, 20, 30, 45, 60].map((v) => `<option value="${v}" ${n.remindBefore === v ? 'selected' : ''}>${v ? `${v} minutes` : 'no early reminder'}</option>`).join('')}
    </select></label>
    <label class="switch"><input type="checkbox" data-notif="atTime" ${n.atTime ? 'checked' : ''}><span>Notify at the start of each prayer</span></label>
    <label class="switch"><input type="checkbox" data-notif="sound" ${n.sound ? 'checked' : ''}><span>Play a soft bell in the app</span></label>
    <label class="switch"><input type="checkbox" data-notif="includeQuote" ${n.includeQuote ? 'checked' : ''}><span>Include a scripture quote</span></label>
    <label class="switch"><input type="checkbox" data-notif="includeIntention" ${n.includeIntention ? 'checked' : ''}><span>Include my intention (or a suggestion)</span></label>
    <label class="field">Daily quote reminder <input type="time" data-notif="dailyQuoteTime" value="${esc(n.dailyQuoteTime || '')}"></label>
    <div class="hero-actions"><button class="btn" id="test-notif">Send test</button><button class="btn primary" id="export-ics">Export 30 days to calendar</button></div>
    <p class="muted small">Web apps can only notify while the app is open or recently in the background. For guaranteed alarms with the app closed, export to your phone’s calendar (Google, Apple, Outlook) — each prayer comes with its own alarm. Re-export monthly.</p>
  `)}

  ${section('display', '🎨 Display', `
    <label class="field">Clock <select id="clock">
      <option value="" ${s.clock24 == null ? 'selected' : ''}>Follow device</option>
      <option value="24" ${s.clock24 === true ? 'selected' : ''}>24-hour</option>
      <option value="12" ${s.clock24 === false ? 'selected' : ''}>12-hour</option>
    </select></label>
  `)}

  ${section('data', '💾 Your data', `
    <p class="muted small">Everything is stored only on this device. Back it up or move it to another phone.</p>
    <div class="hero-actions">
      <button class="btn" id="backup">Download backup</button>
      <label class="btn">Restore backup<input type="file" id="restore" accept="application/json" hidden></label>
    </div>
    <button class="link-btn danger" id="reset">Reset app</button>
  `)}

  <p class="muted small center">Prayer · free & open source · no ads, no tracking.</p>
  `;

  const picker = $('#loc-picker', root);
  picker.append(
    locationPicker((l) => {
      applyLocation(l);
      render(root, nav);
    }),
  );

  $$('details[data-sec]', root).forEach((d) =>
    d.addEventListener('toggle', () => {
      if (d.open) openSection = d.dataset.sec;
      else if (openSection === d.dataset.sec) openSection = null;
    }),
  );

  $('#trad-form', root).onchange = (e) => {
    const checked = $$('input[name=trad]:checked', root).map((i) => i.value);
    store.update((st) => {
      const added = checked.filter((t) => !st.traditions.includes(t));
      st.traditions = checked;
      if (added.length) {
        const prev = st.traditions;
        st.traditions = added;
        seedChecklists(st);
        st.traditions = prev;
      }
    });
    render(root, nav);
  };

  $$('[data-setting]', root).forEach((el) => {
    el.onchange = () => {
      const [t, k] = el.dataset.setting.split('.');
      store.update((st) => {
        st.settings[t] = { ...(st.settings[t] || {}), [k]: el.value };
      });
      toast('Updated');
    };
  });

  $$('.pref-row [data-pref]', root).forEach((el) => {
    el.onchange = () => {
      const key = el.closest('[data-key]').dataset.key;
      const f = el.dataset.pref;
      store.update((st) => {
        const p = (st.prefs[key] = st.prefs[key] || {});
        p[f] = el.type === 'checkbox' ? el.checked : Math.round(+el.value || 0);
      });
    };
  });

  $('#custom-form', root).onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const c = { id: store.uid(), name: f.name.trim(), anchor: f.anchor, duration: 10 };
    if (f.anchor === 'fixed') {
      const m = /^(\d{1,2}):(\d{2})$/.exec(f.when.trim());
      if (!m || +m[1] > 23 || +m[2] > 59) return toast('Enter a time like 07:30');
      c.time = `${m[1].padStart(2, '0')}:${m[2]}`;
    } else {
      const o = parseInt(f.when, 10);
      if (Number.isNaN(o)) return toast('Enter an offset in minutes, e.g. +20 or -15');
      c.offset = o;
    }
    store.update((st) => st.custom.push(c));
    render(root, nav);
  };
  root.onclick = (e) => {
    const id = e.target.closest('[data-del-custom]')?.dataset.delCustom;
    if (id) {
      store.update((st) => {
        st.custom = st.custom.filter((c) => c.id !== id);
      });
      render(root, nav);
    }
  };

  $('#notif-enabled', root).onchange = async (e) => {
    if (e.target.checked) {
      const p = await notify.requestPermission();
      if (p !== 'granted') {
        e.target.checked = false;
        toast(p === 'unsupported' ? 'Notifications are not supported here' : 'Permission not granted');
      }
      store.update((st) => (st.notifications.enabled = p === 'granted'));
    } else store.update((st) => (st.notifications.enabled = false));
    render(root, nav);
  };
  $$('[data-notif]', root).forEach((el) => {
    el.onchange = () =>
      store.update((st) => {
        const k = el.dataset.notif;
        st.notifications[k] = el.type === 'checkbox' ? el.checked : k === 'remindBefore' ? +el.value : el.value;
      });
  });
  $('#test-notif', root).onclick = async () => {
    if (store.get().notifications.sound) notify.chime(1);
    const ok = await notify.show('🔔 Prayer reminder test', 'Notifications are working. May your prayers be accepted.', 'test');
    toast(ok ? 'Test notification sent' : 'Enable notifications first');
  };
  $('#export-ics', root).onclick = () => {
    if (!store.get().location) return toast('Set your location first');
    download('prayer-times.ics', buildICS(upcomingNotifyEvents(30)), 'text/calendar');
    toast('Calendar file downloaded — open it to import');
  };

  $('#clock', root).onchange = (e) => store.update((st) => (st.clock24 = e.target.value === '' ? null : e.target.value === '24'));

  $('#backup', root).onclick = () => download(`prayer-backup-${dateKey(today())}.json`, store.exportJSON(), 'application/json');
  $('#restore', root).onchange = async (e) => {
    try {
      store.importJSON(await e.target.files[0].text());
      toast('Backup restored');
      render(root, nav);
    } catch (x) {
      toast(x.message || 'Could not read backup');
    }
  };
  $('#reset', root).onclick = () => {
    if (confirm('Delete all settings, checklists and history on this device?')) {
      store.reset();
      location.reload();
    }
  };
}
