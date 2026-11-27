import {
  db,
  byId as $,
  busy,
  requireAdmin,
  rows,
  scores,
  rounds,
  el,
  result,
  onError,
  report,
} from './common.js';

import { parsePoints } from './points.js';

const table = $('scores-table-body'),
  save = $('save-scores-btn'),
  baseline = new Map(),
  dirty = new Map();
let saving = false;
function refreshButton() {
  save.disabled = saving || !dirty.size;
  save.textContent = dirty.size
    ? 'Save ' + dirty.size + ' change' + (dirty.size === 1 ? '' : 's')
    : 'Save changes';
}
function track(input) {
  const { playerId, round } = input.dataset,
    key = playerId + ':' + round;
  input.setCustomValidity('');
  if (input.value !== '') {
    try {
      parsePoints(input.value);
    } catch (error) {
      input.setCustomValidity(error.message);
    }
  }
  if (!input.validity.valid) {
    dirty.set(key, { input, invalid: true });
    refreshButton();
    return;
  }
  const value = input.value === '' ? null : input.valueAsNumber;
  if (value === baseline.get(key)) dirty.delete(key);
  else dirty.set(key, { input, value });
  refreshButton();
}
async function saveScores() {
  if (!dirty.size || saving) return;
  const entries = [...dirty];
  const bad = entries.find(([, v]) => v.invalid);
  if (bad) {
    bad[1].input.reportValidity();
    return;
  }
  saving = true;
  refreshButton();
  busy(true);
  try {
    const values = entries.map(([, v]) => ({
      player_id_to_update: Number(v.input.dataset.playerId),
      round_to_update: v.input.dataset.round,
      points_to_update: v.value,
    }));
    result(await db().rpc('bulk_upsert_player_scores', { scores_to_update: values }));
    for (const [key, { input, value }] of entries) {
      baseline.set(key, value);
      track(input);
    }
    report('Saved ' + entries.length + ' score changes.');
  } finally {
    saving = false;
    refreshButton();
    busy(false);
  }
}
async function start() {
  busy(true);
  save.disabled = true;
  try {
    if (!(await requireAdmin())) return;
    const [people, points] = await Promise.all([
      rows('players', 'id,name,position,team', ['id']),
      scores(),
    ]);
    for (const x of points)
      baseline.set(
        x.player_id + ':' + x.playoff_round,
        x.points === null ? null : Number(x.points),
      );
    const fragment = document.createDocumentFragment();
    for (const p of people.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)) {
      const row = el('tr', 'border-b border-white/5'),
        name = el('td', 'p-2 text-white');
      name.append(
        el('strong', 'block', p.name),
        el('span', 'text-xs text-slate-400', p.position + ' · ' + p.team + ' · #' + p.id),
      );
      row.append(name);
      for (const round of rounds) {
        const key = p.id + ':' + round;
        if (!baseline.has(key)) baseline.set(key, null);
        const input = el('input', 'score-input w-20 p-2 text-sm');
        input.type = 'number';
        input.step = '0.01';
        input.min = '-999.99';
        input.max = '999.99';
        input.placeholder = '—';
        input.dataset.playerId = p.id;
        input.dataset.round = round;
        input.setAttribute('aria-label', p.name + ' ' + p.team + ' ' + round);
        input.value = baseline.get(key) ?? '';
        row.insertCell().append(input);
      }
      fragment.append(row);
    }
    table.replaceChildren(fragment);
    table.oninput = (e) => {
      if (e.target.matches('input[data-round]')) track(e.target);
    };
    save.onclick = onError(saveScores);
  } finally {
    busy(false);
  }
}
onError(start)();
