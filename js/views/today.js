import * as store from '../store.js';
import { $, esc, fmt, tradition, scheduleFor, upcoming, current, quoteOfDay, today, dateLine, toast, relative, intentionSuggestion } from '../core.js';
import { addDays, dateKey, formatDuration } from '../tz.js';
import { startTimerFor } from './timer.js';
import { qiblaBearing, qiblaDistance, compassPoint, watchHeading } from '../qibla.js';

let stopCompass = null;

let dayOffset = 0;
let showHidden = false;
let quoteSalt = '';

export function render(root, nav) {
  const s = store.get();
  const date = addDays(today(), dayOffset);
  const key = dateKey(date);
  const { items, polar } = scheduleFor(date);
  const visible = items.filter((p) => p.enabled || showHidden);
  const hiddenCount = items.length - items.filter((p) => p.enabled).length;
  const prayed = s.prayed[key] || {};
  const countable = items.filter((p) => p.enabled && !p.marker);
  const done = countable.filter((p) => prayed[p.key]).length;
  const now = new Date();
  const next = upcoming(1)[0];
  const cur = current();
  const q = quoteOfDay(date, quoteSalt);
  const fav = s.favorites.includes(q?.ref);

  root.innerHTML = `
    ${dayOffset === 0 && next ? heroCard(next, cur) : ''}
    ${s.traditions.includes('islam') && s.location ? qiblaCard(s.location) : ''}

    <section class="card quote-card" style="--accent:${tradition(q?.tradition).color}">
      <div class="card-head">
        <span class="eyebrow">${esc(tradition(q?.tradition).book)} · reflection</span>
        <div class="row-actions">
          <button class="icon-btn" data-act="fav" aria-label="Save quote" title="Save">${fav ? '★' : '☆'}</button>
          <button class="icon-btn" data-act="share" aria-label="Copy or share quote" title="Share">⤴</button>
          <button class="icon-btn" data-act="another" aria-label="Another quote" title="Another">↻</button>
        </div>
      </div>
      <blockquote>“${esc(q?.text)}”</blockquote>
      <cite>— ${esc(q?.ref)}</cite>
    </section>

    <section class="card">
      <div class="day-nav">
        <button class="icon-btn" data-act="prev" aria-label="Previous day">‹</button>
        <div class="day-title">
          <strong>${dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Tomorrow' : dayOffset === -1 ? 'Yesterday' : ''}</strong>
          <span>${esc(dateLine(date))}</span>
        </div>
        <button class="icon-btn" data-act="next" aria-label="Next day">›</button>
      </div>
      ${countable.length ? `<div class="progress" title="${done} of ${countable.length} prayed"><span style="width:${(100 * done) / countable.length}%"></span></div>
      <p class="muted small center">${done} of ${countable.length} prayers completed${dayOffset ? '' : ' today'}</p>` : ''}
      ${polar ? `<p class="note">You are in a polar region where the sun does not rise or set today. Times are approximated around solar noon — adjust them in Settings if your community follows a different rule.</p>` : ''}
      <ul class="prayer-list">
        ${visible.map((p) => prayerRow(p, prayed[p.key], now, s.intentions[key]?.[p.key])).join('') || '<li class="muted">No prayers selected — choose a tradition in Settings.</li>'}
      </ul>
      ${hiddenCount ? `<button class="link-btn" data-act="hidden">${showHidden ? 'Hide' : 'Show'} ${hiddenCount} optional / hidden ${hiddenCount === 1 ? 'prayer' : 'prayers'}</button>` : ''}
    </section>
  `;

  root.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const pkey = btn.closest('[data-key]')?.dataset.key;
    const item = btn.closest('.hero') ? next : items.find((p) => p.key === pkey);
    if (act === 'prev') dayOffset--;
    else if (act === 'next') dayOffset++;
    else if (act === 'hidden') showHidden = !showHidden;
    else if (act === 'another') quoteSalt = String(Math.random());
    else if (act === 'fav') {
      store.update((st) => {
        st.favorites = fav ? st.favorites.filter((r) => r !== q.ref) : [...st.favorites, q.ref];
      });
    } else if (act === 'share') {
      shareQuote(q);
      return;
    } else if (act === 'prayed') {
      store.update((st) => {
        st.prayed[key] = st.prayed[key] || {};
        st.prayed[key][pkey] = !st.prayed[key][pkey];
      });
    } else if (act === 'bell') {
      store.update((st) => {
        const pref = (st.prefs[pkey] = st.prefs[pkey] || {});
        pref.notify = !(pref.notify ?? true);
      });
      toast(store.get().prefs[pkey].notify ? 'Reminder on' : 'Reminder off');
    } else if (act === 'timer' && item) {
      startTimerFor(item);
      nav('timer');
      return;
    } else if (act === 'intent' && item) {
      nav('reflect', { prayerKey: item.key, dateKey: item.dateKey || key });
      return;
    } else if (act === 'compass') {
      toggleCompass(root);
      return;
    } else if (act === 'enable') {
      store.update((st) => {
        st.prefs[pkey] = { ...(st.prefs[pkey] || {}), enabled: true };
      });
    }
    render(root, nav);
  };

  // live countdown
  const tick = setInterval(() => {
    const el = $('#countdown', root);
    if (!el || !next) return;
    const ms = next.time - Date.now();
    if (ms <= 0) return render(root, nav);
    el.textContent = formatDuration(ms);
  }, 1000);
  if (stopCompass) paintCompass(root); // keep the live needle after re-renders
  return () => {
    clearInterval(tick);
    stopCompass?.();
    stopCompass = null;
  };
}

