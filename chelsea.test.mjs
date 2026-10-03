import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  chelseaSeason, normalizeChelseaGame, validateChelseaSchedules, fetchChelseaSchedules,
  chelseaEvent, buildChelseaEvents, retainChelseaEvents
} from './chelsea.mjs';
import { renderCalendar, stabilize } from './calendar.mjs';

const now = '2026-10-03T10:00:00.000Z';
const season = 2026;
const config = { enabled: true, includeFriendlies: false, excludeGameIds: [] };
function rawGame(index = 1, options = {}) {
  const date = new Date(Date.UTC(season, 7, 22 + (index - 1) * 7, 14));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  }).formatToParts(date).map(p => [p.type, p.value]));
  return {
    id: `content-${index}`, optaId: String(2600000 + index),
    kickoffDate: `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`,
    kickoffTime: '15:00', tbc: false, postponed: false, isResult: false, isLive: false, status: 'PreMatch',
    competition: 'Premier League', venue: 'Stamford Bridge',
    matchUp: { home: { clubName: 'Chelsea' }, away: { clubName: 'Liverpool' },
      status: 'PreMatch', tbc: false, postponed: false, isResult: false, isLive: false },
    ctas: { matchCentreLink: { url: `/en/match/chelsea-liverpool-${index}` } }, ...options
  };
}
function payload(events = [], withSeason = false) {
  return { ...(withSeason ? { seasons: [{ displayText: '2026/27', selectedValue: true }] } : {}),
    competitions: [{ displayText: 'All Competitions', selectedValue: true }],
    items: [{ month: 10, year: season, items: events }] };
}
function schedules(count = 38) {
  const games = Array.from({ length: count }, (_, index) => rawGame(index + 1));
  return { results: payload(games.slice(0, 5), true), fixtures: payload(games.slice(5)) };
}
const normalized = raw => normalizeChelseaGame(raw);
const build = (games, previous = [], at = now, settings = config) =>
  buildChelseaEvents({ season, games: games.map(normalized) }, settings, at, previous);
const event = (raw, at = now) => chelseaEvent(normalized(raw), at);
const response = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });

test('Chelsea season rolls over in August, after the next league schedule is published', () => {
  assert.equal(chelseaSeason('2026-07-31T23:59:59Z'), 2025);
  assert.equal(chelseaSeason('2026-08-01T00:00:00Z'), 2026);
  assert.equal(chelseaSeason('2027-01-01T00:00:00Z'), 2026);
  assert.equal(chelseaSeason('2027-07-31T23:59:59Z'), 2026);
  assert.equal(chelseaSeason('2027-08-01T00:00:00Z'), 2027);
  assert.throws(() => chelseaSeason('not a date'), /invalid/i);
});

test('the results and fixtures union must contain all 38 Premier League matches', () => {
  const data = validateChelseaSchedules(schedules(), season, now);
  assert.equal(data.games.length, 38);
  assert.equal(data.counts.premierLeague, 38);
  assert.equal(data.counts.competitive, 38);
  for (const count of [0, 5, 37, 39]) {
    assert.throws(() => validateChelseaSchedules(schedules(count), season, now), /Chelsea:/);
  }
});

for (const [name, mutate] of [
  ['missing fixtures payload', data => { delete data.fixtures; }],
  ['wrong response season', data => { data.results.seasons[0].displayText = '2025/26'; }],
  ['wrong event season', data => { data.fixtures.items[0].items[0].kickoffDate = 'Sat 05 Oct 2024'; }],
  ['wrong match team', data => { data.fixtures.items[0].items[0].matchUp.home.clubName = 'Arsenal'; }],
  ['duplicate replacing a missing fixture', data => { data.fixtures.items[0].items[1] = structuredClone(data.fixtures.items[0].items[0]); }],
  ['malformed kickoff', data => { data.fixtures.items[0].items[0].kickoffDate = 'later'; }]
]) test(`Chelsea source validation rejects ${name}`, () => {
  const data = schedules();
  mutate(data);
  assert.throws(() => validateChelseaSchedules(data, season, now), /Chelsea:/);
});

test('identical results/fixtures overlap creates one match and conflicting kickoff snapshots reject', () => {
  const data = schedules();
  data.results.items[0].items.push(structuredClone(data.fixtures.items[0].items[0]));
  const valid = validateChelseaSchedules(data, season, now);
  assert.equal(valid.games.length, 38);
  assert.equal(new Set(valid.games.map(g => g.id)).size, 38);
  data.results.items[0].items.at(-1).kickoffDate = 'Thu 01 Oct 2026';
  assert.throws(() => validateChelseaSchedules(data, season, now), /conflict/i);
});

test('latestResult.fixture fills the result omitted from the monthly results list', () => {
  const data = schedules();
  const latest = data.results.items[0].items.pop();
  data.results.latestResult = { fixture: { ...latest, isResult: true, status: 'PostMatch' } };
  const validated = validateChelseaSchedules(data, season, now);
  assert.equal(validated.games.length, 38);
  assert.ok(validated.games.some(g => g.id === latest.optaId && g.finished));
  data.results.items[0].items.push(structuredClone(data.results.latestResult.fixture));
  assert.equal(validateChelseaSchedules(data, season, now).games.length, 38);
});

