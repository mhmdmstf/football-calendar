import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  atEastern, etDay, etParts, normalize, gameEvent, nflReasons,
  selectCollege, stabilize, renderCalendar, foldLine
} from './calendar.mjs';

const now = '2026-09-05T10:00:00.000Z';
const config = {
  favoriteCollegeTeamIds: ['333'], nationalGamesPerWeek: 2,
  selectionHorizonDays: 21, includeGameIds: [], excludeGameIds: [],
  rivalries: [{ teams: ['194', '130'], name: 'The Game' }]
};

function rawEvent(overrides = {}) {
  const competition = {
    timeValid: true,
    competitors: [
      { homeAway: 'away', team: { id: '1', displayName: 'Away Team', location: 'Away' } },
      { homeAway: 'home', team: { id: '2', displayName: 'Home Team', location: 'Home' } }
    ],
    venue: { fullName: 'Stadium', address: { city: 'City', country: 'USA' } },
    status: { type: { name: 'STATUS_SCHEDULED' } }, broadcasts: [], notes: [],
    ...overrides.competition
  };
  const { competition: ignored, ...event } = overrides;
  return { id: '100', date: '2026-09-06T17:00Z', season: { year: 2026, type: 2 },
    week: { number: 1 }, ...event, competitions: [competition] };
}

function game(overrides = {}) {
  return { ...normalize(rawEvent(), 'college-football'), ...overrides };
}

function ranked(id, ranks, overrides = {}) {
  const teams = ranks.map((rank, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, short: `${id}-${i}`, rank, side: i ? 'home' : 'away' }));
  return game({ id, teams, away: teams[0], home: teams[1], ...overrides });
}

test('Eastern afternoon windows follow US DST, including the Europe/US transition gap', () => {
  assert.equal(atEastern('2026-09-13', 13), '2026-09-13T17:00:00.000Z');
  assert.equal(atEastern('2026-10-25', 13), '2026-10-25T17:00:00.000Z');
  assert.equal(atEastern('2026-11-01', 13), '2026-11-01T18:00:00.000Z');
  assert.equal(atEastern('2027-01-10', 20), '2027-01-11T01:00:00.000Z');
  const localHour = (date, timeZone) => new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(date));
  assert.equal(localHour(atEastern('2026-10-18', 13), 'Europe/Brussels'), '19');
  assert.equal(localHour(atEastern('2026-10-25', 13), 'Europe/Brussels'), '18');
  assert.equal(localHour(atEastern('2026-11-01', 13), 'Europe/Brussels'), '19');
});

test('late US games retain their US schedule day', () => {
  assert.equal(etDay('2026-09-08T00:15:00Z'), '2026-09-07');
  assert.equal(etParts('2026-09-08T00:15:00Z').weekday, 'Mon');
});

test('unannounced and flex kickoffs produce transparent tentative all-day markers', () => {
  for (const competition of [{ timeValid: false }, { timeValid: true, status: { isTBDFlex: true } }]) {
    const g = normalize(rawEvent({ date: '2026-11-07T05:00Z', competition }), 'college-football');
    const e = gameEvent(g, ['Favorite team']);
    assert.equal(e.allDay, true);
    assert.equal(e.start, '2026-11-07');
    assert.equal(e.end, '2026-11-08');
    assert.equal(e.status, 'TENTATIVE');
    assert.match(e.title, /\[time TBA\]/);
    const ics = renderCalendar(stabilize([e], [], now), 'Watchlist');
    assert.match(ics, /DTSTART;VALUE=DATE:20261107\r\n/);
    assert.match(ics, /DTEND;VALUE=DATE:20261108\r\n/);
    assert.match(ics, /TRANSP:TRANSPARENT\r\n/);
    assert.doesNotMatch(ics, /DTSTART:20261107T050000Z/);
  }
});

test('a confirmed kickoff replaces its placeholder under the same UID', () => {
  const placeholder = gameEvent(normalize(rawEvent({ date: '2026-09-06T04:00Z', competition: { timeValid: false } }), 'college-football'), ['Favorite']);
  const first = stabilize([placeholder], [], now)[0];
  const confirmed = gameEvent(normalize(rawEvent({ date: '2026-09-06T17:00Z' }), 'college-football'), ['Favorite']);
  const next = stabilize([confirmed], [first], '2026-09-06T10:00:00.000Z')[0];
  assert.equal(next.uid, first.uid);
  assert.equal(next.created, first.created);
  assert.equal(next.sequence, 1);
  assert.equal(next.allDay, false);
  assert.equal(next.start, '2026-09-06T17:00:00.000Z');
  assert.equal(next.end, '2026-09-06T20:30:00.000Z');
});

