import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/core.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL, Intl });
vm.runInContext(`${source}\nglobalThis.Core = TargetListCore;`, context);
const Core = context.Core;

// Fix the clock so freshness and live-status boundaries are reproducible.
const NOW = Date.parse('2026-10-09T12:00:00Z');
const player = {
  id: 12345,
  name: 'Chain Player',
  faction: { id: 111, name: 'Allowed Faction' },
  battleStats: { total: 1_000_000 },
};
function target(overrides = {}) {
  return {
    id: 98765,
    name: 'Chain Target',
    faction: { id: 222, name: 'Target Faction' },
    estimatedStats: 500_000,
    estimateUpdatedAt: NOW / 1000 - 3600,
    status: { state: 'Okay' },
    checkedAt: new Date(NOW - 1000).toISOString(),
    notes: 'Chain candidate',
    ...overrides,
  };
}

test('recommendations apply the chosen ratio and include its exact boundary', () => {
  const atLimit = Core.assess(target({ estimatedStats: 600_000 }), player, 0.6, NOW);
  assert.equal(atLimit.ratio, 0.6);
  assert.equal(atLimit.suggested, true);
  assert.equal(atLimit.label, 'Possible match');

  const aboveLimit = Core.assess(target({ estimatedStats: 600_001 }), player, 0.6, NOW);
  assert.equal(aboveLimit.suggested, false);
  assert.equal(aboveLimit.label, 'Above your limit');
  assert.equal(Core.assess(target(), player, 0.4, NOW).suggested, false);
  assert.equal(Core.assess(target(), player, undefined, NOW).suggested, true);
});

test('missing, zero, negative, nonnumeric, and nonfinite estimates remain unknown', () => {
  for (const value of [undefined, null, 0, -1, '500000', NaN, Infinity, -Infinity]) {
    const assessment = Core.assess(target({ estimatedStats: value }), player, 0.6, NOW);
    assert.equal(assessment.ratio, null, `ratio for ${String(value)}`);
    assert.equal(assessment.suggested, false, `suggestion for ${String(value)}`);
    assert.equal(assessment.label, 'Stats unknown');
  }
});

test('invalid player totals cannot make targets look safe', () => {
  for (const total of [undefined, null, 0, -1, '1000000', NaN, Infinity]) {
    const assessment = Core.assess(target(), { ...player, battleStats: { total } }, 0.6, NOW);
    assert.equal(assessment.ratio, null);
    assert.equal(assessment.suggested, false);
  }
});

test('estimates expire after seven days and reject missing or implausibly future dates', () => {
  const boundary = NOW / 1000 - Core.ESTIMATE_MAX_AGE;
  assert.equal(Core.assess(target({ estimateUpdatedAt: boundary }), player, 0.6, NOW).fresh, true);
  const expired = Core.assess(target({ estimateUpdatedAt: boundary - 1 }), player, 0.6, NOW);
  assert.equal(expired.fresh, false);
  assert.equal(expired.suggested, false);
  assert.equal(expired.label, 'Estimate needs refresh');

  for (const stamp of [undefined, null, 0, -1, '2026-10-09', NaN, Infinity, NOW / 1000 + 301]) {
    const assessment = Core.assess(target({ estimateUpdatedAt: stamp }), player, 0.6, NOW);
    assert.equal(assessment.fresh, false, `freshness for ${String(stamp)}`);
    assert.equal(assessment.suggested, false);
  }
  assert.equal(Core.assess(target({ estimateUpdatedAt: NOW / 1000 + 300 }), player, 0.6, NOW).fresh, true);
});

test('Ready requires an Okay status checked less than one minute ago', () => {
  assert.equal(Core.assess(target(), player, 0.6, NOW).ready, true);
  const nearlyExpired = new Date(NOW - Core.LIVE_STATUS_MAX_AGE + 1).toISOString();
  assert.equal(Core.assess(target({ checkedAt: nearlyExpired }), player, 0.6, NOW).ready, true);

  for (const checkedAt of [undefined, null, '', 'invalid', new Date(NOW - Core.LIVE_STATUS_MAX_AGE).toISOString(), new Date(NOW + 5001).toISOString()]) {
    const assessment = Core.assess(target({ checkedAt }), player, 0.6, NOW);
    assert.equal(assessment.live, false, `live status for ${String(checkedAt)}`);
    assert.equal(assessment.ready, false);
  }
  for (const state of [undefined, 'Hospital', 'Traveling', 'Jail', 'okay']) {
    assert.equal(Core.assess(target({ status: { state } }), player, 0.6, NOW).ready, false);
  }
  assert.equal(Core.assess(target({ status: undefined }), player, 0.6, NOW).ready, false);
});

test('a cached Okay label without a fresh live check never means Ready', () => {
  const assessment = Core.assess(target({ checkedAt: undefined }), player, 0.6, NOW);
  assert.equal(assessment.suggested, true);
  assert.equal(assessment.live, false);
  assert.equal(assessment.ready, false);
});

