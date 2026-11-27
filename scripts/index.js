import {
  db,
  byId as $,
  getUser,
  isAdmin,
  logout,
  players,
  scores,
  rounds,
  slots,
  positions,
  salaryCap,
  el,
  money,
  result,
  busy,
  report,
  onError,
} from './common.js';
import { createDraft, scoreIndex } from './draft.js';

const draft = createDraft();
const catalog = new Map(),
  cards = new Map();
let user,
  editId = null,
  settings,
  catalogLoad,
  draftLoad,
  savePending = false,
  scoreLoad,
  standingsLoad;
let requestId = crypto.randomUUID(),
  currentView = '';
const views = new Set(['draft-team-view', 'player-scores-view', 'standings-view', 'rules-view']);
const alertBox = $('alert-modal'),
  promptBox = $('prompt-modal'),
  drawer = $('roster-drawer');
function message(title, body) {
  $('alert-modal-title').textContent = title;
  $('alert-modal-message').textContent = body;
  alertBox.showModal();
}
function menu(open) {
  $('mobile-menu').classList.toggle('open', open);
  $('mobile-menu').inert = !open;
  $('mobile-menu-btn').setAttribute('aria-expanded', String(open));
}
function readyCatalog() {
  return (catalogLoad ||= players()
    .then((list) => {
      for (const player of list) catalog.set(player.id, player);
      return list;
    })
    .catch((error) => {
      catalogLoad = null;
      throw error;
    }));
}
function renderCard(player) {
  const card = el('button', 'player-card group');
  card.type = 'button';
  card.dataset.playerId = player.id;
  const left = el('span', 'card-left'),
    photo = el('span', 'relative w-[42px] h-[42px] shrink-0');
  const initial = el(
    'span',
    'player-avatar player-fallback-initial is-visible',
    player.name.charAt(0),
  );
  initial.setAttribute('aria-hidden', 'true');
  photo.append(initial);
  let image;
  try {
    image = new URL(player.image_url);
  } catch {}
  if (!image && /^[a-z0-9-]+$/i.test(player.espn_id || '')) {
    image = new URL(
      'https://a.espncdn.com/i/' +
        (player.position === 'DST' ? 'teamlogos/nfl/500/' : 'headshots/nfl/players/full/') +
        player.espn_id +
        '.png',
    );
  }
  if (image?.origin === 'https://a.espncdn.com') {
    const img = el('img', 'player-avatar absolute inset-0');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.width = 42;
    img.height = 42;
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = image.href;
    photo.append(img);
  }
  const info = el('span', 'flex flex-col min-w-0');
  info.append(
    el('span', 'text-sm font-bold text-white truncate', player.name),
    el('span', 'text-xs text-slate-400', player.position + ' · ' + player.team),
  );
  left.append(photo, info);
  card.append(left, el('span', 'font-mono text-sm text-brand', money(player.salary)));
  cards.set(player.id, card);
  return card;
}
function renderCatalog() {
  const groups = document.createDocumentFragment(),
    nav = el('div', 'position-nav-container container mx-auto');
  for (const position of positions) {
    const list = [...catalog.values()]
      .filter((p) => p.position === position)
      .sort((a, b) => b.salary - a.salary || a.id - b.id);
    if (!list.length) continue;
    const section = el('section', 'position-group mb-6');
    section.id = 'section-' + position;
    const grid = el('div', 'player-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3');
    grid.id = 'group-' + position;
    const head = el('h2', 'mb-3');
    const toggle = el(
      'button',
      'text-xl font-black uppercase italic text-brand py-2 w-full text-left',
      position,
    );
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', grid.id);
    toggle.setAttribute('aria-expanded', 'true');
    toggle.onclick = () => {
      grid.hidden = !grid.hidden;
      toggle.setAttribute('aria-expanded', String(!grid.hidden));
    };
    head.append(toggle);
    grid.append(...list.map(renderCard));
    section.append(head, grid);
    groups.append(section);
    const chip = el('button', 'pos-chip', position);
    chip.onclick = () => section.scrollIntoView();
    nav.append(chip);
  }
  $('player-pool-container').replaceChildren(groups);
  $('sub-header').replaceChildren(nav);
}
function slotRow(slot) {
  const row = el('div', 'flex justify-between items-center p-2 bg-surface-800 rounded');
  const p = draft.roster.get(slot);
  row.append(
    el('span', 'text-xs text-slate-400 w-9', slot),
    el('span', 'grow font-bold text-sm', p?.name || 'Empty'),
  );
  if (p) {
    const remove = el('button', 'text-slate-300 px-2', '×');
    remove.type = 'button';
    remove.dataset.slot = slot;
    remove.setAttribute('aria-label', 'Remove ' + p.name + ' from ' + slot);
    row.append(el('span', 'text-xs text-brand', money(p.salary)), remove);
  }
  return row;
}
function refreshDraft() {
  const used = draft.used(),
    spent = used.reduce((total, p) => total + p.salary, 0);
  const ids = new Set(used.map((p) => p.id));
  for (const id of ['remaining-salary', 'mobile-remaining-salary'])
    $(id).textContent = money(salaryCap - spent);
  for (const id of ['roster-count', 'mobile-roster-count']) $(id).textContent = used.length;
  $('spent-amount').textContent = money(spent);
  $('mobile-drawer-spent').textContent = money(spent) + ' / ' + money(salaryCap);
  for (const id of ['salary-progress-bar', 'mobile-drawer-progress'])
    $(id).style.width = Math.min((spent / salaryCap) * 100, 100) + '%';
  for (const id of ['submit-team-button', 'mobile-submit-btn'])
    $(id).disabled = used.length !== slots.length || settings.entries_locked || savePending;
  for (const id of ['roster-slots-container', 'mobile-roster-container'])
    $(id).replaceChildren(...slots.map(slotRow));
  for (const [id, card] of cards) {
    const picked = ids.has(id);
    card.disabled = picked || !draft.eligibleSlot(catalog.get(id)) || settings.entries_locked;
    card.classList.toggle('player-drafted', picked);
    card.classList.toggle('player-unavailable', !picked && card.disabled);
  }
}
async function loadDraft() {
  await readyCatalog();
  const id = new URLSearchParams(location.search).get('edit_team_id');
  if (id) {
    const data = result(
      await db()
        .from('user_teams')
        .select('id,team_name,team_players(roster_slot,player_id)')
        .eq('user_id', user.id)
        .eq('id', id)
        .single(),
    );
    for (const entry of data.team_players) {
      if (!slots.includes(entry.roster_slot) || !catalog.has(entry.player_id))
        throw new Error('This roster needs a catalog review before editing.');
    }
    for (const entry of data.team_players)
      draft.roster.set(entry.roster_slot, catalog.get(entry.player_id));
    editId = data.id;
    $('prompt-modal-input').value = data.team_name;
    $('submit-team-button').textContent = 'Update team';
    $('mobile-submit-btn').textContent = 'Update';
  }
  renderCatalog();
  refreshDraft();
  if (settings.entries_locked) report('Entries are locked.');
}
async function saveTeam() {
  if (savePending || draft.roster.size !== slots.length) return;
  const name = $('prompt-modal-input').value.trim();
  if (!name) {
    $('prompt-modal-input').focus();
    return;
  }
  const editing = editId !== null;
  savePending = true;
  $('prompt-modal-confirm-btn').disabled = true;
  try {
    const id = result(
      await db().rpc('save_roster', {
        p_team_id: editId,
        p_team_name: name,
        p_request_id: requestId,
        p_roster: slots.map((slot) => ({
          player_id: draft.roster.get(slot).id,
          roster_slot: slot,
        })),
      }),
    );
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error('The save could not be confirmed. Retry this draft.');
    if (promptBox.open) promptBox.close();
    if (editing) {
      location.assign('my-teams.html');
      return;
    }
    draft.roster.clear();
    requestId = crypto.randomUUID();
    $('prompt-modal-input').value = '';
    scoreLoad = standingsLoad = null;
    message('Team submitted', 'Your entry has been saved.');
  } catch (error) {
    const field = $('prompt-modal-error');
    field.classList.remove('hidden');
    field.textContent = error.message || 'Save failed. Your draft is still here.';
  } finally {
    savePending = false;
    $('prompt-modal-confirm-btn').disabled = false;
    refreshDraft();
  }
}
async function loadScores() {
  const [catalogRows, scoreRows, ownership] = await Promise.all([
    readyCatalog(),
    scores(),
    settings.show_ownership ? db().rpc('get_player_ownership').then(result) : [],
  ]);
  const stats = scoreIndex(scoreRows),
    pct = new Map(ownership.map((p) => [p.player_id, p.percent]));
  const fragment = document.createDocumentFragment();
  for (const pos of positions) {
    const list = catalogRows
      .filter((p) => p.position === pos)
      .sort((a, b) => (stats.get(b.id)?.total || 0) - (stats.get(a.id)?.total || 0));
    if (!list.length) continue;
    const block = el('section', 'overflow-x-auto');
    block.append(el('h3', 'text-lg font-bold text-brand', pos));
    const table = el('table', 'w-full text-left text-xs md:text-sm');
    const header = table.createTHead().insertRow();
    for (const h of ['Player', ...(settings.show_ownership ? ['Own %'] : []), ...rounds, 'Total'])
      header.append(el('th', 'p-2', h));
    const body = table.createTBody();
    for (const p of list) {
      const value = stats.get(p.id) || { total: 0 },
        row = body.insertRow();
      for (const text of [
        p.name + ' · ' + p.team,
        ...(settings.show_ownership ? [(pct.get(p.id) || 0) + '%'] : []),
        ...rounds.map((r) => value[r] ?? '—'),
        value.total.toFixed(1),
      ])
        row.append(el('td', 'p-2 border-t border-white/5', text));
    }
    block.append(table);
    fragment.append(block);
  }
  $('player-scores-list').replaceChildren(fragment);
}
async function loadStandings() {
  const teams = result(await db().rpc('get_standings'));
  const body = $('standings-table').tBodies[0];
  body.replaceChildren();
  for (const team of teams) {
    const row = body.insertRow();
    row.append(
      el('td', 'p-4 font-mono', '#' + team.rank),
      el('td', 'p-4 font-bold', team.team_name),
      el('td', 'p-4 text-brand text-right', Number(team.total_points).toFixed(1)),
    );
  }
  if (!teams.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 3;
    cell.textContent = 'No entries yet.';
  }
}
async function selectView() {
  const requested = location.hash.slice(1);
  const view = views.has(requested) ? requested : 'draft-team-view';
  currentView = view;
  for (const id of views) $(id).classList.toggle('active', id === view);
  for (const link of document.querySelectorAll('.nav-link,.mobile-nav-link')) {
    const active = link.hash === '#' + view;
    link.classList.toggle('active', active);
    link.classList.toggle('text-brand', active);
    link.classList.toggle('text-gray-400', !active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('sub-header').hidden = $('mobile-draft-footer').hidden = view !== 'draft-team-view';
  $('page-status').hidden = true;
  menu(false);
  try {
    if (view === 'draft-team-view')
      await (draftLoad ||= loadDraft().catch((e) => {
        draftLoad = null;
        throw e;
      }));
    if (view === 'player-scores-view')
      await (scoreLoad ||= loadScores().catch((e) => {
        scoreLoad = null;
        throw e;
      }));
    if (view === 'standings-view')
      await (standingsLoad ||= loadStandings().catch((e) => {
        standingsLoad = null;
        throw e;
      }));
  } catch (error) {
    if (currentView === view) {
      report(error);
      const b = el('button', 'ml-3 underline', 'Retry');
      b.onclick = selectView;
      $('page-status').append(b);
    }
  }
}
async function start() {
  busy(true);
  try {
    user = await getUser();
    if (!user) return;
    settings = result(
      await db().from('app_settings').select('entries_locked,show_ownership').eq('id', 1).single(),
    );
    $('login-button').hidden = true;
    $('user-profile-section').classList.replace('hidden', 'flex');
    $('user-email-display').textContent = user.email;
    isAdmin()
      .then((value) => {
        if (value)
          for (const id of ['nav-admin', 'mobile-nav-admin']) $(id).classList.remove('hidden');
      })
      .catch(report);
    $('mobile-menu-btn').onclick = () => menu($('mobile-menu').inert);
    for (const id of ['logout-button', 'mobile-logout']) $(id).onclick = onError(logout);
    $('player-pool-container').onclick = (e) => {
      const id = e.target.closest('button[data-player-id]')?.dataset.playerId;
      if (id && draft.add(catalog.get(Number(id)))) refreshDraft();
    };
    for (const id of ['roster-slots-container', 'mobile-roster-container'])
      $(id).onclick = (e) => {
        const slot = e.target.closest('button[data-slot]')?.dataset.slot;
        if (slot) {
          draft.roster.delete(slot);
          refreshDraft();
        }
      };
    for (const id of ['submit-team-button', 'mobile-submit-btn'])
      $(id).onclick = () => {
        if (drawer.open) drawer.close();
        $('prompt-modal-error').classList.add('hidden');
        promptBox.showModal();
        $('prompt-modal-input').focus();
      };
    $('prompt-modal-cancel-btn').onclick = () => promptBox.close();
    $('prompt-modal-confirm-btn').onclick = onError(saveTeam);
    $('prompt-modal-input').onkeydown = (e) => {
      if (e.key === 'Enter') void saveTeam();
    };
    $('alert-modal-close-btn').onclick = () => alertBox.close();
    $('open-roster-drawer').onclick = () => drawer.showModal();
    $('close-roster-drawer').onclick = () => drawer.close();
    for (const link of document.querySelectorAll('.mobile-nav-link'))
      link.addEventListener('click', () => menu(false));
    window.addEventListener('hashchange', selectView);
    await selectView();
  } finally {
    busy(false);
  }
}
onError(start)();