test('unchanged refreshes preserve modification timestamps and sequences; time changes increment once', () => {
  const e = gameEvent(game(), ['National pick']);
  const first = stabilize([e], [], now)[0];
  const unchanged = stabilize([e], [first], '2026-09-05T16:00:00.000Z')[0];
  assert.deepEqual(unchanged, first);
  const moved = { ...e, start: '2026-09-06T20:00:00.000Z', end: '2026-09-06T23:30:00.000Z' };
  const changed = stabilize([moved], [first], '2026-09-05T18:00:00.000Z')[0];
  assert.equal(changed.uid, first.uid);
  assert.equal(changed.created, first.created);
  assert.equal(changed.sequence, first.sequence + 1);
  assert.equal(changed.modified, '2026-09-05T18:00:00.000Z');
  assert.deepEqual(stabilize([moved], [changed], '2026-09-06T10:00:00.000Z')[0], changed);
});

test('cancelled games remain cancelled even when their kickoff is unknown', () => {
  const e = gameEvent(normalize(rawEvent({ competition: { timeValid: false, status: { type: { name: 'STATUS_CANCELED' } } } }), 'nfl'), ['Thursday']);
  assert.equal(e.status, 'CANCELLED');
  assert.match(renderCalendar(stabilize([e], [], now), 'Watchlist'), /STATUS:CANCELLED\r\nTRANSP:TRANSPARENT/);
});

test('NFL selects Monday/Thursday/Sunday nights and international games using US dates', () => {
  const g = game({ league: 'nfl' });
  assert.deepEqual(nflReasons({ ...g, date: '2026-09-08T00:15:00Z' }), ['Monday Night Football.']);
  assert.deepEqual(nflReasons({ ...g, date: '2026-09-11T00:15:00Z' }), ['Thursday football, including Thanksgiving.']);
  assert.deepEqual(nflReasons({ ...g, date: '2026-09-07T00:20:00Z' }), ['Sunday Night Football.']);
  assert.deepEqual(nflReasons({ ...g, date: '2026-09-06T17:00:00Z' }), []);
  assert.deepEqual(nflReasons({ ...g, date: '2026-09-06T13:30:00Z', country: 'England' }), ['International game: England.']);
  assert.equal(nflReasons({ ...g, date: '2026-09-11T00:15:00Z', country: 'Australia' }).length, 2);
});

test('NFL excludes preseason, Pro Bowl and unknown Sunday prime-time placeholders', () => {
  const g = game({ league: 'nfl', date: '2026-09-11T00:15:00Z' });
  assert.deepEqual(nflReasons({ ...g, seasonType: 1 }), []);
  assert.deepEqual(nflReasons({ ...g, seasonType: 3, notes: 'Pro Bowl Games' }), []);
  assert.deepEqual(nflReasons({ ...g, timeKnown: false, date: '2026-09-07T00:20:00Z' }), []);
  assert.deepEqual(nflReasons({ ...g, seasonType: 3, timeKnown: false, notes: 'Wild Card Playoffs' }), ['NFL playoffs: every postseason game.']);
});

test('favorite teams, rivalries, featured games, overrides, championships and CFP survive the horizon', () => {
  const distant = '2026-11-28T05:00Z';
  const games = [
    game({ id: 'bama', date: distant, teams: [{ id: '333' }, { id: '2' }] }),
    game({ id: 'rivalry', date: distant, teams: [{ id: '130' }, { id: '194' }] }),
    game({ id: 'feature', date: distant }),
    game({ id: 'manual', date: distant }),
    game({ id: 'conf', date: distant, notes: 'SEC Championship' }),
    game({ id: 'cfp', date: distant, seasonType: 3, notes: 'College Football Playoff First Round Game' }),
    game({ id: 'bowl', date: distant, seasonType: 3, notes: 'Frisco Bowl' })
  ];
  const selected = selectCollege(games, { ...config, includeGameIds: ['manual'] }, ['feature'], now);
  assert.deepEqual([...selected.keys()].sort(), ['bama', 'cfp', 'conf', 'feature', 'manual', 'rivalry']);
});

test('explicit college exclusions beat every automatic and manual reason', () => {
  const g = game({ id: 'excluded', teams: [{ id: '333' }, { id: '2' }], notes: 'College Football Playoff' });
  assert.equal(selectCollege([g], { ...config, excludeGameIds: ['excluded'], includeGameIds: ['excluded'] }, ['excluded'], now).size, 0);
});

test('college shortlist favors ranked pairs, accepts close upset possibilities, and rejects weak/no-evidence games', () => {
  const games = [
    ranked('top', [1, 2]), ranked('other-ranked', [10, 12]),
    ranked('upset', [5, null], { spread: 3 }),
    ranked('mismatch', [1, null], { spread: 28 }),
    ranked('unknown-spread', [1, null]), ranked('unranked', [null, null], { spread: 1 }),
    ranked('past', [1, 2], { date: '2026-09-04T17:00Z' }),
    ranked('distant', [1, 2], { date: '2026-10-17T17:00Z' })
  ];
  assert.deepEqual([...selectCollege(games, config, [], now).keys()], ['top', 'other-ranked']);
  assert.deepEqual([...selectCollege(games, { ...config, nationalGamesPerWeek: 3 }, [], now).keys()], ['top', 'other-ranked', 'upset']);
});

test('favorites do not consume the national shortlist allowance and multi-reason games are unique', () => {
  const bama = ranked('bama', [1, 2]); bama.teams[0].id = '333';
  const games = [bama, ranked('top', [2, 3]), ranked('second', [4, 5])];
  const selected = selectCollege(games, config, ['bama'], now);
  assert.equal(selected.size, 3);
  assert.equal(selected.get('bama').length, 2);
});

