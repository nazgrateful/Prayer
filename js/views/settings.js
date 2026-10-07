import * as store from '../store.js';
import { $, $$, esc, tz, today, scheduleFor, toast, download, tradition } from '../core.js';
import { TRADITIONS, ISLAMIC_METHODS, CUSTOM_ANCHORS, regionalDefaults } from '../traditions.js';
import { fromGPS, searchCity, manual, reverseName } from '../location.js';
import { addDays, dateKey } from '../tz.js';
import { buildICS } from '../ics.js';
import * as notify from '../notify.js';
import * as adhan from '../adhan.js';
import { putFile, deleteFile } from '../media.js';
import * as backup from '../backup.js';
import { seedChecklists } from './checklist.js';

let openSection = null;

/** Open a settings section next time Settings is shown (e.g. from the update message). */
export function focusSection(id) {
  openSection = id;
}

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

// ---------------------------------------------------------------------------
// Backup

let includeMedia = true;
let prepared = null; // backup built ahead of the tap (iPhones only allow sharing right after a tap)

function backupHint() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
    return 'iPhone & iPad: choose <strong>Save to Files</strong> (iCloud Drive or On My iPhone), or send it to yourself by Mail or Messages.';
  if (/Android/.test(ua)) return 'Android: choose <strong>Drive</strong>, <strong>Files</strong> or an email/messaging app — or it is saved to your <strong>Downloads</strong> folder.';
  return 'The backup file is saved to your Downloads folder.';
}

async function prepareBackup() {
  prepared = null;
  try {
    prepared = await backup.prepare({ includeMedia });
  } catch {
    prepared = null;
  }
}

function markBackedUp() {
  store.update((st) => (st.lastBackup = new Date().toISOString()));
}

async function restoreFrom(text, root, nav) {
  let parsed;
  try {
    parsed = backup.parse(text);
  } catch (x) {
    return toast(x.message, 5000);
  }
  const info = backup.summary(parsed);
  if (!confirm(`Restore this backup?${info ? `\n\n${info}` : ''}\n\nThe data on this phone will be replaced. (You can undo this right after.)`)) return;
  try {
    await backup.restore(parsed);
    toast('Backup restored ✓');
    setTimeout(() => location.reload(), 600);
  } catch (x) {
    toast(x.message || 'Could not restore the backup', 5000);
    render(root, nav);
  }
}

function bindBackup(root, nav) {
  const sec = $('[data-sec="data"]', root);
  if (sec.open) prepareBackup();
  sec.addEventListener('toggle', () => sec.open && prepareBackup());
  backup.hasOwnRecordings().then((has) => ($('#backup-media-row', root).hidden = !has));
  $('#backup-media', root).onchange = (e) => {
    includeMedia = e.target.checked;
    prepareBackup();
  };
  $('#backup-save', root).onclick = async () => {
    const ready = prepared || (await backup.prepare({ includeMedia }));
    const how = await backup.save(ready);
    if (how === 'cancelled') return;
    markBackedUp();
    toast(how === 'shared' ? 'Backup saved ✓' : `Backup saved to Downloads ✓ (${ready.file.name})`, 5000);
    render(root, nav);
  };
  $('#backup-copy', root).onclick = async () => {
    try {
      await backup.copyText();
      markBackedUp();
      toast('Backup copied — paste it into Notes or an email to yourself', 5000);
      render(root, nav);
    } catch {
      toast('Copying is not allowed here — use Save backup instead', 5000);
    }
  };
  $('#restore', root).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) restoreFrom(await file.text(), root, nav);
  };
  $('#restore-text-btn', root).onclick = () => {
    const text = $('#restore-text', root).value;
    if (!text.trim()) return toast('Paste the backup text first');
    restoreFrom(text, root, nav);
  };
  const undo = $('#restore-undo', root);
  if (undo)
    undo.onclick = () => {
      if (!confirm('Put back the data you had before the last restore?')) return;
      if (backup.undoRestore()) {
        toast('Previous data put back ✓');
        setTimeout(() => location.reload(), 600);
      }
    };
}