let heading = null;

function qiblaCard(loc) {
  const b = qiblaBearing(loc.lat, loc.lng);
  const km = qiblaDistance(loc.lat, loc.lng);
  const dist = km < 1 ? 'You are at the Kaʿbah' : `${Math.round(km).toLocaleString()} km to Makkah`;
  return `
  <section class="card qibla" style="--accent:#2f9e6e" data-bearing="${b}">
    <div class="qibla-dial" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" class="dial-ring"/>
        <g class="dial-rose">
          <text x="50" y="13" text-anchor="middle">N</text><text x="89" y="54" text-anchor="middle">E</text>
          <text x="50" y="95" text-anchor="middle">S</text><text x="11" y="54" text-anchor="middle">W</text>
        </g>
        <g class="dial-needle" style="transform: rotate(${b}deg)">
          <line x1="50" y1="50" x2="50" y2="16"/><text x="50" y="14" text-anchor="middle" class="kaaba">🕋</text>
        </g>
        <circle cx="50" cy="50" r="3" class="dial-hub"/>
      </svg>
    </div>
    <div class="qibla-info">
      <span class="eyebrow">🕋 Qibla</span>
      <div class="qibla-deg">${b.toFixed(1)}° <small>${compassPoint(b)}</small></div>
      <div class="muted small">from true north · ${esc(dist)}</div>
      <div class="muted small" id="qibla-live">${stopCompass ? 'Turn until 🕋 points straight up' : ''}</div>
      <button class="btn" data-act="compass">${stopCompass ? 'Stop compass' : '🧭 Use compass'}</button>
    </div>
  </section>`;
}

function paintCompass(root) {
  const card = $('.qibla', root);
  if (!card) return;
  const b = +card.dataset.bearing;
  const rose = $('.dial-rose', card);
  const needle = $('.dial-needle', card);
  if (heading == null) return;
  // Rotate the dial so it matches the real world; the needle then points at the Qibla.
  rose.style.transform = `rotate(${-heading}deg)`;
  needle.style.transform = `rotate(${b - heading}deg)`;
  const off = ((b - heading + 540) % 360) - 180;
  const live = $('#qibla-live', card);
  live.textContent = Math.abs(off) <= 5 ? '✓ Facing the Qibla' : `Turn ${off > 0 ? 'right' : 'left'} ${Math.round(Math.abs(off))}°`;
  card.classList.toggle('aligned', Math.abs(off) <= 5);
}

