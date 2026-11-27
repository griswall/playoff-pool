import { db, byId as $, busy, el, rows, requireAdmin, result, onError, report } from './common.js';
import { parseScoreFile } from './score-import.js';

let catalog = [],
  preview = [],
  generation = 0,
  pending = false;
const save = $('upload-btn'),
  input = $('file-input'),
  area = $('file-drop-area'),
  log = $('log-box');
function clear() {
  preview = [];
  save.disabled = true;
  $('preview').replaceChildren();
  $('file-name').textContent = '';
}
async function select(file) {
  if (pending) return;
  const current = ++generation;
  clear();
  log.textContent = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose a CSV smaller than 2 MB.');
  const text = await file.text();
  if (current !== generation) return;
  const updates = parseScoreFile(text, catalog),
    names = new Map(catalog.map((p) => [p.id, p.name]));
  const table = el('table', 'w-full text-sm text-left');
  const header = table.createTHead().insertRow();
  for (const title of ['Player ID', 'Player', 'Round', 'Points'])
    header.append(el('th', 'p-1', title));
  const body = table.createTBody();
  for (const u of updates) {
    const row = body.insertRow();
    for (const text of [
      u.player_id_to_update,
      names.get(u.player_id_to_update),
      u.round_to_update,
      u.points_to_update,
    ])
      row.append(el('td', 'p-1', text));
  }
  $('preview').append(table);
  preview = updates;
  $('file-name').textContent = file.name;
  save.disabled = false;
  log.textContent = updates.length + ' scores ready for review.';
}
async function upload() {
  if (pending || !preview.length) return;
  pending = true;
  save.disabled = true;
  input.disabled = true;
  try {
    result(await db().rpc('bulk_upsert_player_scores', { scores_to_update: preview }));
    log.textContent = 'Saved ' + preview.length + ' scores.';
    input.value = '';
    clear();
  } finally {
    pending = false;
    input.disabled = false;
    save.disabled = !preview.length;
  }
}
async function start() {
  busy(true);
  try {
    if (!(await requireAdmin())) return;
    catalog = await rows('players', 'id,name', ['id']);
    input.onchange = onError(() => select(input.files[0]));
    area.ondragover = (e) => e.preventDefault();
    area.ondrop = (e) => {
      e.preventDefault();
      select(e.dataTransfer.files[0]).catch(report);
    };
    save.onclick = onError(upload);
    log.textContent = 'Choose a CSV to preview.';
  } finally {
    busy(false);
  }
}
onError(start)();