test('a match moving from fixtures to results remains one event with the finished status', () => {
  const data = schedules();
  const scheduled = data.fixtures.items[0].items[0];
  data.results.latestResult = { fixture: { ...structuredClone(scheduled), isResult: true, status: 'PostMatch' } };
  const validated = validateChelseaSchedules(data, season, now);
  assert.equal(validated.games.length, 38);
  assert.equal(validated.games.find(g => g.id === scheduled.optaId).finished, true);
});

test('all announced competitive fixtures are included while friendlies and excluded IDs are omitted', () => {
  const raw = ['Premier League', 'FA Cup', 'Carabao Cup', 'UEFA Champions League', 'Friendly']
    .map((competition, i) => rawGame(10 + i, { competition }));
  const selected = build(raw).events;
  assert.deepEqual(selected.map(e => e.gameId).sort(), raw.slice(0, 4).map(g => g.optaId).sort());
  assert.equal(build(raw, [], now, { ...config, includeFriendlies: true }).events.length, 5);
  assert.equal(build(raw, [], now, { ...config, excludeGameIds: [raw[0].optaId] }).events.length, 3);
  assert.ok(selected.every(e => e.categories.includes('Chelsea') && e.categories.includes('Soccer')));
  assert.equal(build([]).events.length, 0, 'No competition placeholders should be fabricated');
});

test('named preseason tournaments are treated as friendlies even when their match URL omits that word', () => {
  const preseason = ['Sydney Super Cup', 'Florida Cup', 'Premier League Summer Series']
    .map((competition, index) => rawGame(20 + index, { competition }));
  assert.equal(build(preseason).events.length, 0);
  assert.equal(build(preseason, [], now, { ...config, includeFriendlies: true }).events.length, 3);
});

test('UTC kickoff times preserve UK/Brussels daylight saving and use estimated viewing windows', () => {
  const localHour = (date, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(date));
  const summer = event(rawGame(10, { kickoffDate: 'Sat 24 Oct 2026', kickoffTime: '15:00' }));
  const winter = event(rawGame(11, { kickoffDate: 'Sat 31 Oct 2026', kickoffTime: '15:00' }));
  for (const e of [summer, winter]) {
    assert.equal(localHour(e.start, 'Europe/London'), '15');
    assert.equal(localHour(e.start, 'Europe/Brussels'), '16');
    assert.equal(Date.parse(e.end) - Date.parse(e.start), 2 * 3600000);
    assert.equal(e.status, 'CONFIRMED');
    assert.doesNotMatch(e.title, /provisional|TBC/i);
  }
  const cup = event(rawGame(12, { competition: 'FA Cup' }));
  assert.equal(Date.parse(cup.end) - Date.parse(cup.start), 2.5 * 3600000);
  const ics = renderCalendar(stabilize([summer, winter], [], now), 'Football and Friends');
  assert.match(ics, /DTSTART:20261024T140000Z/);
  assert.match(ics, /DTSTART:20261031T150000Z/);
  assert.doesNotMatch(ics, /DTSTART;TZID/);
});

test('confirmed UK times near midnight convert to the preceding UTC day', () => {
  const e = event(rawGame(10, { kickoffDate: 'Sun 11 Oct 2026', kickoffTime: '00:30' }));
  assert.equal(e.allDay, false);
  assert.equal(e.start, '2026-10-10T23:30:00.000Z');
  assert.equal(normalized(rawGame(10, { kickoffDate: 'Fri 18 Sept 2026' })).day, '2026-09-18');
});

