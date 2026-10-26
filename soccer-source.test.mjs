import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addDays } from './calendar.mjs';
import { soccerSeason, soccerWindow, soccerDay, normalizeSoccerGame, validateSoccerData, fetchSoccerData } from './soccer-source.mjs';

const now = '2026-10-26T12:00:00Z';
const config = { teams: [{ id: '2572', name: 'Como', league: 'ita.1', expectedLeagueGames: 2 }],
  leagues: ['ita.1'], selectionHorizonDays: 14 };
const meta = { slug: 'ita.1', name: 'Italian Serie A', season: { year: 2026 }, calendarType: 'day', calendar: [] };
function game(id = '401900001', day = '2026-11-01', options = {}) {
  return { id, date: `${day}T19:45Z`, season: { year: 2026 }, league: meta,
    competitions: [{ date: `${day}T19:45Z`, timeValid: true,
      competitors: [{ homeAway: 'home', team: { id: '2572', displayName: 'Como' } },
        { homeAway: 'away', team: { id: '111', displayName: 'Opponent' } }],
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
      venue: { fullName: 'Stadio Giuseppe Sinigaglia' } }], ...options };
}
function rawData() {
  const window = soccerWindow(now);
  const scheduled = [game(), game('401900002', '2027-01-01')];
  const boards = {};
  for (let day = window.start; day < window.end; day = addDays(day, 1)) boards[day] = { leagues: [meta], events: day === '2026-11-01' ? [scheduled[0]] : [] };
  const table = { season: { year: 2026 }, children: [{ standings: { entries: Array.from({ length: 20 }, (_, i) => ({
    team: { id: String(100 + i) }, stats: [{ name: 'rank', value: i + 1 }, { name: 'points', value: 25 - i }, { name: 'gamesPlayed', value: 8 }],
  })) } }] };
  return { season: 2026, window, teams: { '2572': {
    results: { team: { id: '2572' }, requestedSeason: { year: 2026 }, events: [] },
    fixtures: { team: { id: '2572' }, requestedSeason: { year: 2026 }, events: scheduled },
  } }, boards: { 'ita.1': boards }, standings: { 'ita.1': table }, warnings: [] };
}
const response = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
function serve(raw, url) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/standings')) return raw.standings['ita.1'];
  if (parsed.pathname.endsWith('/schedule')) return raw.teams['2572'][parsed.searchParams.has('fixture') ? 'fixtures' : 'results'];
  const ymd = parsed.searchParams.get('dates');
  const day = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  return raw.boards['ita.1'][day];
}

test('soccer seasons and Monday windows respect Brussels calendar days across DST', () => {
  assert.equal(soccerSeason('2026-07-31T22:00Z'), 2025);
  assert.equal(soccerSeason('2026-08-01T00:00Z'), 2026);
  assert.equal(soccerDay('2026-10-25T23:30Z'), '2026-10-26');
  assert.deepEqual(soccerWindow('2026-10-25T23:30Z'), { start: '2026-10-26', end: '2026-11-09' });
  assert.deepEqual(soccerWindow('2026-10-25T20:00Z'), { start: '2026-10-19', end: '2026-11-02' });
});

test('a complete season and every day of the selection window are required', () => {
  const raw = rawData();
  const data = validateSoccerData(raw, config, now);
  assert.equal(data.games.length, 2, 'club and scoreboard copies deduplicate');
  assert.equal(data.counts.teams['2572'].leagueGames, 2);
  assert.equal(data.counts.leagues['ita.1'], 1);
  assert.equal(data.standings['ita.1']['100'].rank, 1);
  assert.deepEqual(data.warnings, []);
  raw.teams['2572'].fixtures.events.pop();
  assert.throws(() => validateSoccerData(raw, config, now), /incomplete league schedule/);
});

for (const [name, mutate, pattern] of [
  ['stale window', raw => { raw.window.end = '2026-11-08'; }, /window/],
  ['wrong club season', raw => { raw.teams['2572'].fixtures.requestedSeason.year = 2025; }, /wrong requested season/],
  ['wrong club', raw => { raw.teams['2572'].fixtures.team.id = '175'; }, /wrong-team/],
  ['missing day', raw => { delete raw.boards['ita.1']['2026-11-04']; }, /scoreboard/],
  ['wrong board season', raw => { raw.boards['ita.1']['2026-11-04'] = { leagues: [{ ...meta, season: { year: 2025 } }], events: [] }; }, /wrong-season/],
  ['advertised but empty day', raw => { raw.boards['ita.1']['2026-11-04'] = { leagues: [{ ...meta, calendar: ['2026-11-04T08:00Z'] }], events: [] }; }, /advertised/],
  ['capped board', raw => { raw.boards['ita.1']['2026-11-01'].events = Array.from({ length: 100 }, () => game()); }, /result limit/],
  ['conflicting snapshots', raw => { raw.boards['ita.1']['2026-11-01'].events = [game('401900001', '2026-11-01', { date: '2026-11-01T18:45Z', competitions: [{ ...game().competitions[0], date: '2026-11-01T18:45Z' }] })]; }, /conflicting snapshots/],
]) test(`rejects ${name} without publishing partial coverage`, () => {
  const raw = rawData();
  mutate(raw);
  assert.throws(() => validateSoccerData(raw, config, now), pattern);
});

