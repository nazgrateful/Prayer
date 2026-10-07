// Remembrance counter: tasbīḥ, rosary, prayer rope, mala/japa… with a
// separate count, target and history for every phrase.

import * as store from '../store.js';
import { $, esc, today, toast, tradition } from '../core.js';
import { dateKey, addDays } from '../tz.js';
import { dhikrFor } from '../content.js';
import { chime } from '../notify.js';

const TARGETS = [1, 3, 10, 19, 21, 33, 34, 40, 95, 99, 100, 108];
const FREE = { key: 'free', id: 'free', tradition: 'custom', text: 'Free count', meaning: 'Count anything', target: 33 };
let showAdd = false;

/** All phrases available to this user, in display order. */
export function phrases(s = store.get()) {
  const own = s.dhikr.custom.map((c) => ({ ...c, key: `custom.${c.id}`, tradition: 'custom' }));
  return [...dhikrFor(s.traditions), ...own, FREE];
}

const targetOf = (s, p) => s.dhikr.targets[p.key] || p.target || 33;

export function render(box) {
  const s = store.get();
  const list = phrases(s);
  const p = list.find((x) => x.key === s.dhikr.active) || list[0];
  const dk = dateKey(today());
  const target = targetOf(s, p);
  const round = s.dhikr.round[p.key] || 0;
  const todayN = s.dhikr.log[dk]?.[p.key] || 0;
  const total = s.dhikr.totals[p.key] || 0;
  const todayAll = Object.entries(s.dhikr.log[dk] || {}).filter(([, n]) => n > 0);
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const k = dateKey(addDays(today(), -i));
    week.push({ k, n: Object.values(s.dhikr.log[k] || {}).reduce((a, b) => a + b, 0) });
  }
  const maxWeek = Math.max(1, ...week.map((w) => w.n));
  const name = (x) => x.translit || x.text;

  box.innerHTML = `
    <span class="eyebrow">Remembrance counter · dhikr · rosary · japa · simran</span>
    <div class="chips left scroll-x" role="listbox" aria-label="Phrase">
      ${list
        .map(
          (x) => `<button class="chip ${x.key === p.key ? 'on' : ''}" data-phrase="${esc(x.key)}" role="option" aria-selected="${x.key === p.key}" title="${esc(x.meaning || '')}">${x.tradition !== 'custom' ? `${tradition(x.tradition).symbol} ` : ''}${esc(name(x).length > 28 ? name(x).slice(0, 26) + '…' : name(x))}</button>`,
        )
        .join('')}
      <button class="chip" data-act="add" aria-label="Add your own phrase">＋ Add</button>
    </div>

    ${showAdd ? `<form class="grid-form" id="dhikr-add">
      <label class="span2">Phrase <input name="text" required maxlength="200" placeholder="e.g. Yā Raḥmān, Maranatha, Om Shanti"></label>
      <label>Meaning (optional) <input name="meaning" maxlength="120"></label>
      <label>Target <input name="target" type="number" min="1" max="10000" value="33"></label>
      <button class="btn primary span2">Add phrase</button>
    </form>` : ''}

    <div class="dhikr-phrase">
      <div class="dhikr-text" dir="auto">${esc(p.text)}</div>
      ${p.translit && p.translit !== p.text ? `<div class="dhikr-translit">${esc(p.translit)}</div>` : ''}
      ${p.meaning ? `<div class="muted small">${esc(p.meaning)}</div>` : ''}
    </div>

    <button class="counter-btn" id="dhikr-tap" aria-label="Count ${esc(name(p))}">
      <span id="dhikr-round">${round}</span>
      <small>of ${target}</small>
    </button>

    <div class="dhikr-stats">
      <div><strong id="dhikr-today">${todayN.toLocaleString()}</strong><span>today</span></div>
      <div><strong id="dhikr-rounds">${Math.floor(todayN / target)}</strong><span>rounds today</span></div>
      <div><strong id="dhikr-total">${total.toLocaleString()}</strong><span>all time</span></div>
    </div>

    <div class="hero-actions">
      <button class="btn" data-act="undo">−1</button>
      <button class="btn" data-act="reset">Reset round</button>
      <label class="btn">Target
        <select data-act="target" aria-label="Target">
          ${[...new Set([...TARGETS, target])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === target ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
    </div>
    <label class="switch small"><input type="checkbox" data-act="auto" ${s.dhikr.autoAdvance ? 'checked' : ''}><span>Go to the next phrase when a round is complete (e.g. 33 · 33 · 34 after prayer)</span></label>
    ${p.tradition === 'custom' && p.key !== 'free' ? '<button class="link-btn danger" data-act="delete">Delete this phrase</button>' : ''}

    ${todayAll.length ? `<h4>Today</h4>
    <ul class="simple-list">
      ${todayAll
        .map(([k, n]) => {
          const x = list.find((y) => y.key === k);
          return `<li class="spread"><span>${x ? esc(name(x)) : '<span class="muted">Deleted phrase</span>'}</span><strong>${n.toLocaleString()}</strong></li>`;
        })
        .join('')}
    </ul>` : ''}
    <h4>Last 7 days</h4>
    <div class="history small-hist">
      ${week.map((w) => `<div class="hist ${w.k === dk ? 'current' : ''}" title="${w.k}: ${w.n}"><span style="height:${Math.max(4, (100 * w.n) / maxWeek)}%"></span></div>`).join('')}
    </div>`;

  const paint = () => {
    const st = store.get();
    const r = st.dhikr.round[p.key] || 0;
    const t = st.dhikr.log[dk]?.[p.key] || 0;
    $('#dhikr-round', box).textContent = String(r);
    $('#dhikr-today', box).textContent = t.toLocaleString();
    $('#dhikr-rounds', box).textContent = String(Math.floor(t / target));
    $('#dhikr-total', box).textContent = (st.dhikr.totals[p.key] || 0).toLocaleString();
  };

  const count = (n) => {
    let completed = false;
    store.update((st) => {
      const d = st.dhikr;
      const cur = d.round[p.key] || 0;
      if (n < 0 && cur === 0) return; // nothing to undo in this round
      d.round[p.key] = cur + n;
      d.log[dk] = d.log[dk] || {};
      d.log[dk][p.key] = Math.max(0, (d.log[dk][p.key] || 0) + n);
      d.totals[p.key] = Math.max(0, (d.totals[p.key] || 0) + n);
      if (d.round[p.key] >= target) {
        d.round[p.key] = 0;
        completed = true;
      }
    });
    if (n > 0) navigator.vibrate?.(completed ? [80, 60, 80] : 12);
    if (!completed) return paint();
    chime(1);
    const st = store.get();
    const same = list.filter((x) => x.tradition === p.tradition && x.key !== 'free');
    const next = same[same.indexOf(p) + 1];
    if (st.dhikr.autoAdvance && next) {
      store.update((s2) => (s2.dhikr.active = next.key));
      toast(`${target} × ${name(p)} ✓ — next: ${name(next)}`);
      render(box);
    } else {
      toast(`Round complete — ${target} × ${name(p)} ✓`);
      paint();
    }
  };

  box.onclick = (e) => {
    const key = e.target.closest('[data-phrase]')?.dataset.phrase;
    if (key) {
      store.update((st) => (st.dhikr.active = key));
      return render(box);
    }
    if (e.target.closest('#dhikr-tap')) return count(1);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'undo') count(-1);
    else if (act === 'reset') {
      store.update((st) => (st.dhikr.round[p.key] = 0));
      paint();
    } else if (act === 'add') {
      showAdd = !showAdd;
      render(box);
      $('#dhikr-add input', box)?.focus();
    } else if (act === 'delete' && confirm(`Delete “${p.text}”? Counts already made stay in your daily history.`)) {
      store.update((st) => {
        st.dhikr.custom = st.dhikr.custom.filter((c) => `custom.${c.id}` !== p.key);
        st.dhikr.active = 'free';
      });
      render(box);
    }
  };
  box.onchange = (e) => {
    const act = e.target.dataset.act;
    if (act === 'target') {
      store.update((st) => (st.dhikr.targets[p.key] = +e.target.value));
      render(box);
    } else if (act === 'auto') store.update((st) => (st.dhikr.autoAdvance = e.target.checked));
  };
  const form = $('#dhikr-add', box);
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const id = store.uid();
      store.update((st) => {
        st.dhikr.custom.push({ id, text: f.text.trim(), meaning: f.meaning.trim(), target: Math.min(10000, Math.max(1, Math.round(+f.target || 33))) });
        st.dhikr.active = `custom.${id}`;
      });
      showAdd = false;
      render(box);
    };
}
