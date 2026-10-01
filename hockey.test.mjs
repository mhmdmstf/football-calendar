import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hockeySeason, normalizeHockeyGame, validateHockeySchedules, fetchHockeySchedules,
  hockeyEvent, buildHockeyEvents, retainHockeyEvents
} from './hockey.mjs';
import { atEastern, renderCalendar, stabilize } from './calendar.mjs';

const now = '2026-10-01T10:00:00.000Z';
const season = 20262027;
const config = { enabled: true, teamAbbreviations: ['CAR', 'SJS'] };
const club = abbreviation => ({
  id: { CAR: 12, SJS: 28, FLA: 13, BOS: 6 }[abbreviation], abbrev: abbreviation,
  placeName: { default: { CAR: 'Carolina', SJS: 'San Jose', FLA: 'Florida', BOS: 'Boston' }[abbreviation] },
  commonName: { default: { CAR: 'Hurricanes', SJS: 'Sharks', FLA: 'Panthers', BOS: 'Bruins' }[abbreviation] }
});
function rawGame(index = 1, abbreviation = 'CAR', options = {}) {
  const requestedSeason = options.season || season;
  const year = Math.floor(requestedSeason / 10000);
  const type = options.gameType || 2;
  const day = new Date(Date.UTC(year, 9, 4 + (index - 1) * 2)).toISOString().slice(0, 10);
  return {
    id: Number(`${year}${String(type).padStart(2, '0')}${String(index + (abbreviation === 'SJS' ? 1000 : 0)).padStart(4, '0')}`),
    season: requestedSeason, gameType: type, gameDate: day, startTimeUTC: `${day}T23:00:00Z`,
    gameState: 'FUT', gameScheduleState: 'OK', venue: { default: 'Home Arena' },
    awayTeam: club('FLA'), homeTeam: club(abbreviation), tvBroadcasts: [], ...options
  };
}
function schedule(abbreviation = 'CAR', requestedSeason = season, count = requestedSeason >= 20262027 ? 84 : 82) {
  return { currentSeason: requestedSeason,
    games: Array.from({ length: count }, (_, index) => rawGame(index + 1, abbreviation, { season: requestedSeason })) };
}
function sharedSchedules() {
  const schedules = { CAR: schedule('CAR'), SJS: schedule('SJS') };
  for (let i = 0; i < 2; i++) {
    schedules.CAR.games[i].awayTeam = club('SJS');
    schedules.SJS.games[i] = structuredClone(schedules.CAR.games[i]);
  }
  return schedules;
}
function playoff(number = 7, options = {}) {
  return rawGame(number, 'CAR', {
    id: Number(`202603011${number}`), gameType: 3, gameDate: `2027-04-${20 + number}`,
    startTimeUTC: `2027-04-${20 + number}T23:00:00Z`,
    seriesStatus: { round: 1, seriesLetter: 'A', seriesTitle: 'First Round', neededToWin: 4,
      topSeedWins: 0, bottomSeedWins: 0, gameNumberOfSeries: number }, ...options
  });
}
const normalized = raw => normalizeHockeyGame(raw);
const build = (rawGames, previous = [], at = now, settings = config) =>
  buildHockeyEvents({ season, games: rawGames.map(normalized) }, settings, at, previous);
const event = raw => hockeyEvent(normalized(raw), config);

test('NHL season rolls over September 1 and remains stable across the calendar year', () => {
  assert.equal(hockeySeason('2026-08-31T23:59:59Z'), 20252026);
  assert.equal(hockeySeason('2026-09-01T00:00:00Z'), 20262027);
  assert.equal(hockeySeason('2027-01-01T00:00:00Z'), 20262027);
  assert.equal(hockeySeason('2027-08-31T23:59:59Z'), 20262027);
  assert.equal(hockeySeason('2027-09-01T00:00:00Z'), 20272028);
  assert.throws(() => hockeySeason('not a date'), /invalid current date/);
});

test('complete club schedules require 84 regular games from 2026-27 and 82 before then', () => {
  const current = validateHockeySchedules({ CAR: schedule() }, ['CAR'], season, now);
  assert.equal(current.counts.CAR.regular, 84);
  assert.equal(current.games.length, 84);
  const earlier = validateHockeySchedules({ CAR: schedule('CAR', 20252026) }, ['CAR'], 20252026, now);
  assert.equal(earlier.counts.CAR.regular, 82);
  assert.throws(() => validateHockeySchedules({ CAR: schedule('CAR', season, 83) }, ['CAR'], season, now), /incomplete regular season/);
  assert.throws(() => validateHockeySchedules({ CAR: schedule('CAR', 20252026, 84) }, ['CAR'], 20252026, now), /incomplete regular season/);
});

