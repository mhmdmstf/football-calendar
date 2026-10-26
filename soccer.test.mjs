import test from 'node:test';
import assert from 'node:assert/strict';
import { soccerDay, soccerWeek, soccerEvent, rateSoccerGame, buildSoccerEvents, retainSoccerEvents } from './soccer.mjs';
import { renderCalendar, stabilize } from './calendar.mjs';

const now = '2026-10-26T10:00:00.000Z';
const config = {
  enabled: true, teams: [{ id: '2572', name: 'Como' }, { id: '175', name: 'RC Lens' }],
  domesticLeagues: ['eng.1', 'ita.1', 'esp.1', 'ger.1', 'fra.1'],
  domesticGamesPerWeek: 6, maxPerLeague: 2, championsGamesPerWeek: 4,
  selectionHorizonDays: 14, excludeGameIds: [],
};
const names = { 'eng.1': ['Arsenal', 'Liverpool'], 'ita.1': ['Inter Milan', 'AC Milan'],
  'esp.1': ['Real Madrid', 'Barcelona'], 'ger.1': ['Bayern Munich', 'Borussia Dortmund'],
  'fra.1': ['Paris Saint-Germain', 'Marseille'], 'uefa.champions': ['Real Madrid', 'Bayern Munich'] };
function game(id = '1', league = 'eng.1', overrides = {}) {
  const teams = names[league] || ['Como', 'Opponent'];
  return {
    id: String(id), league, season: 2026, date: '2026-10-31T15:00:00.000Z', day: '2026-10-31',
    timeKnown: true, timeConfirmed: false, home: { id: `home-${id}`, name: teams[0] },
    away: { id: `away-${id}`, name: teams[1] }, competition: { name: league, slug: league },
    venue: 'Stadium', url: `https://www.espn.com/soccer/match/_/gameId/${id}`, status: 'TENTATIVE',
    postponed: false, finished: false, friendly: false, stage: '', ...overrides,
  };
}
const data = (games, standings = {}) => ({ games, standings, window: { start: '2026-10-26', end: '2026-11-09' } });
const build = (games, previous = [], settings = config, at = now, standings = {}) => buildSoccerEvents(data(games, standings), settings, at, previous);
const competitiveFixtures = () => config.domesticLeagues.flatMap((league, i) =>
  Array.from({ length: 3 }, (_, j) => game(`${i}${j}`, league)));

test('European calendar dates and week boundaries use Brussels time', () => {
  assert.equal(soccerDay('2026-10-25T23:30:00Z'), '2026-10-26');
  assert.equal(soccerWeek('2026-10-25'), '2026-10-19');
  assert.equal(soccerWeek('2026-10-26'), '2026-10-26');
  assert.equal(soccerWeek('2026-11-01'), '2026-10-26');
  assert.throws(() => soccerDay('bad date'), /invalid current date/);
});

test('Como and Lens receive every competitive fixture outside curation limits, shared games once', () => {
  const como = { id: '2572', name: 'Como' }, lens = { id: '175', name: 'RC Lens' };
  const fixtures = [
    game('1', 'ita.1', { home: como }), game('2', 'fra.1', { away: lens }),
    game('3', 'ita.coppa_italia', { home: como, day: '2027-01-10', date: '2027-01-10T20:00:00Z' }),
    game('4', 'uefa.champions', { home: lens, away: como }),
    game('5', 'club.friendly', { home: como, friendly: true }),
    game('6', 'eng.1', { home: { id: '363', name: 'Chelsea' }, away: como }),
  ];
  fixtures.push(structuredClone(fixtures[3]));
  const events = build(fixtures, [], { ...config, domesticGamesPerWeek: 0, championsGamesPerWeek: 0 }).events;
  assert.deepEqual(events.map(e => e.gameId).sort(), ['1', '2', '3', '4']);
  assert.ok(events.every(e => e.soccerSelectionKind === 'followed'));
  assert.match(events.find(e => e.gameId === '4').description, /RC Lens and Como/);
});

test('domestic picks respect six per week and two per league; Champions League has its separate four', () => {
  const fixtures = [...competitiveFixtures(), ...Array.from({ length: 8 }, (_, i) => game(`cl${i}`, 'uefa.champions'))];
  const events = build(fixtures).events;
  const domestic = events.filter(e => e.soccerSelectionKind === 'domestic');
  assert.equal(domestic.length, 6);
  assert.equal(events.filter(e => e.soccerSelectionKind === 'champions').length, 4);
  for (const league of config.domesticLeagues) assert.ok(domestic.filter(e => e.soccerLeague === league).length <= 2);
  assert.equal(new Set(domestic.map(e => e.soccerLeague)).size >= 3, true);
  assert.deepEqual(build([...fixtures].reverse()).events, events, 'Tied selection must be deterministic');
});

