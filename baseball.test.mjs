import test from 'node:test';
import assert from 'node:assert/strict';
import { baseballRaceRatings, selectBaseball, baseballEvent, buildBaseballEvents, retainBaseballEvents } from './baseball.mjs';
import { renderCalendar, stabilize } from './calendar.mjs';

const now = '2026-09-19T10:00:00.000Z';
const config = { favoriteTeamIds: ['121'], selectionHorizonDays: 10, gamesPerDay: 1, gamesPerSeries: 2, gamesBackThreshold: 5 };
function team(id, name, overrides = {}) {
  return { id, name, short: name, placeholder: false, leagueId: 103, divisionId: 201,
    wins: 80, losses: 70, divisionRank: '5', wildCardRank: '10', divisionGamesBack: '15',
    eliminationNumber: 'E', wildCardEliminationNumber: 'E', divisionChamp: false,
    divisionLeader: false, clinched: false, ...overrides };
}
const boston = team('111', 'Boston Red Sox', { wins: 90, losses: 60, divisionRank: '1', divisionGamesBack: '-', divisionLeader: true, eliminationNumber: '-', wildCardEliminationNumber: '-' });
const yankees = team('147', 'New York Yankees', { wins: 89, losses: 61, divisionRank: '2', divisionGamesBack: '1', wildCardRank: '1', eliminationNumber: '10', wildCardEliminationNumber: '10' });
const toronto = team('141', 'Toronto Blue Jays', { wins: 88, losses: 62, divisionRank: '3', divisionGamesBack: '2', wildCardRank: '2', eliminationNumber: '9', wildCardEliminationNumber: '9' });
const cleveland = team('114', 'Cleveland Guardians', { divisionId: 202, wins: 100, losses: 50, divisionRank: '1', divisionGamesBack: '-', divisionLeader: true, divisionChamp: true, clinched: true });
const detroit = team('116', 'Detroit Tigers', { divisionId: 202, wins: 87, losses: 63, divisionRank: '2', wildCardRank: '3', wildCardEliminationNumber: '8' });
const minnesota = team('142', 'Minnesota Twins', { divisionId: 202, wins: 86, losses: 64, divisionRank: '3', wildCardRank: '4', wildCardEliminationNumber: '7' });
const phillies = team('143', 'Philadelphia Phillies', { leagueId: 104, divisionId: 204, wins: 90, losses: 60, divisionRank: '1', divisionGamesBack: '-', divisionLeader: true, eliminationNumber: '-', wildCardEliminationNumber: '-' });
const atlanta = team('144', 'Atlanta Braves', { leagueId: 104, divisionId: 204, wins: 89, losses: 61, divisionRank: '2', divisionGamesBack: '1', eliminationNumber: '10', wildCardEliminationNumber: '10' });
const mets = team('121', 'New York Mets', { leagueId: 104, divisionId: 204 });
const cubs = team('112', 'Chicago Cubs', { leagueId: 104, divisionId: 205 });
const standings = [boston, yankees, toronto, cleveland, detroit, minnesota, phillies, atlanta, mets, cubs];

function game(id, day = '2026-09-19', overrides = {}) {
  return { id, season: 2026, type: 'R', day, date: `${day}T20:00:00.000Z`, timeKnown: true,
    away: yankees, home: boston, venue: 'Ballpark', url: `https://www.mlb.com/gameday/${id}`,
    channels: [], pitchers: [], stage: '', seriesGameNumber: 1, seriesKey: null,
    seriesOver: false, ifNecessary: false, status: 'CONFIRMED', state: 'Scheduled', finished: false, ...overrides };
}
function playoff(id, overrides = {}) {
  return game(id, '2026-10-07', { type: 'D', stage: 'ALDS A Game 5',
    seriesKey: '2026:D:alds-a', seriesGameNumber: 5, ifNecessary: true, ...overrides });
}
const data = games => ({ games, standings });
const build = (games, previous = [], at = now) => buildBaseballEvents(data(games), config, at, previous);

