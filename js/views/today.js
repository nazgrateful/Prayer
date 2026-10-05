import * as store from '../store.js';
import { $, esc, fmt, tradition, scheduleFor, upcoming, current, quoteOfDay, today, dateLine, toast, relative, intentionSuggestion } from '../core.js';
import { addDays, dateKey, formatDuration } from '../tz.js';
import { startTimerFor } from './timer.js';

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
  return () => clearInterval(tick);
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
