import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseballGame, baseballSeriesKey, deduplicateBaseballGames, validateBaseballSchedule,
  validateBaseballStandings, validateBaseballData, fetchBaseballData } from './baseball-source.mjs';

const NOW = '2026-09-19T12:00:00Z';
const rawGame = (id = 100, type = 'R', day = '2026-09-19') => ({
  gamePk: id, season: '2026', gameType: type, officialDate: day, gameDate: `${day}T20:00:00Z`,
  status: { codedGameState: 'S', abstractGameState: 'Preview', detailedState: 'Scheduled', startTimeTBD: false },
  teams: Object.fromEntries(['away', 'home'].map((side, i) => [side, {
    team: { id: 110 + i, season: 2026, name: `Team ${i}`, shortName: `Club ${i}`, league: { id: 103 }, division: { id: 201 } }, seriesNumber: 1,
  }])), seriesGameNumber: 1, seriesStatus: { isOver: false }, ifNecessary: 'N',
});

function schedule() {
  const games = [rawGame()];
  let id = 101;
  for (const [type, count, perSeries] of [['F', 12, 3], ['D', 20, 5], ['L', 14, 7], ['W', 7, 7]]) {
    for (let i = 0; i < count; i++) {
      const game = rawGame(id++, type, '2026-09-29');
      for (const side of ['away', 'home']) game.teams[side].seriesNumber = Math.floor(i / perSeries) + 1;
      game.seriesGameNumber = i % perSeries + 1;
      games.push(game);
    }
  }
  return { totalGames: games.length, dates: [
    { date: '2026-09-19', totalGames: 1, games: games.slice(0, 1) },
    { date: '2026-09-29', totalGames: 53, games: games.slice(1) },
  ] };
}

function standings() {
  return { records: Array.from({ length: 6 }, (_, division) => ({
    standingsType: 'regularSeason', league: { id: division < 3 ? 103 : 104 }, division: { id: 200 + division },
    lastUpdated: '2026-09-19T05:00:00Z', teamRecords: Array.from({ length: 5 }, (_, i) => ({
      team: { id: 100 + division * 5 + i, name: `Team ${division * 5 + i}`, season: 2026 },
      season: '2026', wins: 80 - i, losses: 70 + i, gamesPlayed: 150,
      divisionRank: String(i + 1), leagueRank: String((division % 3) * 5 + i + 1),
      divisionGamesBack: i === 0 ? '-' : `${i}.0`, wildCardGamesBack: '+2.5',
      eliminationNumber: 'E', wildCardEliminationNumber: '4', magicNumber: '-',
      divisionChamp: false, divisionLeader: i === 0, clinched: false,
    })),
  })) };
}

test('TBD timestamps, placeholder teams, optional games and cancellation stay explicit', () => {
  const raw = rawGame(101, 'F');
  raw.gameDate = '2026-09-19T07:33:00Z';
  raw.status.startTimeTBD = true;
  raw.teams.home.team.placeholder = true;
  raw.ifNecessary = 'Y';
  const game = normalizeBaseballGame(raw);
  assert.equal(game.timeKnown, false);
  assert.equal(game.day, '2026-09-19');
  assert.equal(game.home.placeholder, true);
  assert.equal(game.ifNecessary, true);
  assert.equal(game.status, 'TENTATIVE');
  for (const [code, state] of [['D', 'Postponed'], ['T', 'Suspended'], ['C', 'Cancelled']]) {
    raw.status = { ...raw.status, codedGameState: code, abstractGameState: 'Final', detailedState: state };
    assert.equal(normalizeBaseballGame(raw).finished, false);
  }
  assert.equal(normalizeBaseballGame(raw).status, 'CANCELLED');
  raw.status = { codedGameState: 'F', abstractGameState: 'Final', detailedState: 'Final', startTimeTBD: false };
  assert.equal(normalizeBaseballGame(raw).ifNecessary, false);
});

test('Official series key survives team and description replacement', () => {
  const raw = rawGame(101, 'D');
  assert.equal(baseballSeriesKey(raw), '2026/D/1');
  raw.description = 'Entirely different description';
  raw.teams.home.team = { id: 4999, name: 'ALDS winner TBD', placeholder: true };
  assert.equal(baseballSeriesKey(raw), '2026/D/1');
  raw.teams.away.seriesNumber = 2;
  assert.equal(baseballSeriesKey(raw), null);
});

test('Regular series keys preserve each club series number without requiring them to agree', () => {
  const raw = rawGame();
  raw.teams.away.seriesNumber = 50;
  raw.teams.home.seriesNumber = 51;
  assert.equal(baseballSeriesKey(raw), '2026/R/110:50/111:51');
  raw.seriesGameNumber = 2;
  raw.gamePk = 101;
  assert.equal(baseballSeriesKey(raw), '2026/R/110:50/111:51');
  raw.teams.home.seriesNumber = 52;
  assert.equal(baseballSeriesKey(raw), '2026/R/110:50/111:52');
  delete raw.teams.away.seriesNumber;
  assert.equal(baseballSeriesKey(raw), null);
});

