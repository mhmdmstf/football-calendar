import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSeasonSchedule, seasonWeeks } from './schedules.mjs';

const season = 2026;
const offseason = '2026-04-01T12:00:00Z';
const entry = (week, label = `Week ${week}`) => ({
  value: String(week), label, alternateLabel: label,
  startDate: '2026-09-06T07:00Z', endDate: '2026-09-16T06:59Z'
});
const calendar = (regular = [1, 2], postseason = [entry(1, 'Bowls'), entry(999, 'College Football Playoff')]) => [
  { value: '1', entries: [entry(1, 'Preseason')] },
  { value: '2', entries: regular.map(week => entry(week)) },
  { value: '3', entries: postseason }
];
function event(id, type = 2, week = 1, year = season) {
  return {
    id, date: type === 3 ? '2027-01-16T05:00Z' : '2026-09-13T17:00Z',
    season: { year, type }, week: { number: week },
    competitions: [{ timeValid: true, competitors: [] }]
  };
}
function page(type, week, events, weeks = calendar()) {
  return {
    season: { year: season, type }, week: { number: week },
    leagues: [{ season: { year: season }, calendar: weeks }], events
  };
}
function mock(pages, transform) {
  const calls = [], delays = [], warnings = [];
  const options = {
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      const key = `${parsed.searchParams.get('seasontype')}/${parsed.searchParams.get('week')}`;
      calls.push({ url: parsed, key, options });
      assert.ok(pages[key], `Unexpected schedule request ${key}`);
      const data = structuredClone(pages[key]);
      const override = transform ? await transform({ key, data, calls }) : undefined;
      return override || { ok: true, json: async () => data };
    },
    sleep: async ms => { delays.push(ms); },
    warn: message => { warnings.push(message); }
  };
  return { options, calls, delays, warnings };
}
function basicPages(weeks = calendar()) {
  return {
    '2/1': page(2, 1, [event('regular-1')], weeks),
    '2/2': page(2, 2, [event('regular-2', 2, 2)], weeks),
    '3/1': page(3, 1, [event('bowl', 3), event('cfp', 3)], weeks),
    '3/999': page(3, 999, [event('cfp', 3)], weeks)
  };
}

test('weekly fetch returns every regular/postseason game once, including next-calendar-year CFP games', async () => {
  const fixture = mock(basicPages());
  const result = await fetchSeasonSchedule('college-football', season, offseason, fixture.options);
  assert.deepEqual(result.games.map(g => g.id).sort(), ['bowl', 'cfp', 'regular-1', 'regular-2']);
  assert.deepEqual(result.data.events.map(e => e.id).sort(), result.games.map(g => g.id).sort());
  assert.equal(result.games.find(g => g.id === 'cfp').season, 2026);
  assert.match(result.games.find(g => g.id === 'cfp').date, /^2027-/);
  assert.deepEqual(fixture.calls.map(c => c.key).sort(), ['2/1', '2/2', '3/1', '3/999']);
  for (const { url } of fixture.calls) {
    assert.equal(url.hostname, 'site.api.espn.com');
    assert.equal(url.searchParams.get('dates'), '2026');
    assert.equal(url.searchParams.get('limit'), '500');
    assert.equal(url.searchParams.get('groups'), '80');
    assert.doesNotMatch(url.searchParams.get('dates'), /-/);
  }
});

test('NFL calendar skips preseason and Pro Bowl while retaining every advertised playoff round', async () => {
  const weeks = calendar([1, 2], [entry(1, 'Wild Card'), entry(2, 'Divisional'), entry(3, 'Conference Championship'), entry(4, 'Pro Bowl'), entry(5, 'Super Bowl')]);
  const pages = {
    '2/1': page(2, 1, [event('regular-1')], weeks),
    '2/2': page(2, 2, [event('regular-2', 2, 2)], weeks),
    ...Object.fromEntries([1, 2, 3, 5].map(week => [`3/${week}`, page(3, week, [event(`playoff-${week}`, 3, week)], weeks)]))
  };
  const fixture = mock(pages);
  const result = await fetchSeasonSchedule('nfl', season, offseason, fixture.options);
  assert.equal(result.games.length, 6);
  assert.equal(result.games.filter(g => g.seasonType === 3).length, 4);
  assert.equal(fixture.calls.some(c => c.key === '3/4' || c.key.startsWith('1/')), false);
  assert.ok(fixture.calls.every(c => !c.url.searchParams.has('groups')));
});

test('calendar enumeration deduplicates entries and recognizes an alternate Pro Bowl label', () => {
  const weeks = calendar([1, 1, 2], [{ ...entry(4, 'All-Star Event'), alternateLabel: 'Pro Bowl Games' }, entry(5, 'Super Bowl')]);
  assert.deepEqual(seasonWeeks(page(2, 1, [], weeks), 'nfl', season).map(({ type, week }) => ({ type, week })), [
    { type: 2, week: 1 }, { type: 2, week: 2 }, { type: 3, week: 5 }
  ]);
});

test('weekly requests are bounded to four concurrent pages', async () => {
  const weeks = calendar([1, 2, 3, 4, 5, 6, 7, 8, 9], [entry(1, 'Wild Card')]);
  const pages = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`2/${i + 1}`, page(2, i + 1, [event(`game-${i + 1}`, 2, i + 1)], weeks)]));
  pages['3/1'] = page(3, 1, [event('playoff', 3)], weeks);
  let active = 0, maximum = 0;
  const fixture = mock(pages, async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
  });
  const result = await fetchSeasonSchedule('nfl', season, offseason, fixture.options);
  assert.equal(result.games.length, 10);
  assert.equal(maximum, 4);
  assert.equal(active, 0);
});

