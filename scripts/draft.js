import { rounds, slots, salaryCap } from './common.js';
const flex = ['RB', 'WR', 'TE'];
export function createDraft() {
  const roster = new Map();
  const used = () => [...roster.values()];
  function eligibleSlot(player) {
    const selected = used();
    if (
      selected.some((p) => p.id === player.id) ||
      selected.filter((p) => p.team === player.team).length >= 3 ||
      selected.reduce((s, p) => s + p.salary, 0) + player.salary > salaryCap
    )
      return null;
    return slots.find(
      (slot) =>
        !roster.has(slot) &&
        (slot.replace(/[0-9]/g, '') === player.position ||
          (slot === 'FLEX' && flex.includes(player.position))),
    );
  }
  function add(player) {
    const target = eligibleSlot(player);
    if (target) roster.set(target, player);
    return Boolean(target);
  }
  return { roster, eligibleSlot, add, used };
}
export function scoreIndex(records) {
  const map = new Map();
  for (const { player_id, points, playoff_round } of records) {
    const totals = map.get(player_id) || { total: 0 };
    if (rounds.includes(playoff_round) && points !== null) {
      totals[playoff_round] = Number(points);
      totals.total += Number(points);
    }
    map.set(player_id, totals);
  }
  return map;
}