const ADHAN_PRAYER_NAMES = { fajr: 'Fajr', dhuhr: 'Dhuhr / Jumuʿah', asr: 'ʿAsr', maghrib: 'Maghrib', isha: 'ʿIshaʾ' };
const MAX_AUDIO_MB = 15;
const SHORT_MODE = { full: 'full', short: 'first part', silent: 'silent' };

function adhanSection(a) {
  const opt = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
  return `
    <p class="muted small">Plays at the start of each of the five daily prayers, even when system notifications are off.</p>
    <div class="adhan-mode" role="radiogroup" aria-label="Adhan">
      ${Object.entries(adhan.ADHAN_MODES)
        .map(([k, label]) => `<label><input type="radio" name="adhan-mode" value="${k}" ${a.mode === k ? 'checked' : ''}>${k === 'full' ? '🔊' : k === 'short' ? '🔉' : '🔇'} ${label}</label>`)
        .join('')}
    </div>
    <div class="adhan-grid">
      <label class="field">First part length <select data-adhan="shortSeconds">
        ${[10, 15, 20, 30, 45, 60].map((v) => opt(v, `${v} seconds`, a.shortSeconds)).join('')}
      </select></label>
      <label class="field">Volume <input type="range" min="0.1" max="1" step="0.05" data-adhan="volume" value="${a.volume}"></label>
    </div>
    <h4>Per prayer</h4>
    <div class="adhan-grid">
      ${adhan.ADHAN_PRAYERS.map(
        (id) => `<label class="field">${ADHAN_PRAYER_NAMES[id]} <select data-adhan-prayer="${id}">
          ${opt('default', `Default (${SHORT_MODE[a.mode]})`, a.perPrayer[id] || 'default')}
          ${Object.entries(adhan.ADHAN_MODES).map(([k, label]) => opt(k, label, a.perPrayer[id])).join('')}
        </select></label>`,
      ).join('')}
    </div>
    <h4>Muezzin</h4>
    <div class="voice-list" id="voice-list"><p class="muted small">Loading…</p></div>
    <div class="own-recordings" id="own-recordings">
      <div class="file-row" data-kind="regular">
        <div><strong>My adhan file</strong><br><span class="muted small" data-source="regular">Checking…</span></div>
        <div class="actions">
          <label class="btn">Choose file<input type="file" accept="audio/*" data-upload="regular" hidden></label>
          <button class="btn" data-remove="regular" hidden>Remove</button>
        </div>
      </div>
      <div class="file-row" data-kind="fajr">
        <div><strong>My Fajr adhan</strong> <span class="muted small">(optional — with “aṣ-ṣalātu khayrun min an-nawm”)</span><br><span class="muted small" data-source="fajr">Checking…</span></div>
        <div class="actions">
          <label class="btn">Choose file<input type="file" accept="audio/*" data-upload="fajr" hidden></label>
          <button class="btn" data-remove="fajr" hidden>Remove</button>
        </div>
      </div>
    </div>
    <div class="hero-actions">
      <button class="btn" data-preview="full">▶ Full</button>
      <button class="btn" data-preview="short">▶ First part</button>
      <button class="btn" data-preview="stop">■ Stop</button>
    </div>
    <p class="muted small">Your own file is saved on this device and works offline. Like other notifications, the adhan plays while the app is open or was recently in use; phones may silence web apps that have been closed.</p>`;
}