test('live division and wildcard cutoffs create stakes; eliminated favorites do not', () => {
  const ratings = baseballRaceRatings(standings);
  assert.ok(ratings.get(boston.id).score > 0);
  assert.ok(ratings.get(yankees.id).score > 0);
  assert.match(ratings.get(detroit.id).reasons.join(' '), /1 game ahead of the first team outside the wild cards/);
  assert.match(ratings.get(minnesota.id).reasons.join(' '), /1 game behind the final wild-card spot/);
  assert.deepEqual(ratings.get(mets.id), { score: 0, reasons: [], eliminated: true });
});

test('a direct same-league race outranks lesser favorite and interleague choices', () => {
  const games = [
    game('favorite-meaningless', undefined, { away: mets, home: cubs }),
    game('favorite-opponent-stakes', undefined, { away: mets, home: phillies }),
    game('interleague', undefined, { away: yankees, home: phillies }),
    game('direct-race')
  ];
  const picks = selectBaseball(games, standings, config, now);
  assert.deepEqual([...picks.keys()], ['direct-race']);
  assert.match(picks.get('direct-race').join(' '), /Two teams with live postseason stakes meet directly/);
});

test('an eliminated Mets matchup qualifies through its opponent without inventing a Mets race', () => {
  const picks = selectBaseball([game('mets-phillies', undefined, { away: mets, home: phillies })], standings, config, now);
  assert.equal(picks.size, 1);
  const reason = picks.get('mets-phillies').join(' ');
  assert.match(reason, /Philadelphia Phillies:/);
  assert.match(reason, /Following New York Mets/);
  assert.doesNotMatch(reason, /New York Mets:/);
  assert.doesNotMatch(reason, /Two teams with live postseason stakes/);
  assert.equal(selectBaseball([game('mets-cubs', undefined, { away: mets, home: cubs })], standings, config, now).size, 0);
});

test('regular choices stay at one per day and no more than two games from one series', () => {
  const games = Array.from({ length: 5 }, (_, i) => [
    game(`race-${i}`, `2026-09-${19 + i}`),
    game(`other-${i}`, `2026-09-${19 + i}`, { away: mets, home: phillies })
  ]).flat();
  const picks = selectBaseball(games, standings, config, now);
  const selected = games.filter(g => picks.has(g.id));
  assert.equal(selected.length, 4);
  for (const day of new Set(selected.map(g => g.day))) assert.equal(selected.filter(g => g.day === day).length, 1);
  assert.equal(selected.filter(g => g.home.id === boston.id).length, 2);
  assert.equal(selected.filter(g => g.home.id === phillies.id).length, 2);
});

test('two previously watched games consume their actual series allowance across refreshes', () => {
  const seriesKey = '2026:R:147:49/111:49';
  const first = game('series-1', '2026-09-17', { seriesKey, finished: true, state: 'Final' });
  const second = game('series-2', '2026-09-18', { seriesKey, finished: true, state: 'Final' });
  const previous = stabilize([first, second].map(g => baseballEvent(g, ['Previously selected'], config)), [], '2026-09-17T10:00:00Z');
  const third = game('series-3', '2026-09-19', { seriesKey });
  const differentSeries = game('next-series', '2026-09-20', { seriesKey: '2026:R:147:50/111:50' });
  const selected = selectBaseball([first, second, third, differentSeries], standings, config, now, previous);
  assert.deepEqual([...selected.keys()], ['next-series']);
  assert.equal(build([first, second, third, differentSeries], previous).events.some(e => e.gameId === 'series-3'), false);
});

test('a previously selected game already underway prevents another regular pick that day', () => {
  const first = game('started-pick', undefined, { seriesKey: '2026:R:147:49/111:49' });
  const previous = stabilize(build([first]).events, [], now);
  const inProgress = { ...first, state: 'In Progress' };
  const later = game('later-game', undefined, { date: '2026-09-19T23:00:00Z', away: mets, home: phillies, seriesKey: '2026:R:121:49/143:49' });
  const refreshTime = '2026-09-19T21:00:00Z';
  assert.equal(selectBaseball([inProgress, later], standings, config, refreshTime, previous).size, 0);
  const refreshed = build([inProgress, later], previous, refreshTime);
  assert.deepEqual(refreshed.events.map(e => e.gameId), ['started-pick']);
});

