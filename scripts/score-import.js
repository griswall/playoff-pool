import Papa from 'papaparse';
import { parsePoints } from './points.js';

const rounds = ['WC', 'DIV', 'CONF', 'SB'];
export function parseScoreFile(text, catalog) {
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error(parsed.errors[0].message);
  const [first, ...lines] = parsed.data;
  if (!first) throw new Error('CSV is empty.');
  const header = first.map((x) => x.trim());
  if (new Set(header).size !== header.length) throw new Error('Each header must appear once.');
  const idColumn = header.indexOf('Player ID'),
    nameColumn = header.indexOf('Player Name');
  if ((idColumn < 0 && nameColumn < 0) || rounds.some((round) => !header.includes(round)))
    throw new Error('Include Player ID or Player Name and WC, DIV, CONF, SB.');
  const ids = new Map(catalog.map((p) => [String(p.id), p]));
  const names = new Map();
  for (const player of catalog) {
    const name = player.name.trim();
    names.set(name, names.has(name) ? null : player);
  }
  const updates = [],
    seen = new Set();
  for (const [index, cells] of lines.entries()) {
    const row = index + 2;
    if (cells.length !== header.length)
      throw new Error('CSV row ' + row + ' has the wrong number of columns.');
    const id = cells[idColumn]?.trim(),
      name = cells[nameColumn]?.trim();
    const player = id ? ids.get(id) : names.get(name);
    if (!player || (name && id && player.name.trim() !== name))
      throw new Error(
        'Row ' +
          row +
          ': unknown, ambiguous or mismatched player. Use Player ID for duplicate names.',
      );
    for (const round of rounds) {
      const raw = cells[header.indexOf(round)].trim();
      if (raw === '') continue;
      let points;
      try {
        points = parsePoints(raw);
      } catch (error) {
        throw new Error('Row ' + row + ', ' + round + '. ' + error.message);
      }
      const key = player.id + ':' + round;
      if (seen.has(key))
        throw new Error(
          'Row ' + row + ' repeats a score for ' + player.name + ' in ' + round + '.',
        );
      seen.add(key);
      updates.push({
        player_id_to_update: player.id,
        round_to_update: round,
        points_to_update: points,
      });
    }
  }
  if (!updates.length) throw new Error('CSV has no score changes.');
  return updates;
}
