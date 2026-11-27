import {
  db,
  byId as $,
  el,
  busy,
  getUser,
  isAdmin,
  logout,
  money,
  slots,
  result,
  onError,
  report,
} from './common.js';

const container = $('my-teams-container'),
  confirmBox = $('confirm-modal');
let user,
  deleting = null,
  locked;
function render(team, index) {
  const block = el('article', 'glass-panel rounded-xl p-4'),
    header = el('header', 'flex items-center gap-3 flex-wrap');
  const details = el('div', 'pt-3');
  details.id = 'entries-' + team.id;
  details.hidden = index > 0;
  const open = el('button', 'font-bold text-lg text-left grow', team.team_name);
  open.setAttribute('aria-controls', details.id);
  open.setAttribute('aria-expanded', String(!details.hidden));
  open.onclick = () => {
    details.hidden = !details.hidden;
    open.setAttribute('aria-expanded', String(!details.hidden));
  };
  const edit = el('a', 'text-brand underline', 'Edit');
  edit.href = 'index.html?edit_team_id=' + encodeURIComponent(team.id);
  const remove = el('button', 'text-red-300 underline', 'Delete');
  remove.onclick = () => {
    deleting = team.id;
    $('confirm-modal-title').textContent = 'Delete ' + team.team_name + '?';
    confirmBox.showModal();
    $('confirm-modal-cancel-btn').focus();
  };
  const roster = [...team.team_players].sort(
    (a, b) => slots.indexOf(a.roster_slot) - slots.indexOf(b.roster_slot),
  );
  const salary = roster.reduce((sum, tp) => sum + Number(tp.players?.salary || 0), 0);
  header.append(open, el('span', 'text-sm text-brand', money(salary)));
  if (!locked) header.append(edit, remove);
  for (const { players: p, roster_slot } of roster) {
    const row = el('div', 'flex justify-between gap-2 py-2 border-t border-white/5 text-sm');
    row.append(
      el('span', 'w-10 text-slate-400', roster_slot),
      el('span', 'grow', p?.name ?? 'Unknown player'),
      el('span', 'text-slate-400', p?.team ?? ''),
      el('span', 'text-brand', money(p?.salary ?? 0)),
    );
    details.append(row);
  }
  block.append(header, details);
  return block;
}
async function load() {
  const teams = result(
    await db()
      .from('user_teams')
      .select('id,team_name,created_at,team_players(roster_slot,players(name,team,salary))')
      .eq('user_id', user.id)
      .order('created_at'),
  );
  container.replaceChildren(...teams.map(render));
  $('no-teams-message').classList.toggle('hidden', teams.length > 0);
}
async function deleteTeam() {
  if (!deleting) return;
  const id = deleting;
  deleting = null;
  confirmBox.close();
  busy(true);
  try {
    result(
      await db()
        .from('user_teams')
        .delete()
        .eq('user_id', user.id)
        .eq('id', id)
        .select('id')
        .single(),
    );
    await load();
  } finally {
    busy(false);
  }
}
async function start() {
  busy(true);
  try {
    user = await getUser();
    if (!user) return;
    $('logout-button').onclick = onError(logout);
    $('login-button').hidden = true;
    $('user-profile-section').classList.replace('hidden', 'flex');
    $('user-email-display').textContent = user.email;
    isAdmin()
      .then((admin) => {
        if (admin) $('nav-admin').classList.remove('hidden');
      })
      .catch(report);
    locked = result(
      await db().from('app_settings').select('entries_locked').eq('id', 1).single(),
    ).entries_locked;
    $('confirm-modal-confirm-btn').onclick = onError(deleteTeam);
    $('confirm-modal-cancel-btn').onclick = () => confirmBox.close();
    await load();
  } finally {
    busy(false);
  }
}
onError(start)();