async function toggleCompass(root) {
  if (stopCompass) {
    stopCompass();
    stopCompass = null;
    heading = null;
    const btn = $('.qibla [data-act=compass]', root);
    if (btn) btn.textContent = '🧭 Use compass';
    $('.qibla .dial-rose', root).style.transform = '';
    $('.qibla .dial-needle', root).style.transform = `rotate(${$('.qibla', root).dataset.bearing}deg)`;
    $('#qibla-live', root).textContent = '';
    $('.qibla', root).classList.remove('aligned');
    return;
  }
  try {
    stopCompass = await watchHeading((h) => {
      heading = h;
      paintCompass(root);
    });
    $('.qibla [data-act=compass]', root).textContent = 'Stop compass';
    $('#qibla-live', root).textContent = 'Hold your phone flat… keep it away from metal and magnets';
  } catch (e) {
    toast(e.message || 'Compass not available — use the bearing shown');
  }
}

function heroCard(next, cur) {
  const t = tradition(next.tradition);
  const s = store.get();
  const intention = s.intentions[next.dateKey]?.[next.key];
  return `
  <section class="card hero" style="--accent:${t.color}" data-key="${esc(next.key)}">
    ${cur ? `<p class="now-line">Now: <strong>${esc(cur.name)}</strong>${cur.end ? ` · until ${fmt(cur.end)}` : ''}</p>` : ''}
    <span class="eyebrow">${t.symbol} Next · ${esc(t.name)}</span>
    <h2>${esc(next.name)}</h2>
    <div class="hero-time">${fmt(next.time)}</div>
    <div class="countdown" id="countdown" aria-live="off">${formatDuration(next.time - Date.now())}</div>
    <p class="intention-line">${intention ? `Intention: <em>${esc(intention)}</em>` : `Suggested intention: <em>${esc(intentionSuggestion(next.key + next.dateKey))}</em>`}</p>
    <div class="hero-actions">
      <button class="btn" data-act="intent">✎ Intention</button>
      <button class="btn primary" data-act="timer">⏱ ${next.duration} min timer</button>
    </div>
  </section>`;
}

function prayerRow(p, isPrayed, now, intention) {
  const t = tradition(p.tradition);
  const past = p.time && p.time < now;
  const notify = (store.get().prefs[p.key]?.notify ?? true) && p.enabled && !p.marker;
  const nowActive = p.time && p.time <= now && now < (p.end || new Date(p.time.getTime() + p.duration * 60000));
  return `
  <li class="prayer ${past ? 'past' : ''} ${nowActive ? 'active' : ''} ${p.marker ? 'marker' : ''} ${p.enabled ? '' : 'disabled'}" data-key="${esc(p.key)}" style="--accent:${t.color}">
    ${p.marker ? '<span class="check placeholder"></span>' : `<button class="check ${isPrayed ? 'on' : ''}" data-act="prayed" aria-pressed="${!!isPrayed}" aria-label="Mark ${esc(p.name)} as prayed">${isPrayed ? '✓' : ''}</button>`}
    <div class="prayer-main">
      <div class="prayer-name"><span class="dot" title="${esc(t.name)}">${t.symbol}</span> ${esc(p.name)}${nowActive ? ' <span class="badge">now</span>' : ''}</div>
      <div class="prayer-desc">${esc(p.desc || '')}${p.end ? ` · until ${fmt(p.end)}` : ''}</div>
      ${intention ? `<div class="prayer-intent">✎ ${esc(intention)}</div>` : ''}
    </div>
    <div class="prayer-time">${fmt(p.time)}${!past && p.time ? `<small>${relative(p.time - now)}</small>` : ''}</div>
    <div class="row-actions">
      ${!p.enabled ? '<button class="icon-btn" data-act="enable" title="Show this prayer">＋</button>' : p.marker ? '' : `
      <button class="icon-btn" data-act="bell" title="Toggle reminder" aria-label="Toggle reminder">${notify ? '🔔' : '🔕'}</button>
      <button class="icon-btn" data-act="timer" title="Start prayer timer" aria-label="Start timer">⏱</button>`}
    </div>
  </li>`;
}

async function shareQuote(q) {
  const text = `“${q.text}” — ${q.ref}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Quote copied');
    }
  } catch {
    /* user cancelled */
  }
}

export function resetDay() {
  dayOffset = 0;
}