test('each calendar week has independent quotas and followed games consume none', () => {
  const fixtures = [
    ...competitiveFixtures(),
    ...competitiveFixtures().map(g => ({ ...g, id: `next-${g.id}`, day: '2026-11-07', date: '2026-11-07T15:00:00Z' })),
    game('como', 'ita.1', { home: { id: '2572', name: 'Como' } }),
  ];
  const events = build(fixtures).events;
  assert.equal(events.filter(e => e.soccerSelectionWeek === '2026-10-26' && e.soccerSelectionKind === 'domestic').length, 6);
  assert.equal(events.filter(e => e.soccerSelectionWeek === '2026-11-02' && e.soccerSelectionKind === 'domestic').length, 6);
  assert.equal(events.filter(e => e.soccerSelectionKind === 'followed').length, 1);
});

test('already played picks still consume their weekly quota and per-league allowance', () => {
  const monday = game('old', 'eng.1', { day: '2026-10-26', date: '2026-10-26T20:00:00Z' });
  const initial = stabilize(build([monday], [], config, now).events, [], now);
  const fixtures = [{ ...monday, finished: true, status: 'CONFIRMED' }, ...competitiveFixtures()];
  const events = build(fixtures, initial, { ...config, domesticGamesPerWeek: 3, maxPerLeague: 1 }, '2026-10-28T10:00:00Z').events;
  assert.equal(events.length, 3);
  assert.equal(events.filter(e => e.soccerLeague === 'eng.1').length, 1);
  assert.equal(events.some(e => e.gameId === 'old'), true);
});