test('self and faction allies cannot be recommended or Ready', () => {
  for (const friendly of [target({ id: player.id }), target({ faction: { id: player.faction.id, name: 'Ally' } })]) {
    const assessment = Core.assess(friendly, player, 0.6, NOW);
    assert.equal(assessment.suggested, false);
    assert.equal(assessment.ready, false);
    assert.equal(assessment.label, 'Friendly / self');
  }
  assert.equal(Core.assess(target({ faction: null }), player, 0.6, NOW).suggested, true);
});

test('the full list keeps unknown, stale, hard, and friendly entries visible', () => {
  const targets = [
    target({ id: 1 }),
    target({ id: 2, estimatedStats: null }),
    target({ id: 3, estimateUpdatedAt: NOW / 1000 - Core.ESTIMATE_MAX_AGE - 1 }),
    target({ id: 4, estimatedStats: 2_000_000 }),
    target({ id: player.id }),
  ];
  const result = Core.select(targets, player, {}, NOW);
  assert.equal(result.length, targets.length);
  assert.deepEqual([...result.map(item => item.target.id)].sort((a, b) => a - b), targets.map(item => item.id).sort((a, b) => a - b));
  assert.equal(result[0].target.id, 1);
  const suggested = Core.select(targets, player, { mode: 'suggested' }, NOW);
  assert.deepEqual([...suggested.map(item => item.target.id)], [1]);
});

test('search covers player id, name, faction, and notes with case-insensitive matching', () => {
  const targets = [target({ id: 999, name: 'Target Name', faction: { id: 222, name: 'Blue Ravens' }, notes: 'Weekend chains' })];
  for (const query of ['999', ' TARGET NAME ', 'ravens', 'WEEKEND']) {
    assert.equal(Core.select(targets, player, { query }, NOW).length, 1);
  }
  assert.equal(Core.select(targets, player, { query: 'unmatched' }, NOW).length, 0);
  assert.equal(Core.select(targets, player, { mode: 'suggested', query: '999', maxRatio: 0.4 }, NOW).length, 0);
});

test('ranking puts suggestions first, then ratio, and deterministically breaks ties by id', () => {
  const targets = [
    target({ id: 5, estimatedStats: null }),
    target({ id: 4, estimatedStats: 700_000 }),
    target({ id: 3, estimatedStats: 100_000, estimateUpdatedAt: 1 }),
    target({ id: 2, estimatedStats: 500_000 }),
    target({ id: 1, estimatedStats: 500_000 }),
    target({ id: 6, estimatedStats: 200_000 }),
  ];
  const result = Core.select(targets, player, {}, NOW);
  assert.deepEqual([...result.map(item => item.target.id)], [6, 1, 2, 3, 4, 5]);
  assert.deepEqual(targets.map(item => item.id), [5, 4, 3, 2, 1, 6], 'selection does not reorder the source list');
});

test('service addresses require HTTPS except for local development and reject credentials or URL parameters', () => {
  assert.equal(Core.serviceUrl('https://targets.example/api/'), 'https://targets.example/api');
  assert.equal(Core.serviceUrl('http://localhost:8787/'), 'http://localhost:8787');
  assert.equal(Core.serviceUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(Core.serviceUrl('http://[::1]:8787/'), 'http://[::1]:8787');
  for (const url of [
    'http://targets.example',
    'http://localhost.targets.example',
    'http://192.168.1.10',
    'https://name:password@targets.example',
    'https://name@targets.example',
    'https://targets.example?key=abcdefghijklmnop',
    'https://targets.example#fragment',
    'javascript:alert(1)',
    'file:///tmp/targets',
    '/relative/path',
    '',
  ]) assert.throws(() => Core.serviceUrl(url), undefined, url);
});

test('API key format accepts exactly sixteen alphanumeric characters', () => {
  assert.equal(Core.validKey('AbCdEfGh12345678'), true);
  for (const value of ['', 'short', 'AbCdEfGh123456789', 'AbCdEfGh1234567!', ' AbCdEfGh12345678', 'AbCdEfGh12345678 ', null, undefined]) {
    assert.equal(Core.validKey(value), false, String(value));
  }
});

test('display helpers keep unknown values explicit', () => {
  assert.equal(Core.compact(undefined), 'Unknown');
  assert.equal(Core.compact(null), 'Unknown');
  assert.equal(Core.compact(Infinity), 'Unknown');
  assert.equal(Core.compact(1_000_000), '1M');
  assert.equal(Core.ageLabel(undefined, NOW), 'Date unknown');
  assert.equal(Core.ageLabel(NOW / 1000, NOW), 'Just now');
  assert.equal(Core.ageLabel(NOW / 1000 - 120, NOW), '2m ago');
  assert.equal(Core.ageLabel(NOW / 1000 - 7200, NOW), '2h ago');
  assert.equal(Core.ageLabel(NOW / 1000 - 172800, NOW), '2d ago');
});