async function refreshAdhanSources(root) {
  const voice = store.get().adhan.voice;
  // Own files
  for (const kind of ['regular', 'fajr']) {
    const el = $(`[data-source="${kind}"]`, root);
    if (!el) continue;
    const src = await adhan.describeSource(kind, 'custom');
    const own = src?.custom && src.kind === kind;
    el.textContent = own ? `Saved: ${src.label}` : kind === 'fajr' ? 'Not set — the regular adhan is used for Fajr' : 'No file chosen';
    $(`[data-remove="${kind}"]`, root).hidden = !own;
  }
  // Menu of built-in voices + "my own recording"
  const list = $('#voice-list', root);
  if (!list) return;
  const voices = await adhan.loadCatalog();
  const active = (await adhan.describeSource('regular', voice))?.voice ?? voice;
  const ownSaved = !!(await adhan.describeSource('regular', 'custom'))?.custom;
  const row = (id, title, sub, extra = '') => `
    <label class="voice ${active === id ? 'on' : ''}">
      <input type="radio" name="adhan-voice" value="${esc(id)}" ${active === id ? 'checked' : ''}>
      <span class="voice-text"><strong>${esc(title)}</strong>${sub ? `<br><span class="muted small">${sub}</span>` : ''}</span>
      ${extra}
    </label>`;
  list.innerHTML =
    voices
      .map((v) =>
        row(
          v.id,
          v.name,
          [esc(v.origin || ''), v.fajrFile ? 'includes Fajr adhan' : '', v.credit ? `Source: ${esc(v.credit)}${v.license ? ` · ${esc(v.license)}` : ''}` : ''].filter(Boolean).join(' · '),
          `<button type="button" class="icon-btn" data-voice-preview="${esc(v.id)}" aria-label="Preview ${esc(v.name)}">▶</button>`,
        ),
      )
      .join('') +
    row('custom', 'My own recording', ownSaved ? 'Uses the file(s) below' : 'Choose an audio file below') +
    (voices.length ? '' : '<p class="muted small">No built-in recordings are included in this copy of the app yet — choose your own file below.</p>');
  $('#own-recordings', root).hidden = voices.length > 0 && active !== 'custom';
}

