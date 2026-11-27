import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScoreFile } from '../scripts/score-import.js';
const people = [
  { id: 1, name: 'One, Name' },
  { id: 2, name: 'Same' },
  { id: 3, name: 'Same' },
];
test('quoted names, zero corrections, negative decimals, blanks', () => {
  const values = parseScoreFile('Player Name,WC,DIV,CONF,SB\r\n"One, Name",0,-2.25,,\r\n', people);
  assert.deepEqual(
    values.map((v) => [v.player_id_to_update, v.round_to_update, v.points_to_update]),
    [
      [1, 'WC', 0],
      [1, 'DIV', -2.25],
    ],
  );
});
test('rejects the whole file on malformed, unknown, duplicate, or mismatched values', () => {
  for (const [head, row] of [
    ['Player ID', '1,10oops,,,'],
    ['Player ID', '1,4.015,,,'],
    ['Player ID', '1,-1000,,,'],
    ['Player ID', '99,1,,,'],
    ['Player Name', 'Same,1,,,'],
    ['Player ID,Player Name', '1,Other,3,,,'],
    ['Player ID', '1,0,,,\n1,9,,,'],
    ['Player ID', '1,,,,'],
  ]) {
    assert.throws(() => parseScoreFile(head + ',WC,DIV,CONF,SB\n' + row, people));
  }
});
test('stable player ID disambiguates duplicate names', () => {
  const values = parseScoreFile('Player ID,Player Name,WC,DIV,CONF,SB\n2,Same,,,2.5,', people);
  assert.equal(values[0].player_id_to_update, 2);
});