test('live table meetings can outrank famous clubs and do not invent title-race certainty', () => {
  const contenders = game('table', 'fra.1', { home: { id: 'a', name: 'Club A' }, away: { id: 'b', name: 'Club B' } });
  const rows = { 'fra.1': { a: { rank: 1, played: 9, points: 22 }, b: { rank: 2, played: 9, points: 21 } } };
  const rating = rateSoccerGame(contenders, rows);
  assert.ok(rating.score > rateSoccerGame(game('names', 'eng.1')).score);
  assert.match(rating.reasons.join(' '), /Club A #1, Club B #2/);
  assert.match(rating.reasons.join(' '), /1 point separating/);
  assert.doesNotMatch(rating.reasons.join(' '), /clinch|decide the title|must win/i);
  assert.equal(rateSoccerGame(contenders).score, 0);
  const emptySeason = { 'fra.1': { a: { rank: 1, played: 0 }, b: { rank: 2, played: 0 } } };
  assert.equal(rateSoccerGame(contenders, emptySeason).score, 0);
});

test('a weak opponent does not qualify solely because the other club is prominent', () => {
  const mismatch = game('mismatch', 'eng.1', { away: { id: 'small', name: 'Small Town' } });
  assert.equal(build([mismatch]).events.length, 0);
  const rivalry = game('derby', 'esp.1');
  assert.match(rateSoccerGame(rivalry).reasons.join(' '), /El Clasico/);
});

test('top-half selection uses nine places in the 18-club French and German leagues', () => {
  for (const league of ['fra.1', 'ger.1']) {
    const fixture = game('positions', league, { home: { id: 'a', name: 'A' }, away: { id: 'b', name: 'B' } });
    const table = { [league]: { a: { rank: 1, played: 8 }, b: { rank: 10, played: 8 } } };
    assert.equal(rateSoccerGame(fixture, table).score, 0);
    table[league].b.rank = 9;
    assert.ok(rateSoccerGame(fixture, table).score >= 50);
  }
});

test('Champions League knockout ties and high-profile pairings rank ahead of ordinary fixtures', () => {
  const ordinary = game('ordinary', 'uefa.champions', { home: { id: 'a', name: 'A' }, away: { id: 'b', name: 'B' } });
  const elite = game('elite', 'uefa.champions');
  const knockout = { ...ordinary, id: 'ko', stage: 'Quarter-final' };
  assert.ok(rateSoccerGame(elite).score > rateSoccerGame(ordinary).score);
  assert.ok(rateSoccerGame(knockout).score > rateSoccerGame(elite).score);
  assert.match(rateSoccerGame(knockout).reasons.join(' '), /knockout tie/);
  for (const stage of ['Quarterfinals', 'Semi-finals', 'Semifinals', 'Finals', 'Quarter Finals', 'Playoffs']) {
    const variant = { ...ordinary, stage };
    assert.ok(rateSoccerGame(variant).score >= 100, stage);
    const e = soccerEvent(variant, {}, now);
    assert.equal(Date.parse(e.end) - Date.parse(e.start), 2.5 * 3600000, stage);
  }
});

test('picks retain their original reasons when standings change, without modification churn', () => {
  const g = game('1');
  const first = stabilize(build([g]).events, [], now);
  const changedTable = { 'eng.1': { 'home-1': { rank: 1, played: 9, points: 25 }, 'away-1': { rank: 2, played: 9, points: 24 } } };
  const again = build([g], first, config, '2026-10-27T10:00:00Z', changedTable).events;
  assert.deepEqual(stabilize(again, first, '2026-10-27T10:00:00Z'), first);
});

test('source-listed kickoffs remain clearly provisional while confirmed or finished times do not', () => {
  const provisional = soccerEvent(game(), {}, now);
  assert.equal(provisional.status, 'TENTATIVE');
  assert.equal(provisional.allDay, false);
  assert.match(provisional.title, /\[provisional\]/);
  assert.match(provisional.description, /both may change/);
  assert.equal(Date.parse(provisional.end) - Date.parse(provisional.start), 2 * 3600000);
  for (const overrides of [{ timeConfirmed: true }, { finished: true }]) {
    const e = soccerEvent(game('1', 'eng.1', overrides), {}, now);
    assert.equal(e.status, 'CONFIRMED');
    assert.doesNotMatch(e.title, /provisional/);
  }
  const extraTime = soccerEvent(game('ko', 'uefa.champions', { stage: 'Semi-final' }), {}, now);
  assert.equal(Date.parse(extraTime.end) - Date.parse(extraTime.start), 2.5 * 3600000);
});

for (const [name, overrides] of [
  ['unknown kickoff', { timeKnown: false }], ['postponed kickoff', { postponed: true }],
]) test(`${name} becomes a transparent all-day marker`, () => {
  const e = soccerEvent(game('1', 'eng.1', overrides), {}, now);
  assert.equal(e.allDay, true);
  assert.equal(e.start, '2026-10-31');
  assert.equal(e.end, '2026-11-01');
  assert.equal(e.status, 'TENTATIVE');
  const ics = renderCalendar(stabilize([e], [], now), 'Football and Friends');
  assert.match(ics, /DTSTART;VALUE=DATE:20261031/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
});

test('rescheduling keeps the UID and original quota week while revising kickoff and sequence', () => {
  const first = stabilize(build([game()]).events, [], now);
  const moved = game('1', 'eng.1', { day: '2026-11-07', date: '2026-11-07T18:00:00Z', timeConfirmed: true });
  const next = stabilize(build([moved], first).events, first, '2026-10-27T10:00:00Z');
  assert.equal(next.length, 1);
  assert.equal(next[0].uid, first[0].uid);
  assert.equal(next[0].soccerSelectionWeek, '2026-10-26');
  assert.equal(next[0].start, '2026-11-07T18:00:00.000Z');
  assert.equal(next[0].sequence, first[0].sequence + 1);
});

test('cancellation updates a published event and frees its selection allowance', () => {
  const first = stabilize(build([game()]).events, [], now);
  const next = build([game('1', 'eng.1', { status: 'CANCELLED' }), game('2')], first, { ...config, domesticGamesPerWeek: 1 }).events;
  assert.equal(next.length, 2);
  const cancelled = next.find(e => e.gameId === '1');
  assert.equal(cancelled.status, 'CANCELLED');
  assert.match(renderCalendar(stabilize([cancelled], first, now), 'Sports'), /STATUS:CANCELLED\r\nTRANSP:TRANSPARENT/);
});

test('missing future matches are retained with warnings and no metadata churn', () => {
  const first = stabilize(build([game()]).events, [], now);
  const missing = build([], first);
  assert.equal(missing.events.length, 1);
  assert.equal(missing.warnings.length, 1);
  assert.deepEqual(stabilize(missing.events, first, '2026-10-27T10:00:00Z'), first);
});

test('retention owns only generic soccer entries and respects explicit exclusions', () => {
  const first = stabilize(build([game()]).events, [], now);
  const chelsea = { ...first[0], uid: 'chelsea-100@football-watchlist', categories: ['Soccer', 'Chelsea'] };
  const hockey = { ...first[0], uid: 'nhl-100@football-watchlist', categories: ['NHL'] };
  assert.equal(retainSoccerEvents([...first, chelsea, hockey]).length, 1);
  for (const key of ['hash', 'created', 'modified', 'sequence']) assert.equal(Object.hasOwn(retainSoccerEvents(first)[0], key), false);
  assert.equal(build([game()], first, { ...config, excludeGameIds: ['1'] }).events.length, 0);
});

test('new curation excludes completed, postponed, Chelsea, friendly and out-of-window games', () => {
  const fixtures = [
    game('finished', 'eng.1', { finished: true }), game('postponed', 'eng.1', { postponed: true }),
    game('chelsea', 'eng.1', { home: { id: '363', name: 'Chelsea' } }),
    game('friendly', 'eng.1', { friendly: true }),
    game('later', 'eng.1', { day: '2026-11-09', date: '2026-11-09T20:00:00Z' }),
    game('earlier', 'eng.1', { day: '2026-10-25', date: '2026-10-25T20:00:00Z' }),
  ];
  assert.equal(build(fixtures).events.length, 0);
});