function bindAdhan(root) {
  if (!$('[data-sec="adhan"]', root)) return;
  refreshAdhanSources(root);
  $$('input[name="adhan-mode"]', root).forEach((el) => {
    el.onchange = () => {
      store.update((st) => (st.adhan.mode = el.value));
      toast(`Adhan: ${adhan.ADHAN_MODES[el.value]}`);
      // Update the "Default (…)" labels without losing scroll position.
      $$('[data-adhan-prayer] option[value="default"]', root).forEach((o) => (o.textContent = `Default (${SHORT_MODE[el.value]})`));
    };
  });
  $$('[data-adhan]', root).forEach((el) => {
    el.onchange = () => store.update((st) => (st.adhan[el.dataset.adhan] = +el.value));
  });
  $$('[data-adhan-prayer]', root).forEach((el) => {
    el.onchange = () =>
      store.update((st) => {
        st.adhan.perPrayer = { ...st.adhan.perPrayer, [el.dataset.adhanPrayer]: el.value };
      });
  });
  $('#voice-list', root).addEventListener('change', async (e) => {
    if (e.target.name !== 'adhan-voice') return;
    const id = e.target.value;
    store.update((st) => (st.adhan.voice = id));
    if (id !== 'custom') {
      const v = (await adhan.loadCatalog()).find((x) => x.id === id);
      if (v) adhan.warm(v); // keep a copy for offline use
      toast(`Muezzin: ${v?.name || id}`);
    }
    refreshAdhanSources(root);
  });
  $('#voice-list', root).addEventListener('click', async (e) => {
    const id = e.target.closest('[data-voice-preview]')?.dataset.voicePreview;
    if (!id) return;
    e.preventDefault();
    const st = store.get().adhan;
    if (adhan.nowPlaying()?.src.voice === id) return adhan.stop();
    const r = await adhan.play('dhuhr', { mode: 'short', shortSeconds: st.shortSeconds, volume: st.volume, voice: id, title: 'Adhan preview' });
    if (r.status !== 'playing') toast('Could not play this recording');
  });
  $$('[data-upload]', root).forEach((el) => {
    el.onchange = async () => {
      const file = el.files[0];
      el.value = '';
      if (!file) return;
      if (file.type && !file.type.startsWith('audio/')) return toast('Please choose an audio file');
      if (file.size > MAX_AUDIO_MB * 1048576) return toast(`File is too large (max ${MAX_AUDIO_MB} MB)`);
      try {
        await putFile(adhan.MEDIA_KEYS[el.dataset.upload], file);
        store.update((st) => (st.adhan.voice = 'custom'));
        toast(`Saved “${file.name}”`);
      } catch {
        toast('Could not save the file on this device');
      }
      refreshAdhanSources(root);
    };
  });
  $$('[data-remove]', root).forEach((el) => {
    el.onclick = async () => {
      await deleteFile(adhan.MEDIA_KEYS[el.dataset.remove]).catch(() => {});
      toast('Recording removed');
      refreshAdhanSources(root);
    };
  });
  $$('[data-preview]', root).forEach((el) => {
    el.onclick = async () => {
      if (el.dataset.preview === 'stop') return adhan.stop();
      const st = store.get().adhan;
      const r = await adhan.play('dhuhr', { mode: el.dataset.preview, shortSeconds: st.shortSeconds, volume: st.volume, voice: st.voice, title: 'Adhan preview' });
      if (r.status === 'nosource') toast('Choose an adhan audio file first');
      else if (r.status === 'blocked') toast('Your browser blocked audio — tap again');
    };
  });
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

  ${s.traditions.includes('islam') ? section('adhan', '🕌 Adhan (call to prayer)', adhanSection(s.adhan)) : ''}

  ${section('display', '🎨 Display', `
    <label class="field">Clock <select id="clock">
      <option value="" ${s.clock24 == null ? 'selected' : ''}>Follow device</option>
      <option value="24" ${s.clock24 === true ? 'selected' : ''}>24-hour</option>
      <option value="12" ${s.clock24 === false ? 'selected' : ''}>12-hour</option>
    </select></label>
  `)}

  ${section('data', '💾 Back up & restore', `
    <p class="muted small">Your settings, history, counters and own adhan recordings are stored only on this phone. Save a backup to keep them safe or move them to a new phone.</p>
    <p class="backup-status ${s.lastBackup ? '' : 'warn'}">${s.lastBackup ? `Last backup: ${esc(new Date(s.lastBackup).toLocaleString())}` : 'No backup saved yet'}</p>
    <button class="btn primary block" id="backup-save">⬇ Save backup</button>
    <p class="muted small">${backupHint()}</p>
    <label class="switch small" id="backup-media-row" hidden><input type="checkbox" id="backup-media" ${includeMedia ? 'checked' : ''}><span>Include my own adhan recordings (bigger file)</span></label>
    <div class="hero-actions">
      <label class="btn">⬆ Restore from file<input type="file" id="restore" hidden></label>
      <button class="btn" id="backup-copy">Copy as text</button>
    </div>
    <details class="restore-text">
      <summary class="small">Restore from copied text</summary>
      <textarea id="restore-text" rows="4" placeholder="Paste the backup text here"></textarea>
      <button class="btn" id="restore-text-btn">Restore</button>
    </details>
    <details class="keep-tips">
      <summary class="small">How to keep your data safe</summary>
      ${backup.keepDataTips()}
    </details>
    ${backup.hasUndo() ? '<button class="link-btn" id="restore-undo">Undo last restore</button><br>' : ''}
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

  bindAdhan(root);

  $('#clock', root).onchange = (e) => store.update((st) => (st.clock24 = e.target.value === '' ? null : e.target.value === '24'));

  bindBackup(root, nav);
  $('#reset', root).onclick = () => {
    if (confirm('Delete all settings, checklists and history on this device?')) {
      store.reset();
      location.reload();
    }
  };
}