test('regular picks use the ten-day September window and exclude started or interrupted games', () => {
  const games = [
    game('today'), game('last-day', '2026-09-28', { away: mets, home: phillies }),
    game('past', '2026-09-18'), game('outside-window', '2026-09-29'), game('october-regular', '2026-10-01'),
    game('already-started', undefined, { date: '2026-09-19T09:00:00Z' }),
    game('finished', undefined, { finished: true }), game('cancelled', undefined, { status: 'CANCELLED' }),
    game('postponed', undefined, { state: 'Postponed' }), game('suspended', undefined, { state: 'Suspended' })
  ];
  assert.deepEqual([...selectBaseball(games, standings, config, now).keys()].sort(), ['last-day', 'today']);
});

test('every postseason round is included beyond the selection horizon and daily/series caps', () => {
  const games = ['F', 'D', 'L', 'W'].flatMap((type, i) => [
    playoff(`${type}-1`, { type, day: '2026-11-01', date: '2026-11-01T20:00:00Z', seriesGameNumber: 1 }),
    playoff(`${type}-2`, { type, day: '2026-11-01', date: '2026-11-01T22:00:00Z', seriesGameNumber: 2 })
  ]);
  assert.equal(selectBaseball(games, standings, config, now).size, 8);
  assert.equal(build(games).events.length, 8);
});

test('explicit game exclusions override postseason and manual additions', () => {
  const picks = selectBaseball([playoff('excluded'), game('added')], standings,
    { ...config, includeGameIds: ['excluded', 'added'], excludeGameIds: ['excluded'] }, now);
  assert.deepEqual([...picks.keys()], ['added']);
});

test('official game identity survives placeholder resolution, a confirmed time, and rescheduling', () => {
  const placeholder = playoff('8001', { timeKnown: false, status: 'TENTATIVE', ifNecessary: false,
    away: team('9001', 'AL Wild Card A', { placeholder: true }), home: team('9002', 'AL Division Winner', { placeholder: true }) });
  const first = stabilize(build([placeholder]).events, [], now)[0];
  assert.equal(first.allDay, true);
  assert.equal(first.status, 'TENTATIVE');
  const assigned = { ...placeholder, away: yankees, home: boston, timeKnown: true, date: '2026-10-07T23:00:00Z', status: 'CONFIRMED' };
  const second = stabilize(build([assigned], [first]).events, [first], '2026-09-20T10:00:00Z')[0];
  const moved = { ...assigned, day: '2026-10-08', date: '2026-10-08T23:30:00Z' };
  const third = stabilize(build([moved], [second]).events, [second], '2026-10-07T12:00:00Z')[0];
  assert.equal(first.uid, 'mlb-8001@football-watchlist');
  assert.equal(second.uid, first.uid);
  assert.equal(third.uid, first.uid);
  assert.equal(third.created, first.created);
  assert.equal(second.sequence, first.sequence + 1);
  assert.equal(third.sequence, second.sequence + 1);
  assert.equal(second.allDay, false);
  assert.equal(second.status, 'CONFIRMED');
  assert.equal(third.start, '2026-10-08T23:30:00.000Z');
});

test('doubleheaders use distinct game IDs even with identical teams and date', () => {
  const first = baseballEvent(game('8101'), ['Selected game']);
  const second = baseballEvent(game('8102', undefined, { date: '2026-09-19T23:30:00Z', seriesGameNumber: 2 }), ['Selected game']);
  assert.notEqual(first.uid, second.uid);
  assert.equal(first.gameId, '8101');
  assert.equal(second.gameId, '8102');
});

