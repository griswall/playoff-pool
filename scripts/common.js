import { createClient } from '@supabase/supabase-js';

const config = __POOL_CONFIG__;
let client;
export const rounds = ['WC', 'DIV', 'CONF', 'SB'];
export const slots = ['QB', 'RB1', 'RB2', 'RB3', 'WR1', 'WR2', 'WR3', 'FLEX', 'DST', 'K'];
export const positions = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];
export const salaryCap = 38500000;
export const byId = (id) => document.getElementById(id);
export const money = (value) =>
  '$' +
  (Number(value) / 1000000).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3,
  }) +
  'M';

export function db() {
  if (config.allowedHost && location.hostname !== config.allowedHost) {
    throw new Error(
      'This preview needs its own Supabase project. The league is available at ' +
        config.allowedHost +
        '.',
    );
  }
  return (client ||= createClient(config.url, config.key));
}
export function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
export function result(response) {
  if (response.error) throw response.error;
  return response.data;
}
export async function getUser() {
  const session = result(await db().auth.getSession()).session;
  if (!session) {
    location.replace('login.html');
    return null;
  }
  return session.user;
}
export async function isAdmin() {
  return result(await db().rpc('is_admin_user')) === true;
}
export async function requireAdmin() {
  if (!(await getUser())) return false;
  if (!(await isAdmin())) {
    location.replace('index.html');
    return false;
  }
  return true;
}
export async function rows(table, columns, order) {
  const size = 500,
    all = [];
  for (let offset = 0; ; ) {
    let query = db().from(table).select(columns);
    for (const field of order) query = query.order(field);
    const batch = result(await query.range(offset, offset + size - 1));
    all.push(...batch);
    if (batch.length < size) return all;
    offset += batch.length;
  }
}
export const players = () =>
  rows('players', 'id,name,team,position,salary,espn_id,image_url', ['id']);
export const scores = () =>
  rows('player_scores', 'player_id,playoff_round,points', ['player_id', 'playoff_round']);
export function busy(value) {
  const overlay = byId('loading-overlay');
  if (overlay) {
    overlay.hidden = !value;
    overlay.classList.remove('hidden');
    overlay.classList.toggle('active', value);
  }
}
export function report(error) {
  const box = byId('page-status');
  if (box) {
    box.hidden = false;
    box.textContent = error?.message || String(error);
  }
}
export function onError(fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch(report);
}
export async function logout() {
  result(await db().auth.signOut());
  location.replace('login.html');
}