for (const [name, mutate] of [
  ['missing club', schedules => { delete schedules.CAR; }],
  ['wrong response season', schedules => { schedules.CAR.currentSeason = 20252026; }],
  ['wrong event season', schedules => { schedules.CAR.games[0].season = 20252026; }],
  ['wrong team', schedules => { schedules.CAR.games[0].homeTeam = club('BOS'); }],
  ['duplicated game replacing a missing game', schedules => { schedules.CAR.games[1] = structuredClone(schedules.CAR.games[0]); }],
  ['truncated schedule', schedules => { schedules.CAR.games.pop(); }],
  ['malformed kickoff', schedules => { schedules.CAR.games[0].startTimeUTC = 'later'; }]
]) test(`schedule validation rejects ${name}`, () => {
  const schedules = { CAR: schedule() };
  mutate(schedules);
  assert.throws(() => validateHockeySchedules(schedules, ['CAR'], season, now), /NHL:/);
});

test('shared Carolina-San Jose games are deduplicated while their broadcast listings are combined', () => {
  const schedules = sharedSchedules();
  schedules.CAR.games[0].tvBroadcasts = [{ network: 'ESPN' }];
  schedules.SJS.games[0].tvBroadcasts = [{ network: 'ESPN' }, { network: 'NBCSCA' }];
  const result = validateHockeySchedules(schedules, config.teamAbbreviations, season, now);
  assert.equal(result.counts.CAR.regular, 84);
  assert.equal(result.counts.SJS.regular, 84);
  assert.equal(result.games.length, 166);
  const shared = result.games.find(g => g.id === String(schedules.CAR.games[0].id));
  assert.deepEqual(shared.channels, ['ESPN', 'NBCSCA']);
  const events = buildHockeyEvents(result, config, now).events;
  assert.equal(events.length, 166);
  assert.equal(new Set(events.map(e => e.uid)).size, 166);
  assert.ok(events.find(e => e.gameId === shared.id).categories.includes('Carolina Hurricanes'));
  assert.ok(events.find(e => e.gameId === shared.id).categories.includes('San Jose Sharks'));
});

test('conflicting start times in the two club feeds fail instead of choosing an arbitrary snapshot', () => {
  const schedules = sharedSchedules();
  schedules.SJS.games[0].startTimeUTC = '2026-10-05T00:00:00Z';
  assert.throws(() => validateHockeySchedules(schedules, config.teamAbbreviations, season, now), /conflicting team snapshots/);
});

test('all followed regular and playoff games are included while preseason and unrelated clubs are excluded', () => {
  const regular = rawGame();
  const postseason = playoff();
  const preseason = rawGame(1, 'CAR', { gameType: 1 });
  const unrelated = rawGame(2, 'BOS');
  assert.deepEqual(build([regular, postseason, preseason, unrelated]).events.map(e => e.gameId).sort(), [String(regular.id), String(postseason.id)].sort());
  assert.equal(build([preseason], [], now, { ...config, includePreseason: true }).events.length, 1);
  assert.equal(build([regular], [], now, { ...config, excludeGameIds: [String(regular.id)] }).events.length, 0);
});

test('UTC start times render correctly through the Brussels/US daylight-saving transition gap', () => {
  const hour = date => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hourCycle: 'h23' }).format(new Date(date));
  const events = [
    ['2026-10-18', '01'], ['2026-10-25', '00'], ['2026-11-01', '01']
  ].map(([day, expected], index) => {
    const e = event(rawGame(index + 1, 'CAR', { gameDate: day, startTimeUTC: atEastern(day, 19) }));
    assert.equal(hour(e.start), expected);
    assert.equal(Date.parse(e.end) - Date.parse(e.start), 3 * 3600000);
    return e;
  });
  const ics = renderCalendar(stabilize(events, [], now), 'Football and Friends');
  assert.match(ics, /DTSTART:20261018T230000Z/);
  assert.match(ics, /DTSTART:20261025T230000Z/);
  assert.match(ics, /DTSTART:20261102T000000Z/);
  assert.doesNotMatch(ics, /DTSTART;TZID/);
});