test('Duplicate postponed and resumed representations use the replacement date in any order', () => {
  const original = rawGame();
  original.resumeDate = '2026-09-20T18:00:00Z';
  original.status.codedGameState = 'F';
  const resumed = structuredClone(original);
  delete resumed.resumeDate;
  resumed.gameDate = original.resumeDate;
  resumed.resumedFrom = original.gameDate;
  for (const values of [[original, resumed], [resumed, original]]) {
    const game = normalizeBaseballGame(deduplicateBaseballGames(values)[0]);
    assert.equal(game.date, '2026-09-20T18:00:00.000Z');
    assert.equal(game.day, '2026-09-19');
    assert.equal(game.finished, true);
  }
});

test('Schedule rejects truncation, wrong seasons, missing postseason slots and unreliable series keys', () => {
  assert.equal(validateBaseballSchedule(schedule(), 2026, NOW).length, 54);
  const truncated = schedule(); truncated.totalGames++;
  assert.throws(() => validateBaseballSchedule(truncated, 2026, NOW), /incomplete schedule/);
  const wrongSeason = schedule(); wrongSeason.dates[0].games[0].season = '2025';
  assert.throws(() => validateBaseballSchedule(wrongSeason, 2026, NOW), /season/);
  const missing = schedule(); missing.dates[1].games.pop(); missing.dates[1].totalGames--; missing.totalGames--;
  assert.throws(() => validateBaseballSchedule(missing, 2026, NOW), /postseason round W/);
  assert.equal(validateBaseballSchedule(missing, 2026, '2026-11-10').length, 53);
  const mismatch = schedule(); mismatch.dates[1].games[0].teams.away.seriesNumber = 2;
  assert.throws(() => validateBaseballSchedule(mismatch, 2026, NOW), /series number/);
});

test('Standings preserve mathematical sentinels and reject stale or incomplete snapshots', () => {
  const teams = validateBaseballStandings(standings(), 2026, NOW);
  assert.equal(teams.length, 30);
  assert.equal(teams[0].divisionGamesBack, '-');
  assert.equal(teams[0].wildCardGamesBack, '+2.5');
  assert.equal(teams[0].eliminationNumber, 'E');
  assert.equal(teams[0].magicNumber, '-');
  assert.throws(() => validateBaseballStandings(standings(), 2025, NOW), /season/);
  assert.throws(() => validateBaseballStandings(standings(), 2026, '2026-09-25'), /stale/);
  const incomplete = standings(); incomplete.records.pop();
  assert.throws(() => validateBaseballStandings(incomplete, 2026, NOW), /six divisions/);
  const duplicate = standings(); duplicate.records[1].teamRecords[0].team.id = 100;
  assert.throws(() => validateBaseballStandings(duplicate, 2026, NOW), /duplicate/);
});

test('Fetching retries malformed source data, requests bounded dates and hydrates current standings', async () => {
  let attempts = 0;
  const urls = [];
  const warnings = [];
  const result = await fetchBaseballData(2026, NOW, {
    sleep: async () => {}, warn: warning => warnings.push(warning),
    fetchImpl: async url => {
      urls.push(new URL(url));
      if (url.includes('/schedule')) {
        attempts++;
        if (attempts === 1) return new Response('Bad gateway', { status: 502 });
        if (attempts === 2) return new Response('{broken-json');
        return Response.json(schedule());
      }
      return Response.json(standings());
    },
  });
  assert.equal(attempts, 3);
  assert.equal(warnings.length, 2);
  assert.equal(result.games.length, 54);
  assert.equal(result.standings.length, 30);
  assert.equal(urls[0].searchParams.get('startDate'), '2026-09-01');
  assert.equal(urls[0].searchParams.get('endDate'), '2026-11-30');
  assert.equal(urls.at(-1).searchParams.get('date'), '2026-09-19');
});

test('Postseason fetching does not request irrelevant standings', async () => {
  let calls = 0;
  const result = await fetchBaseballData(2026, '2026-10-05', { fetchImpl: async () => {
    calls++; return Response.json(schedule());
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.standings, []);
});

test('Oversized responses stop after three attempts', async () => {
  let calls = 0;
  await assert.rejects(fetchBaseballData(2026, NOW, { sleep: async () => {}, fetchImpl: async () => {
    calls++; return new Response('{}', { headers: { 'content-length': '20000000' } });
  } }), /3 attempts.*size limit/);
  assert.equal(calls, 3);
});

function teamSchedule(teamId, year, count = 162) {
  const dates = Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(year, 2, 25 + index)).toISOString().slice(0, 10);
    const raw = rawGame(year * 1000000 + Number(teamId) * 1000 + index, 'R', day);
    raw.season = String(year);
    for (const side of ['away', 'home']) raw.teams[side].team.season = year;
    raw.teams.home.team.id = Number(teamId);
    return { date: day, totalGames: 1, games: [raw] };
  });
  return { totalGames: count, dates };
}

