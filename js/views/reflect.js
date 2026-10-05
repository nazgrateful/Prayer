import * as store from '../store.js';
import { $, esc, tradition, scheduleFor, upcoming, today, toast, fmt } from '../core.js';
import { dateKey } from '../tz.js';
import { intentionsFor, QUOTES } from '../content.js';
import { TRADITIONS } from '../traditions.js';

let target = null; // { prayerKey, dateKey }
let filter = 'mine';

export function render(root, nav, params) {
  if (params?.prayerKey) target = params;
  const s = store.get();
  const d = today();
  const dk = dateKey(d);
  const todays = scheduleFor(d).items.filter((p) => p.enabled && !p.marker);
  if (!target) {
    const n = upcoming(1)[0];
    target = n ? { prayerKey: n.key, dateKey: n.dateKey } : todays[0] ? { prayerKey: todays[0].key, dateKey: dk } : null;
  }
  const options = [...todays.map((p) => ({ ...p, dateKey: dk }))];
  for (const u of upcoming(6)) if (!options.some((o) => o.key === u.key && o.dateKey === u.dateKey)) options.push(u);
  const sel = target && options.find((o) => o.key === target.prayerKey && o.dateKey === target.dateKey);
  const currentText = sel ? s.intentions[sel.dateKey]?.[sel.key] || '' : '';
  const suggestions = intentionsFor(s.traditions);
  const todaysIntentions = Object.entries(s.intentions[dk] || {}).filter(([, v]) => v);

  const traditionFilters = [['mine', 'My traditions'], ['saved', '★ Saved'], ...Object.values(TRADITIONS).map((t) => [t.id, `${t.symbol} ${t.name}`])];
  let quotes;
  if (filter === 'mine') quotes = s.traditions.flatMap((t) => (QUOTES[t] || []).map((q) => ({ ...q, tradition: t })));
  else if (filter === 'saved') quotes = Object.entries(QUOTES).flatMap(([t, l]) => l.filter((q) => s.favorites.includes(q.ref)).map((q) => ({ ...q, tradition: t })));
  else quotes = (QUOTES[filter] || []).map((q) => ({ ...q, tradition: filter }));

  root.innerHTML = `
  <section class="card">
    <span class="eyebrow">Intention</span>
    ${options.length ? `
    <label class="field">For
      <select id="target">
        ${options.map((o) => `<option value="${esc(o.key)}|${o.dateKey}" ${sel && o.key === sel.key && o.dateKey === sel.dateKey ? 'selected' : ''}>${esc(o.name)} · ${fmt(o.time)}${o.dateKey !== dk ? ' (tomorrow)' : ''}</option>`).join('')}
      </select>
    </label>
    <textarea id="intent-text" rows="3" maxlength="300" placeholder="What are you holding in prayer?">${esc(currentText)}</textarea>
    <div class="hero-actions"><button class="btn" id="clear">Clear</button><button class="btn primary" id="save">Save intention</button></div>
    <p class="muted small">Tap a suggestion to use it:</p>
    <div class="chips left">${suggestions.map((x, i) => `<button class="chip" data-sugg="${i}">${esc(x)}</button>`).join('')}</div>
    ` : '<p class="muted">Choose a location and tradition in Settings to set intentions for your prayers.</p>'}
  </section>

  ${todaysIntentions.length ? `<section class="card">
    <span class="eyebrow">Today’s intentions</span>
    <ul class="simple-list">
      ${todaysIntentions.map(([k, v]) => {
        const p = todays.find((x) => x.key === k);
        return `<li><strong>${esc(p?.name || k)}</strong> — ${esc(v)}</li>`;
      }).join('')}
    </ul>
  </section>` : ''}

  <section class="card">
    <span class="eyebrow">Scripture & wisdom</span>
    <div class="chips left scroll-x">
      ${traditionFilters.map(([id, label]) => `<button class="chip ${filter === id ? 'on' : ''}" data-filter="${id}">${esc(label)}</button>`).join('')}
    </div>
    <ul class="quote-list">
      ${quotes.map((q) => `<li style="--accent:${tradition(q.tradition).color}">
        <blockquote>“${esc(q.text)}”</blockquote>
        <div class="quote-foot"><cite>— ${esc(q.ref)}</cite>
          <button class="icon-btn" data-fav="${esc(q.ref)}" aria-label="Save quote">${s.favorites.includes(q.ref) ? '★' : '☆'}</button></div>
      </li>`).join('') || `<li class="muted">${filter === 'saved' ? 'Tap ☆ on a quote to save it here.' : 'No quotes.'}</li>`}
    </ul>
    <p class="muted small">Translations are public-domain (KJV, JPS 1917, Pickthall, Müller) or plain-English renderings of well-known passages.</p>
  </section>`;

  const textEl = $('#intent-text', root);
  root.onclick = (e) => {
    const f = e.target.closest('[data-filter]')?.dataset.filter;
    if (f) {
      filter = f;
      return render(root, nav);
    }
    const fav = e.target.closest('[data-fav]')?.dataset.fav;
    if (fav) {
      store.update((st) => {
        st.favorites = st.favorites.includes(fav) ? st.favorites.filter((r) => r !== fav) : [...st.favorites, fav];
      });
      return render(root, nav);
    }
    const sg = e.target.closest('[data-sugg]')?.dataset.sugg;
    if (sg != null && textEl) {
      textEl.value = suggestions[+sg];
      textEl.focus();
      return;
    }
    const id = e.target.closest('button')?.id;
    if ((id === 'save' || id === 'clear') && sel) {
      const v = id === 'clear' ? '' : textEl.value.trim();
      store.update((st) => {
        st.intentions[sel.dateKey] = st.intentions[sel.dateKey] || {};
        st.intentions[sel.dateKey][sel.key] = v;
      });
      toast(v ? `Intention saved for ${sel.name}` : 'Intention cleared');
      render(root, nav);
    }
  };
  const targetEl = $('#target', root);
  if (targetEl)
    targetEl.onchange = (e) => {
      const [prayerKey, dKey] = e.target.value.split('|');
      target = { prayerKey, dateKey: dKey };
      render(root, nav);
    };
}