test('cancellation updates the existing event and makes its calendar block transparent', () => {
  const original = playoff('8201');
  const first = stabilize(build([original]).events, [], now)[0];
  const cancelled = { ...original, status: 'CANCELLED', state: 'Not Necessary' };
  const updated = stabilize(build([cancelled], [first]).events, [first], '2026-09-20T10:00:00Z')[0];
  assert.equal(updated.uid, first.uid);
  assert.equal(updated.status, 'CANCELLED');
  assert.equal(updated.sequence, first.sequence + 1);
  const ics = renderCalendar([updated], 'Sports Worth Watching');
  assert.match(ics, /STATUS:CANCELLED\r\nTRANSP:TRANSPARENT/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('postponement before first pitch retains the selected regular game without its obsolete timed window', () => {
  const original = game('8301');
  const first = stabilize(build([original]).events, [], now)[0];
  const postponed = { ...original, status: 'TENTATIVE', state: 'Postponed' };
  const result = build([postponed], [first], '2026-09-19T12:00:00Z');
  assert.equal(result.events.length, 1);
  const updated = stabilize(result.events, [first], '2026-09-19T12:00:00Z')[0];
  assert.equal(updated.uid, first.uid);
  assert.equal(updated.allDay, true);
  assert.equal(updated.start, '2026-09-19');
  assert.equal(updated.status, 'TENTATIVE');
  const ics = renderCalendar([updated], 'Sports Worth Watching');
  assert.match(ics, /TRANSP:TRANSPARENT/);
  assert.doesNotMatch(ics, /DTSTART:20260919T200000Z/);
});

test('an MLB outage retains future and historical events without creating new modification sequences', () => {
  const published = stabilize([
    baseballEvent(game('old-game', '2026-09-18'), ['Previously selected']),
    baseballEvent(playoff('future-game'), ['All postseason'])
  ], [], now);
  const football = { ...published[0], uid: 'nfl-1@football-watchlist', categories: ['NFL'] };
  const retained = retainBaseballEvents([...published, football]);
  assert.equal(retained.length, 2);
  for (const e of retained) for (const field of ['hash', 'created', 'modified', 'sequence']) assert.equal(Object.hasOwn(e, field), false);
  const refreshed = stabilize(retained, published, '2026-09-20T10:00:00Z');
  assert.deepEqual(refreshed, published);
  assert.deepEqual(stabilize(retainBaseballEvents(refreshed), refreshed, '2026-09-21T10:00:00Z'), published);
});

test('unchanged MLB input gives deterministic events and stable modification sequences', () => {
  const games = [game('regular'), playoff('postseason')];
  const first = stabilize(build(games).events, [], now);
  const second = stabilize(build(games, first).events, first, '2026-09-19T11:00:00Z');
  assert.deepEqual(second, first);
  assert.deepEqual(build(games, first).events, build(games, first).events);
});

test('a missing optional playoff game is cancelled when an earlier game authoritatively ended its series', () => {
  const optional = playoff('8405', { seriesGameNumber: 5 });
  const prior = stabilize([baseballEvent(optional, ['All postseason'])], [], now);
  const clincher = playoff('8403', { seriesGameNumber: 3, day: '2026-10-05', date: '2026-10-05T20:00:00Z',
    ifNecessary: false, seriesOver: true, finished: true, state: 'Final', status: 'CONFIRMED' });
  const result = build([clincher], prior, '2026-10-06T10:00:00Z');
  const cancelled = result.events.find(e => e.uid === prior[0].uid);
  assert.ok(cancelled);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(stabilize([cancelled], prior, '2026-10-06T10:00:00Z')[0].sequence, prior[0].sequence + 1);
  const afterItsDate = build([], stabilize(result.events, prior, '2026-10-06T10:00:00Z'), '2026-10-09T10:00:00Z');
  assert.equal(afterItsDate.events.find(e => e.uid === prior[0].uid).status, 'CANCELLED');
});

for (const [caseName, changes] of [
  ['series is not over', { seriesOver: false }],
  ['game is not final', { finished: false }],
  ['different series', { seriesKey: '2026:D:alds-b' }],
  ['clincher game number is missing', { seriesGameNumber: null }],
  ['later game number', { seriesGameNumber: 6 }]
]) test(`missing optional playoff game stays intact when ${caseName}`, () => {
  const prior = stabilize([baseballEvent(playoff('8505'), ['All postseason'])], [], now);
  const other = playoff('8503', { seriesGameNumber: 3, seriesOver: true, finished: true, state: 'Final',
    ifNecessary: false, status: 'CONFIRMED', ...changes });
  const result = build([other], prior, '2026-10-06T10:00:00Z');
  const retained = result.events.find(e => e.uid === prior[0].uid);
  assert.ok(retained);
  assert.equal(retained.status, prior[0].status);
  assert.deepEqual(stabilize([retained], prior, '2026-10-06T10:00:00Z')[0], prior[0]);
  assert.ok(result.warnings.some(w => w.includes('8505')));
});