for (const [state, overrides] of [
  ['TBD', { gameScheduleState: 'TBD' }],
  ['PPD', { gameScheduleState: 'PPD' }],
  ['no announced time', { startTimeUTC: undefined }]
]) test(`${state} keeps the official date as a transparent all-day marker`, () => {
  const e = event(rawGame(1, 'CAR', { gameDate: '2026-10-07', startTimeUTC: '2026-10-08T02:00:00Z', ...overrides }));
  assert.equal(e.allDay, true);
  assert.equal(e.start, '2026-10-07');
  assert.equal(e.end, '2026-10-08');
  assert.equal(e.status, 'TENTATIVE');
  const ics = renderCalendar(stabilize([e], [], now), 'Football and Friends');
  assert.match(ics, /DTSTART;VALUE=DATE:20261007/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
  assert.doesNotMatch(ics, /DTSTART:20261008T020000Z/);
});

test('a cancelled schedule overrides a FUT game state and cancels the same UID', () => {
  const original = rawGame();
  const first = stabilize([event(original)], [], now)[0];
  const cancelled = rawGame(1, 'CAR', { gameScheduleState: 'CNCL', gameState: 'FUT' });
  const next = stabilize(build([cancelled], [first]).events, [first], '2026-10-02T10:00:00Z')[0];
  assert.equal(next.uid, first.uid);
  assert.equal(next.status, 'CANCELLED');
  assert.equal(next.sequence, first.sequence + 1);
  assert.match(renderCalendar([next], 'Football and Friends'), /STATUS:CANCELLED\r\nTRANSP:TRANSPARENT/);
});

test('announced times and rescheduling update one official game UID', () => {
  const unknown = rawGame(1, 'CAR', { gameScheduleState: 'TBD' });
  const first = stabilize(build([unknown]).events, [], now)[0];
  const confirmed = { ...unknown, gameScheduleState: 'OK', startTimeUTC: '2026-10-04T23:30:00Z' };
  const second = stabilize(build([confirmed], [first]).events, [first], '2026-10-02T10:00:00Z')[0];
  const rescheduled = { ...confirmed, gameDate: '2026-10-05', startTimeUTC: '2026-10-06T00:00:00Z' };
  const third = stabilize(build([rescheduled], [second]).events, [second], '2026-10-03T10:00:00Z')[0];
  assert.equal(first.uid, `nhl-${unknown.id}@football-watchlist`);
  assert.equal(second.uid, first.uid);
  assert.equal(third.uid, first.uid);
  assert.equal(third.created, first.created);
  assert.equal(second.sequence, 1);
  assert.equal(third.sequence, 2);
  assert.equal(third.start, '2026-10-06T00:00:00.000Z');
});

test('an unchanged snapshot keeps modification times and sequences stable', () => {
  const games = [rawGame(), playoff()];
  const first = stabilize(build(games).events, [], now);
  const second = stabilize(build(games, first).events, first, '2026-10-01T16:00:00Z');
  assert.deepEqual(second, first);
});

test('missing future games are retained with a warning instead of being mistaken for cancellations', () => {
  const first = stabilize(build([rawGame(), playoff()]).events, [], now);
  const missing = build([], first, '2026-10-02T10:00:00Z');
  assert.equal(missing.events.length, 2);
  assert.equal(missing.warnings.length, 2);
  assert.deepEqual(stabilize(missing.events, first, '2026-10-02T10:00:00Z'), first);
});

test('an authoritative earlier clincher cancels the missing optional game, including after its date passed', () => {
  const optional = playoff(7);
  const first = stabilize(build([optional]).events, [], now);
  const clincher = playoff(5, { gameState: 'OFF',
    seriesStatus: { ...optional.seriesStatus, gameNumberOfSeries: 5, topSeedWins: 4, bottomSeedWins: 1 } });
  for (const at of ['2027-04-26T10:00:00Z', '2027-04-29T10:00:00Z']) {
    const result = build([clincher], first, at);
    const cancelled = result.events.find(e => e.uid === first[0].uid);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(stabilize([cancelled], first, at)[0].sequence, 1);
    assert.match(renderCalendar(stabilize([cancelled], first, at), 'Football and Friends'), /STATUS:CANCELLED\r\nTRANSP:TRANSPARENT/);
  }
});

for (const [caseName, mutate] of [
  ['not final', raw => { raw.gameState = 'FUT'; }],
  ['not won', raw => { raw.seriesStatus.topSeedWins = 3; }],
  ['different series', raw => { raw.seriesStatus.seriesLetter = 'B'; }],
  ['missing game number', raw => { raw.seriesStatus.gameNumberOfSeries = null; }],
  ['zero game number', raw => { raw.seriesStatus.gameNumberOfSeries = 0; }],
  ['later game number', raw => { raw.seriesStatus.gameNumberOfSeries = 8; }]
]) test(`optional game remains when the supposed clincher is ${caseName}`, () => {
  const optional = playoff(7);
  const first = stabilize(build([optional]).events, [], now);
  const other = playoff(5, { gameState: 'OFF', seriesStatus: { ...optional.seriesStatus, gameNumberOfSeries: 5, topSeedWins: 4, bottomSeedWins: 1 } });
  mutate(other);
  const result = build([other], first, '2027-04-26T10:00:00Z');
  const retained = result.events.find(e => e.uid === first[0].uid);
  assert.equal(retained.status, first[0].status);
  assert.deepEqual(stabilize([retained], first, '2027-04-26T10:00:00Z')[0], first[0]);
  assert.ok(result.warnings.some(w => w.includes(String(optional.id))));
});

test('outage retention strips generated metadata while preserving every NHL event unchanged', () => {
  const published = stabilize(build([rawGame(), playoff()]).events, [], now);
  const football = { ...published[0], uid: 'nfl-example@football-watchlist', categories: ['NFL'] };
  const retained = retainHockeyEvents([...published, football]);
  assert.equal(retained.length, published.length);
  for (const e of retained) for (const key of ['hash', 'created', 'modified', 'sequence']) assert.equal(Object.hasOwn(e, key), false);
  const retry = stabilize(retained, published, '2026-10-02T10:00:00Z');
  assert.deepEqual(retry, published);
  assert.deepEqual(stabilize(retainHockeyEvents(retry), retry, '2026-10-03T10:00:00Z'), published);
});

test('temporary incomplete responses retry all clubs before returning a complete snapshot', async () => {
  const schedules = sharedSchedules();
  const calls = [], delays = [];
  let carRequests = 0;
  const result = await fetchHockeySchedules(config.teamAbbreviations, season, now, {
    fetchImpl: async url => {
      const abbreviation = new URL(url).pathname.split('/').at(-2);
      calls.push(abbreviation);
      const payload = structuredClone(schedules[abbreviation]);
      if (abbreviation === 'CAR' && ++carRequests === 1) payload.games.pop();
      return { ok: true, text: async () => JSON.stringify(payload) };
    },
    sleep: async milliseconds => { delays.push(milliseconds); }
  });
  assert.equal(result.games.length, 166);
  assert.equal(calls.filter(c => c === 'CAR').length, 2);
  assert.equal(calls.filter(c => c === 'SJS').length, 2);
  assert.deepEqual(delays, [1000]);
});

test('a persistent failed club response never returns a partial followed-team season', async () => {
  const delays = [];
  let failures = 0;
  await assert.rejects(fetchHockeySchedules(config.teamAbbreviations, season, now, {
    fetchImpl: async url => url.includes('/SJS/')
      ? (++failures, { ok: false, status: 503 })
      : { ok: true, text: async () => JSON.stringify(schedule()) },
    sleep: async milliseconds => { delays.push(milliseconds); }
  }), /after 3 attempts.*SJS.*503/);
  assert.equal(failures, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

const cachedSchedules = Object.fromEntries(['CAR', 'SJS'].flatMap(abbreviation => {
  const file = new URL(`./.cache/nhl-research-${abbreviation}.json`, import.meta.url);
  return fs.existsSync(file) ? [[abbreviation, JSON.parse(fs.readFileSync(file, 'utf8'))]] : [];
}));
test('current source snapshots contain 84 games per club and 166 unique regular-season games', { skip: !cachedSchedules.CAR || !cachedSchedules.SJS }, () => {
  const data = validateHockeySchedules(cachedSchedules, config.teamAbbreviations, season, now);
  assert.equal(data.counts.CAR.regular, 84);
  assert.equal(data.counts.SJS.regular, 84);
  const events = buildHockeyEvents(data, config, now).events;
  assert.equal(events.filter(e => e.nhlGameType === 2).length, 166);
  assert.equal(events.some(e => e.nhlGameType === 1), false);
});