test('postseason week numbers cannot consume a regular-season national shortlist allowance', () => {
  const games = [
    game({ id: 'cfp1', seasonType: 3, week: 1, date: '2026-12-19T01:00Z', notes: 'College Football Playoff First Round Game' }),
    game({ id: 'cfp2', seasonType: 3, week: 1, date: '2026-12-19T17:00Z', notes: 'College Football Playoff First Round Game' }),
    ranked('regular1', [2, 3], { week: 1 }),
    ranked('regular2', [4, 5], { week: 1 })
  ];
  const selected = selectCollege(games, config, [], now);
  assert.deepEqual([...selected.keys()].sort(), ['cfp1', 'cfp2', 'regular1', 'regular2']);
});

test('NFL matchup titles distinguish the Jets/Giants and Rams/Chargers', () => {
  const e = gameEvent(game({ league: 'nfl',
    away: { name: 'New York Jets', short: 'New York' },
    home: { name: 'Los Angeles Chargers', short: 'Los Angeles' }
  }), ['Sunday Night Football.']);
  assert.match(e.title, /New York Jets at Los Angeles Chargers/);
});

test('previous national picks stay selected after rankings or odds change', () => {
  const prior = { gameId: 'retained', categories: ['College', 'National pick'], selectionReason: 'National pick: ranked matchup at selection.' };
  const selected = selectCollege([ranked('retained', [null, null], { date: '2026-11-01T17:00Z' })], config, [], now, [prior]);
  assert.deepEqual(selected.get('retained'), [prior.selectionReason]);
});

test('iCalendar uses CRLF and folds unicode text without exceeding 75 octets', () => {
  const text = `DESCRIPTION:${'College, football; é🏈\\\n'.repeat(20)}`;
  const folded = foldLine(text);
  assert.equal(folded.replace(/\r\n /g, ''), text);
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const e = gameEvent(game(), ['Rivalry, playoff; line\nsecond line']);
  const ics = renderCalendar(stabilize([e], [], now), 'Football, Worth Watching');
  assert.match(ics, /X-WR-CALNAME:Football\\, Worth Watching/);
  assert.match(ics, /Rivalry\\, playoff\\; line\\nsecond line/);
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.equal(ics.match(/END:VEVENT/g).length, 1);
});

const readOptional = path => fs.existsSync(new URL(path, import.meta.url)) ? JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8')) : null;
const cachedNfl = readOptional('./.cache/nfl.json');
const cachedCollege = readOptional('./.cache/college-football.json');
const has2026Caches = cachedNfl?.events?.some(e => e.season?.year === 2026) && cachedCollege?.events?.some(e => e.season?.year === 2026);

test('2026 source snapshot contains all 12 Alabama games, 9 NFL international games and both complete playoffs', { skip: !has2026Caches }, () => {
  const nfl = cachedNfl.events.map(e => normalize(e, 'nfl')).filter(g => g.season === 2026);
  const college = cachedCollege.events.map(e => normalize(e, 'college-football')).filter(g => g.season === 2026);
  const favorites = college.filter(g => g.seasonType === 2 && g.teams.some(t => t.id === '333'));
  assert.equal(favorites.length, 12);
  const selected = selectCollege(college, config, [], now);
  for (const g of favorites) assert.ok(selected.has(g.id), `Missing Alabama game ${g.id}`);
  const international = nfl.filter(g => nflReasons(g).some(r => r.startsWith('International game:')));
  assert.equal(international.length, 9);
  assert.equal(nfl.filter(g => g.seasonType === 3 && nflReasons(g).length).length, 13);
  assert.equal(college.filter(g => /college football playoff/i.test(g.notes) && selected.has(g.id)).length, 11);
  assert.equal(new Set(nfl.filter(g => g.seasonType === 2 && etParts(g.date).weekday === 'Sun').map(g => g.day)).size, 18);
  assert.ok(nfl.filter(g => g.seasonType === 1).every(g => nflReasons(g).length === 0));
});

const state = readOptional('./state.json');
test('early-season generated 2026 feed contains the requested complete sets without duplicate UIDs', { skip: state?.season !== 2026 || state.checkedOn > '2026-10-01' }, () => {
  const events = state.events;
  assert.equal(new Set(events.map(e => e.uid)).size, events.length);
  assert.equal(events.filter(e => e.categories.includes('Alabama')).length, 12);
  assert.equal(events.filter(e => e.categories.includes('RedZone')).length, 18);
  assert.equal(events.filter(e => e.categories.includes('NFL') && e.categories.includes('Playoffs')).length, 13);
  assert.equal(events.filter(e => e.categories.includes('College') && e.categories.includes('Playoffs')).length, 11);
  assert.equal(events.filter(e => e.categories.includes('NFL') && e.description.includes('International game:')).length, 9);
  assert.ok(events.every(e => Date.parse(e.end) > Date.parse(e.start)), 'Every viewing window has positive duration');
});
