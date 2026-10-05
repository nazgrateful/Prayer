import * as store from '../store.js';
import { $, esc, today, toast } from '../core.js';
import { addDays, dateKey, weekKey, monthKey } from '../tz.js';
import { DEFAULT_CHECKLISTS } from '../content.js';

export const PERIODS = {
  daily: { label: 'Daily', keyOf: dateKey, step: (d, n) => addDays(d, n), history: 7 },
  weekly: { label: 'Weekly', keyOf: weekKey, step: (d, n) => addDays(d, 7 * n), history: 6 },
  monthly: {
    label: 'Monthly',
    keyOf: monthKey,
    step: (d, n) => {
      const m = new Date(Date.UTC(d.year, d.month - 1 + n, 1));
      return { year: m.getUTCFullYear(), month: m.getUTCMonth() + 1, day: 1 };
    },
    history: 6,
  },
};

let period = 'daily';

export function periodTitle(p, d) {
  if (p === 'daily') return new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
  if (p === 'weekly') return `Week ${weekKey(d).split('-W')[1]}`;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(d.year, d.month - 1, 1)));
}

/** Items from the default lists of the selected traditions that the user doesn't have yet. */
export function suggestions(p, traditions, existing) {
  const have = new Set(existing.map((i) => i.text.toLowerCase()));
  const out = [];
  for (const t of traditions) for (const text of DEFAULT_CHECKLISTS[t]?.[p] || []) if (!have.has(text.toLowerCase())) out.push({ text, tradition: t });
  return out;
}

export function seedChecklists(state) {
  for (const p of Object.keys(PERIODS)) {
    for (const s of suggestions(p, state.traditions, state.checklists[p])) state.checklists[p].push({ id: store.uid(), ...s });
  }
}

export function render(root) {
  const s = store.get();
  const P = PERIODS[period];
  const d = today();
  const ck = `${period}:${P.keyOf(d)}`;
  const items = s.checklists[period];
  const checks = s.checks[ck] || {};
  const done = items.filter((i) => checks[i.id]).length;
  const sugg = suggestions(period, s.traditions, items);
  const hist = [];
  for (let i = P.history - 1; i >= 0; i--) {
    const pd = P.step(d, -i);
    const c = s.checks[`${period}:${P.keyOf(pd)}`] || {};
    const n = items.filter((it) => c[it.id]).length;
    hist.push({ label: P.keyOf(pd), frac: items.length ? n / items.length : 0, current: i === 0 });
  }

  root.innerHTML = `
  <div class="segmented" role="tablist">
    ${Object.entries(PERIODS)
      .map(([k, v]) => `<button role="tab" aria-selected="${k === period}" class="${k === period ? 'on' : ''}" data-period="${k}">${v.label}</button>`)
      .join('')}
  </div>
  <section class="card">
    <div class="card-head">
      <div><span class="eyebrow">${P.label} checklist</span><h3>${esc(periodTitle(period, d))}</h3></div>
      <strong class="big-num">${done}/${items.length}</strong>
    </div>
    <div class="progress"><span style="width:${items.length ? (100 * done) / items.length : 0}%"></span></div>
    <ul class="checklist">
      ${items
        .map(
          (i) => `<li data-id="${i.id}" class="${checks[i.id] ? 'done' : ''}">
          <button class="check ${checks[i.id] ? 'on' : ''}" data-act="toggle" aria-pressed="${!!checks[i.id]}" aria-label="Toggle ${esc(i.text)}">${checks[i.id] ? '✓' : ''}</button>
          <span class="item-text">${esc(i.text)}</span>
          <button class="icon-btn" data-act="del" aria-label="Delete ${esc(i.text)}" title="Delete">✕</button>
        </li>`,
        )
        .join('') || '<li class="muted">Nothing here yet — add your first item below.</li>'}
    </ul>
    <form class="add-form" id="add-form">
      <input id="new-item" placeholder="Add a ${P.label.toLowerCase()} goal…" maxlength="120" autocomplete="off">
      <button class="btn primary">Add</button>
    </form>
  </section>

  <section class="card">
    <span class="eyebrow">History</span>
    <div class="history">
      ${hist.map((h) => `<div class="hist ${h.current ? 'current' : ''}" title="${h.label}: ${Math.round(h.frac * 100)}%"><span style="height:${Math.max(4, h.frac * 100)}%"></span></div>`).join('')}
    </div>
    <p class="muted small">Completion over the last ${P.history} ${period === 'daily' ? 'days' : period === 'weekly' ? 'weeks' : 'months'}. Checklists reset automatically at the start of each ${period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'}.</p>
  </section>

  ${sugg.length ? `<section class="card">
    <span class="eyebrow">Suggestions for your traditions</span>
    <div class="chips left">${sugg.map((x, n) => `<button class="chip" data-sugg="${n}">＋ ${esc(x.text)}</button>`).join('')}</div>
  </section>` : ''}
  `;

  root.onclick = (e) => {
    const per = e.target.closest('[data-period]')?.dataset.period;
    if (per) {
      period = per;
      return render(root);
    }
    const sIdx = e.target.closest('[data-sugg]')?.dataset.sugg;
    if (sIdx != null) {
      store.update((st) => st.checklists[period].push({ id: store.uid(), ...sugg[+sIdx] }));
      return render(root);
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!act || !id) return;
    if (act === 'toggle') {
      store.update((st) => {
        const c = (st.checks[ck] = st.checks[ck] || {});
        c[id] = !c[id];
        const all = st.checklists[period].every((i) => c[i.id]);
        if (all && c[id]) toast('All done — well done! 🌟');
      });
    } else if (act === 'del') {
      store.update((st) => {
        st.checklists[period] = st.checklists[period].filter((i) => i.id !== id);
      });
    }
    render(root);
  };

  $('#add-form', root).onsubmit = (e) => {
    e.preventDefault();
    const text = $('#new-item', root).value.trim();
    if (!text) return;
    store.update((st) => st.checklists[period].push({ id: store.uid(), text }));
    render(root);
    $('#new-item', root).focus();
  };
}