test('future ESPN timeValid is a provisional time, never proof of TV confirmation', () => {
  const raw = game();
  const future = normalizeSoccerGame(raw);
  assert.equal(future.timeKnown, true);
  assert.equal(future.timeConfirmed, false);
  assert.equal(future.status, 'TENTATIVE');
  assert.equal(future.date, '2026-11-01T19:45:00.000Z');
  raw.competitions[0].status.type = { name: 'STATUS_FULL_TIME', state: 'post', completed: true };
  const finished = normalizeSoccerGame(raw);
  assert.equal(finished.finished, true);
  assert.equal(finished.timeConfirmed, true);
  assert.equal(finished.status, 'CONFIRMED');
});

test('unknown kickoffs, postponement and cancellations preserve source status', () => {
  const raw = game();
  raw.competitions[0].timeValid = false;
  assert.equal(normalizeSoccerGame(raw).timeKnown, false);
  raw.competitions[0].timeValid = true;
  raw.competitions[0].status.type.name = 'STATUS_POSTPONED';
  assert.equal(normalizeSoccerGame(raw).postponed, true);
  assert.equal(normalizeSoccerGame(raw).timeKnown, false);
  raw.competitions[0].status.type.name = 'STATUS_CANCELED';
  assert.equal(normalizeSoccerGame(raw).status, 'CANCELLED');
});

test('standings failures warn but do not discard complete fixtures', () => {
  const raw = rawData();
  raw.standings['ita.1'].season.year = 2025;
  const data = validateSoccerData(raw, config, now);
  assert.equal(data.games.length, 2);
  assert.deepEqual(data.standings['ita.1'], {});
  assert.match(data.warnings[0], /Standings unavailable/);
});

test('the source uses every explicit day, no unsupported range requests, and bounded concurrency', async () => {
  const raw = rawData();
  let current = 0, maximum = 0;
  const urls = [];
  const data = await fetchSoccerData(config, now, { fetchImpl: async url => {
    urls.push(url); maximum = Math.max(maximum, ++current);
    await new Promise(resolve => setTimeout(resolve, 2)); current--;
    return response(serve(raw, url));
  } });
  const boards = urls.filter(url => url.includes('/scoreboard'));
  assert.equal(boards.length, 14);
  assert.ok(boards.every(url => /^\d{8}$/.test(new URL(url).searchParams.get('dates'))));
  assert.ok(maximum <= 6);
  assert.equal(data.games.length, 2);
});

test('one transient bad fixture response retries the full validation', async () => {
  const raw = rawData();
  const delays = [];
  let count = 0;
  const data = await fetchSoccerData(config, now, { fetchImpl: async url => {
    if (url.includes('fixture=true') && count++ === 0) return { ok: false, status: 503 };
    return response(serve(raw, url));
  }, sleep: async delay => delays.push(delay) });
  assert.equal(data.games.length, 2);
  assert.deepEqual(delays, [1000]);
});

test('systemic failures stop queued work promptly and fail after three bounded attempts', async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(fetchSoccerData(config, now, { fetchImpl: async () => {
    calls++; return { ok: false, status: 503 };
  }, sleep: async delay => delays.push(delay) }), /after 3 attempts.*503/);
  assert.ok(calls <= 18, `Only six in-flight requests per attempt, got ${calls}`);
  assert.deepEqual(delays, [1000, 2000]);
});

const cachedPath = new URL('./.cache/soccer-source-verified.json', import.meta.url);
test('live source sample has complete Como and Lens seasons and deduplicates their shared Champions League game', { skip: !fs.existsSync(cachedPath) }, () => {
  const cached = JSON.parse(fs.readFileSync(cachedPath, 'utf8'));
  const fullConfig = { teams: [
    { id: '2572', name: 'Como', league: 'ita.1', expectedLeagueGames: 38 },
    { id: '175', name: 'RC Lens', league: 'fra.1', expectedLeagueGames: 34 },
  ], leagues: ['eng.1', 'ita.1', 'esp.1', 'ger.1', 'fra.1', 'uefa.champions'], selectionHorizonDays: 14 };
  const data = validateSoccerData(cached.raw, fullConfig, now);
  assert.equal(data.counts.teams['2572'].leagueGames, 38);
  assert.equal(data.counts.teams['175'].leagueGames, 34);
  assert.equal(data.games.filter(game => game.id === '401915305').length, 1);
  assert.equal(data.games.filter(game => game.league === 'uefa.champions' && [game.home.id, game.away.id].includes('2572')).length, 8);
  assert.deepEqual(data.warnings, []);
});