test('a permanently rejected page is retried three times and rejects the entire snapshot', async () => {
  const fixture = mock(basicPages(), ({ key }) => key === '2/2' ? { ok: false, status: 400 } : undefined);
  await assert.rejects(fetchSeasonSchedule('college-football', season, offseason, fixture.options), /after 3 attempts.*Keeping published calendar unchanged.*HTTP 400/);
  const failedCalls = fixture.calls.filter(c => c.key === '2/2');
  assert.equal(failedCalls.length, 3);
  assert.deepEqual(fixture.delays, [5000, 15000]);
  assert.equal(fixture.warnings.length, 2);
  assert.equal(failedCalls[1].options.headers['Cache-Control'], 'no-cache');
  assert.equal(failedCalls[2].options.headers['Cache-Control'], 'no-cache');
});

test('a temporarily mismatched page is retried before joining the complete snapshot', async () => {
  let attempts = 0;
  const fixture = mock(basicPages(), ({ key, data }) => {
    if (key === '2/2' && ++attempts === 1) {
      data.events[0].week.number = 1;
      return { ok: true, json: async () => data };
    }
  });
  const result = await fetchSeasonSchedule('college-football', season, offseason, fixture.options);
  assert.equal(attempts, 2);
  assert.deepEqual(fixture.delays, [5000]);
  assert.equal(result.games.find(g => g.id === 'regular-2').week, 2);
  assert.equal(result.games.length, 4);
});

for (const [name, mutate] of [
  ['missing calendar', data => { delete data.leagues[0].calendar; }],
  ['wrong calendar season', data => { data.leagues[0].season.year = 2025; }],
  ['missing regular week 1', data => { data.leagues[0].calendar[1].entries = [entry(2)]; }],
  ['invalid week value', data => { data.leagues[0].calendar[1].entries.push(entry('invalid')); }]
]) test(`the seed page rejects ${name}`, async () => {
  const fixture = mock(basicPages(), ({ key, data }) => {
    if (key === '2/1') { mutate(data); return { ok: true, json: async () => data }; }
  });
  await assert.rejects(fetchSeasonSchedule('college-football', season, offseason, fixture.options), /after 3 attempts/);
  assert.deepEqual(fixture.calls.map(c => c.key), ['2/1', '2/1', '2/1']);
});

for (const [name, mutate] of [
  ['missing postseason section', data => { data.leagues[0].calendar = data.leagues[0].calendar.filter(period => period.value !== '3'); }],
  ['empty postseason week list', data => { data.leagues[0].calendar.find(period => period.value === '3').entries = []; }]
]) test(`the seed page rejects ${name} before returning a schedule without playoffs`, async () => {
  const fixture = mock(basicPages(), ({ key, data }) => {
    if (key === '2/1') { mutate(data); return { ok: true, json: async () => data }; }
  });
  await assert.rejects(fetchSeasonSchedule('college-football', season, offseason, fixture.options), /after 3 attempts.*postseason weeks are missing/);
  assert.deepEqual(fixture.calls.map(c => c.key), ['2/1', '2/1', '2/1']);
});

for (const [name, mutate] of [
  ['wrong event year', data => { data.events[0].season.year = 2025; }],
  ['wrong event season type', data => { data.events[0].season.type = 3; }],
  ['wrong event week', data => { data.events[0].week.number = 9; }],
  ['missing events', data => { delete data.events; }],
  ['a capped page', data => { data.events = Array.from({ length: 500 }, (_, i) => event(`capped-${i}`, 2, 2)); }],
  ['wrong response year', data => { data.season.year = 2025; }],
  ['wrong response season type', data => { data.season.type = 3; }],
  ['wrong response week', data => { data.week.number = 9; }],
  ['missing response season', data => { delete data.season; }],
  ['missing response week', data => { delete data.week; }]
]) test(`a subsequent page rejects ${name} without publishing a partial season`, async () => {
  const fixture = mock(basicPages(), ({ key, data }) => {
    if (key === '2/2') { mutate(data); return { ok: true, json: async () => data }; }
  });
  await assert.rejects(fetchSeasonSchedule('college-football', season, offseason, fixture.options), /after 3 attempts/);
  assert.equal(fixture.calls.filter(c => c.key === '2/2').length, 3);
});

test('an empty advertised regular week fails in-season even when the season total clears the minimum', async () => {
  const weeks = calendar([1, 2], [entry(1, 'Wild Card')]);
  weeks[1].entries[1].startDate = '2026-09-16T07:00Z';
  weeks[1].entries[1].endDate = '2026-09-23T06:59Z';
  const fixture = mock({
    '2/1': page(2, 1, Array.from({ length: 250 }, (_, i) => event(`seed-${i}`)), weeks),
    '2/2': page(2, 2, [], weeks),
    '3/1': page(3, 1, [event('playoff', 3)], weeks)
  });
  await assert.rejects(fetchSeasonSchedule('nfl', season, '2026-09-16T12:00:00Z', fixture.options), /after 3 attempts/);
  assert.equal(fixture.calls.filter(c => c.key === '2/2').length, 3);
});
