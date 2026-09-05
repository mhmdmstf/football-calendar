import test from 'node:test';
import assert from 'node:assert/strict';
import { easternToUtc, seasonSaturdays, parseFoxSchedule, parseGameDayFeed, getShows } from './shows.mjs';

const game = (id, day, a, b) => ({ id, day, season: 2026, teams: [{ id: a[0], short: a[1] }, { id: b[0], short: b[1] }] });
const games = [
  game('lsu', '2026-09-05', ['99', 'LSU'], ['228', 'Clemson']),
  game('texas', '2026-09-12', ['251', 'Texas'], ['194', 'Ohio State']),
  game('olemiss', '2026-09-19', ['99', 'LSU'], ['145', 'Ole Miss']),
  game('indiana', '2026-09-05', ['249', 'North Texas'], ['84', 'Indiana']),
  game('michigan', '2026-09-12', ['201', 'Oklahoma'], ['130', 'Michigan']),
  game('london', '2026-09-19', ['2305', 'Kansas'], ['9', 'Arizona State']),
  game('ohio', '2026-09-19', ['194', 'Ohio State'], ['2309', 'Kent State']),
];

test('Eastern conversion tracks fall DST change, independently of viewer timezone', () => {
  assert.equal(easternToUtc('2026-10-31', 9), '2026-10-31T13:00:00.000Z');
  assert.equal(easternToUtc('2026-11-07', 9), '2026-11-07T14:00:00.000Z');
  assert.throws(() => easternToUtc('2026-02-30', 9));
  assert.throws(() => easternToUtc('2026-03-08', 2, 30));
});

test('Regular show season starts before Labor Day and excludes an assumed Week Zero', () => {
  assert.equal(seasonSaturdays(2026)[0], '2026-09-05');
  assert.equal(seasonSaturdays(2026).at(-1), '2026-11-28');
  assert.equal(seasonSaturdays(2025)[0], '2025-08-30');
});

test('Verified pairings include London, never infer featured game from noon FOX slot', async () => {
  const result = await getShows(games, new Date('2026-09-05T12:00:00Z'), { offline: true });
  assert.equal(result.events.length, 26);
  assert.deepEqual([...result.featuredIds].sort(), ['indiana', 'london', 'lsu', 'michigan', 'olemiss', 'texas']);
  const london = result.events.find(e => e.uid.includes('bignoon-2026-09-19'));
  assert.match(london.title, /Wembley/);
  assert.equal(london.gameId, 'london');
  assert.equal(london.start, '2026-09-19T14:00:00.000Z');
  const generic = result.events.find(e => e.uid.includes('gameday-2026-10-03'));
  assert.equal(generic.status, 'TENTATIVE');
  assert.equal(generic.gameId, undefined);
  assert.match(generic.title, /location TBA/);
  const special = result.events.find(e => e.uid.includes('bignoon-2026-11-28'));
  assert.equal(special.start, '2026-11-28T14:00:00.000Z');
  assert.equal(special.end, '2026-11-28T17:00:00.000Z');
});

test('FOX parser requires exact school pair in explicit show card and a nearby date', () => {
  const html = '<div class="matchup-body flex-col-cntr"><div class="date">SAT, SEPT 19</div><div class="teams">ARIZONA STATE VS. KANSAS</div></div><p>Ohio State vs. Kent State noon FOX</p>';
  assert.equal(parseFoxSchedule(html, games, new Date('2026-09-18'))[0].gameId, 'london');
  assert.equal(parseFoxSchedule(html.replace('KANSAS', 'KANSAS STATE'), games, new Date('2026-09-18')).length, 0);
  assert.equal(parseFoxSchedule(html, games, new Date('2027-09-18')).length, 0);
});

test('GameDay parser accepts a specific announcement and rejects ambiguous game summaries', () => {
  const fixture = body => `<rss><item><title>College GameDay opens its season in Baton Rouge</title><link>https://espnpressroom.com/press-release/college-gameday/</link><pubDate>Thu, 03 Sep 2026 14:00:00 +0000</pubDate><content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item></rss>`;
  const body = 'College GameDay opens its season. The pregame show airs Saturday, Sept. 5 from 9 a.m. to noon ET, as Clemson visits LSU.';
  assert.equal(parseGameDayFeed(fixture(body), games)[0].gameId, 'lsu');
  assert.equal(parseGameDayFeed(fixture(`${body} Indiana hosts North Texas.`), games).length, 0);
  assert.equal(parseGameDayFeed(fixture(body.replace('Saturday, Sept. 5', 'Saturday, Sept. 12')), games).length, 0);
});