for (const [name, options] of [
  ['unknown date/time', { tbc: true }],
  ['postponed', { postponed: true }]
]) test(`${name} retains the UK calendar date as an all-day transparent marker`, () => {
  const e = event(rawGame(10, { kickoffDate: 'Sun 11 Oct 2026', kickoffTime: '00:30', ...options }));
  assert.equal(e.allDay, true);
  assert.equal(e.start, '2026-10-11');
  assert.equal(e.end, '2026-10-12');
  assert.equal(e.status, 'TENTATIVE');
  const ics = renderCalendar(stabilize([e], [], now), 'Football and Friends');
  assert.match(ics, /DTSTART;VALUE=DATE:20261011/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
});

test('a real cancellation updates the same UID and makes the event transparent', () => {
  const raw = rawGame(10);
  const first = stabilize(build([raw]).events, [], now)[0];
  const cancelled = rawGame(10, { status: 'Cancelled' });
  const next = stabilize(build([cancelled], [first]).events, [first], '2026-10-04T10:00:00Z')[0];
  assert.equal(next.uid, first.uid);
  assert.equal(next.status, 'CANCELLED');
  assert.equal(next.sequence, first.sequence + 1);
  assert.match(renderCalendar([next], 'Football and Friends'), /STATUS:CANCELLED\r\nTRANSP:TRANSPARENT/);
});

test('announced times and rescheduling revise the original event without duplicate calendar entries', () => {
  const first = stabilize(build([rawGame(10, { tbc: true })]).events, [], now)[0];
  const second = stabilize(build([rawGame(10)], [first]).events, [first], '2026-10-04T10:00:00Z')[0];
  const third = stabilize(build([rawGame(10, { kickoffDate: 'Mon 02 Nov 2026', kickoffTime: '20:00' })], [second]).events, [second], '2026-10-05T10:00:00Z')[0];
  assert.equal(first.uid, `chelsea-${2600010}@football-watchlist`);
  assert.equal(second.uid, first.uid);
  assert.equal(third.uid, first.uid);
  assert.equal(third.created, first.created);
  assert.equal(second.sequence, 1);
  assert.equal(third.sequence, 2);
  assert.equal(third.start, '2026-11-02T20:00:00.000Z');
});

test('unchanged snapshots retain modification metadata and completed matches remain confirmed', () => {
  const raw = [rawGame(10), rawGame(11, { competition: 'FA Cup' })];
  const first = stabilize(build(raw).events, [], now);
  assert.deepEqual(stabilize(build(raw, first).events, first, '2026-10-03T16:00:00Z'), first);
  const finished = event(rawGame(1, { kickoffDate: 'Tue 01 Sept 2026', kickoffTime: '20:00',
    status: 'PostMatch', isResult: true }));
  assert.equal(finished.status, 'CONFIRMED');
  assert.doesNotMatch(finished.title, /provisional/i);
});

test('missing future fixtures remain unchanged with a warning instead of being cancelled', () => {
  const first = stabilize(build([rawGame(10), rawGame(11, { competition: 'FA Cup' })]).events, [], now);
  const missing = build([], first, '2026-10-04T10:00:00Z');
  assert.equal(missing.events.length, 2);
  assert.ok(missing.warnings.length > 0);
  assert.deepEqual(stabilize(missing.events, first, '2026-10-04T10:00:00Z'), first);
});

test('outage retention strips generated metadata and preserves only Chelsea events without churn', () => {
  const published = stabilize(build([rawGame(10), rawGame(11, { competition: 'FA Cup' })]).events, [], now);
  const hockey = { ...published[0], uid: 'nhl-example@football-watchlist', categories: ['NHL'] };
  const retained = retainChelseaEvents([...published, hockey]);
  assert.equal(retained.length, published.length);
  for (const e of retained) for (const key of ['hash', 'created', 'modified', 'sequence']) {
    assert.equal(Object.hasOwn(e, key), false);
  }
  const retry = stabilize(retained, published, '2026-10-04T10:00:00Z');
  assert.deepEqual(retry, published);
  assert.deepEqual(stabilize(retainChelseaEvents(retry), retry, '2026-10-05T10:00:00Z'), published);
});

test('a truncated source snapshot retries both endpoints and succeeds only on a full season', async () => {
  const data = schedules();
  const calls = [], delays = [];
  let fixtureRequests = 0;
  const result = await fetchChelseaSchedules(season, now, {
    fetchImpl: async url => {
      const fixtures = new URL(url).pathname.includes('upcoming');
      calls.push(fixtures ? 'fixtures' : 'results');
      const result = structuredClone(fixtures ? data.fixtures : data.results);
      if (fixtures && ++fixtureRequests === 1) result.items[0].items.pop();
      return response(result);
    },
    sleep: async milliseconds => { delays.push(milliseconds); },
    warn: () => {}
  });
  assert.equal(result.games.length, 38);
  assert.equal(calls.filter(c => c === 'fixtures').length, 2);
  assert.equal(calls.filter(c => c === 'results').length, 2);
  assert.deepEqual(delays, [1000]);
});

test('persistent source failures reject rather than returning a partial Chelsea schedule', async () => {
  const data = schedules();
  const delays = [];
  let failures = 0;
  await assert.rejects(fetchChelseaSchedules(season, now, {
    fetchImpl: async url => new URL(url).pathname.includes('upcoming')
      ? (++failures, { ok: false, status: 503 })
      : response(data.results),
    sleep: async milliseconds => { delays.push(milliseconds); },
    warn: () => {}
  }), /after 3 attempts.*503/);
  assert.equal(failures, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

const cached = Object.fromEntries([
  ['results', 'results'], ['fixtures', 'upcoming']
].flatMap(([key, name]) => {
  const file = new URL(`./.cache/chelsea-research-${name}.json`, import.meta.url);
  return fs.existsSync(file) ? [[key, JSON.parse(fs.readFileSync(file, 'utf8'))]] : [];
}));
test('real October 2026 club snapshots contain every league game plus announced cup fixtures', {
  skip: !cached.results || !cached.fixtures
}, () => {
  const data = validateChelseaSchedules(cached, season, now);
  assert.equal(data.counts.premierLeague, 38);
  assert.ok(data.games.some(g => /Carabao Cup/i.test(g.competition.name)));
  const events = buildChelseaEvents(data, config, now).events;
  assert.equal(new Set(events.map(e => e.uid)).size, events.length);
  assert.equal(events.some(e => /friendly/i.test(e.chelseaCompetition)), false);
});