test('followed-team schedules require every regular game and exclude spring training', () => {
  const payload = teamSchedule('139', 2027);
  assert.equal(validateBaseballSchedule(payload, 2027, NOW, { teamId: '139' }).length, 162);
  assert.throws(() => validateBaseballSchedule(teamSchedule('139', 2027, 161), 2027, NOW, { teamId: '139' }), /161\/162/);
  assert.throws(() => validateBaseballSchedule(payload, 2027, NOW, { teamId: '121' }), /participants/);
  const spring = structuredClone(payload); spring.dates[0].games[0].gameType = 'S';
  assert.throws(() => validateBaseballSchedule(spring, 2027, NOW, { teamId: '139' }), /type/);
  const empty = { totalGames: 0, dates: [] };
  assert.deepEqual(validateBaseballSchedule(empty, 2027, NOW, { teamId: '139', allowEmpty: true }), []);
  assert.throws(() => validateBaseballSchedule(empty, 2026, NOW, { teamId: '139' }), /schedule/);
});

test('year-round followed schedules do not request early-season standings or national picks', async () => {
  const urls = [];
  const result = await fetchBaseballData(2027, '2027-02-01T12:00:00Z', {
    alwaysIncludeTeamIds: ['139', '121'],
    fetchImpl: async url => {
      urls.push(new URL(url));
      return Response.json(teamSchedule(new URL(url).searchParams.get('teamId'), 2027));
    },
  });
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => url.pathname.endsWith('/schedule') && url.searchParams.get('gameTypes') === 'R'));
  assert.equal(result.games.length, 324);
  assert.deepEqual(result.standings, []);
  assert.deepEqual(result.followedRegularSeasons, { 2027: { 139: 162, 121: 162 } });
  assert.equal(result.source.national, null);
});

test('published next-season schedules are included and raw cache validation catches later truncation', async () => {
  const result = await fetchBaseballData(2026, '2026-12-01T12:00:00Z', {
    alwaysIncludeTeamIds: ['139', '121'],
    fetchImpl: async url => {
      const query = new URL(url).searchParams;
      return Response.json(teamSchedule(query.get('teamId'), Number(query.get('season'))));
    },
  });
  assert.equal(result.games.length, 648);
  assert.deepEqual(result.followedRegularSeasons, { 2026: { 139: 162, 121: 162 }, 2027: { 139: 162, 121: 162 } });
  assert.deepEqual(validateBaseballData(result, 2026, '2026-12-01', { alwaysIncludeTeamIds: ['139', '121'] }).games, result.games);
  const broken = structuredClone(result);
  broken.source.regular[2027][139].dates.pop();
  assert.throws(() => validateBaseballData(broken, 2026, '2026-12-01', { alwaysIncludeTeamIds: ['139', '121'] }), /incomplete schedule/);
});

test('an unpublished next season requires an explicitly empty, well-formed source response', async () => {
  const result = await fetchBaseballData(2026, '2026-07-01T12:00:00Z', {
    alwaysIncludeTeamIds: ['139'],
    fetchImpl: async url => Response.json(new URL(url).searchParams.get('season') === '2026'
      ? teamSchedule('139', 2026) : { totalGames: 0, dates: [] }),
  });
  assert.equal(result.games.length, 162);
  assert.deepEqual(result.followedRegularSeasons, { 2026: { 139: 162 }, 2027: { 139: 0 } });
  const broken = structuredClone(result); broken.source.regular[2027][139] = {};
  assert.throws(() => validateBaseballData(broken, 2026, '2026-07-01', { alwaysIncludeTeamIds: ['139'] }), /schedule/);
});

test('a Rays-Mets game appears once while distinct doubleheader games retain separate IDs', async () => {
  const rays = teamSchedule('139', 2027), mets = teamSchedule('121', 2027);
  for (let index = 0; index < 2; index++) {
    rays.dates[index].games[0].teams.away.team.id = 121;
    mets.dates[index] = structuredClone(rays.dates[index]);
  }
  const second = rays.dates[1].games[0];
  second.officialDate = rays.dates[0].date;
  second.gameDate = `${second.officialDate}T23:00:00Z`;
  rays.dates[1].date = second.officialDate;
  mets.dates[1] = structuredClone(rays.dates[1]);
  const result = await fetchBaseballData(2027, '2027-02-01T12:00:00Z', {
    alwaysIncludeTeamIds: ['139', '121'],
    fetchImpl: async url => Response.json(new URL(url).searchParams.get('teamId') === '139' ? rays : mets),
  });
  assert.equal(result.games.length, 322);
  assert.equal(result.games.filter(game => game.day === rays.dates[0].date).length, 2);
});
