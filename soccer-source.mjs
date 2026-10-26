import { addDays } from './calendar.mjs';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TABLES = 'https://site.api.espn.com/apis/v2/sports/soccer';
const MAX_BYTES = 8 * 1024 * 1024;
const LIMIT = 100;
const DEFAULT_LEAGUES = ['eng.1', 'ita.1', 'esp.1', 'ger.1', 'fra.1', 'uefa.champions'];
const TABLE_SIZES = { 'eng.1': 20, 'ita.1': 20, 'esp.1': 20, 'ger.1': 18, 'fra.1': 18 };
const fail = message => { throw new Error(`Soccer: ${message}`); };
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
const positiveId = value => /^\d+$/.test(String(value)) && Number(value) > 0;
const validInstant = value => typeof value === 'string' && /T.+(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

export function soccerSeason(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(+date)) fail('invalid current date');
  return date.getUTCFullYear() - (date.getUTCMonth() < 7 ? 1 : 0);
}

export function soccerDay(date) {
  if (!Number.isFinite(+new Date(date))) fail('invalid date');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(date)).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function soccerWindow(now, days = 14) {
  if (!Number.isInteger(days) || days < 7 || days > 28) fail('invalid selection horizon');
  const day = soccerDay(now);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const start = addDays(day, -(weekday + 6) % 7);
  return { start, end: addDays(start, days) };
}

function settings(config, now) {
  const teams = config.teams || [];
  if (!Array.isArray(teams) || !teams.length || teams.some(team => !positiveId(team.id) ||
      !/^[a-z0-9_.]+$/.test(team.league || '') || !Number.isInteger(team.expectedLeagueGames) || team.expectedLeagueGames < 1)) fail('invalid followed teams');
  const leagues = config.leagues || [...(config.domesticLeagues || DEFAULT_LEAGUES.slice(0, 5)), 'uefa.champions'];
  if (!Array.isArray(leagues) || !leagues.length || leagues.some(league => !/^[a-z0-9_.]+$/.test(league)) || new Set(leagues).size !== leagues.length) fail('invalid leagues');
  return { teams, leagues, season: soccerSeason(now), window: soccerWindow(now, config.selectionHorizonDays || 14) };
}

/** ESPN reports a listed time, but does not reliably identify TV-confirmed future fixtures. */
export function normalizeSoccerGame(raw, leagueInfo) {
  const c = raw?.competitions?.[0];
  const league = raw?.league || (typeof leagueInfo === 'string' ? { slug: leagueInfo, name: leagueInfo } : leagueInfo);
  if (!positiveId(raw?.id) || !c || !league?.slug || !validInstant(raw.date) || !Number.isInteger(raw.season?.year)) fail('invalid fixture identity, league, season or date');
  if (c.date && (!validInstant(c.date) || Date.parse(c.date) !== Date.parse(raw.date))) fail(`conflicting event/competition date for ${raw.id}`);
  const participants = c.competitors || [];
  if (participants.length !== 2 || participants.some(item => !positiveId(item.team?.id || item.id) || !item.team?.displayName || !['home', 'away'].includes(item.homeAway))) fail(`invalid teams for ${raw.id}`);
  const team = side => {
    const item = participants.find(item => item.homeAway === side);
    if (!item) fail(`missing ${side} team for ${raw.id}`);
    return { id: String(item.team.id || item.id), name: item.team.displayName };
  };
  const home = team('home'), away = team('away');
  if (home.id === away.id) fail(`same team on both sides for ${raw.id}`);
  const state = c.status?.type || raw.status?.type;
  if (!state?.name || !['pre', 'in', 'post'].includes(state.state)) fail(`missing fixture status for ${raw.id}`);
  const cancelled = /cancel/i.test(state.name);
  const postponed = /postpon|suspend|abandon/i.test(state.name);
  const finished = !cancelled && !postponed && (state.completed === true || state.state === 'post');
  const inProgress = !cancelled && !postponed && state.state === 'in';
  const timeKnown = c.timeValid === true && raw.timeValid !== false && !c.status?.isTBDFlex && !/TBD|TBA/i.test(state.name) && !postponed;
  const friendly = /friendly|summer series|florida cup|sydney super cup/i.test(`${league.slug} ${league.name || ''}`);
  const stage = [raw.season.slug?.replace(/-/g, ' '), ...(c.notes || []).map(note => note.headline), c.altGameNote].filter(Boolean).join('; ');
  return {
    id: String(raw.id), league: league.slug, season: raw.season.year,
    date: new Date(raw.date).toISOString(), day: soccerDay(raw.date), timeKnown,
    timeConfirmed: timeKnown && (finished || inProgress), home, away,
    competition: { name: league.name || league.slug, slug: league.slug },
    venue: c.venue?.fullName || raw.venue?.displayName || '',
    url: `https://www.espn.com/soccer/match/_/gameId/${raw.id}`,
    status: cancelled ? 'CANCELLED' : finished || inProgress ? 'CONFIRMED' : 'TENTATIVE',
    postponed, finished, inProgress, friendly, stage,
  };
}

function facts(game) {
  return JSON.stringify([game.league, game.season, game.date, game.home.id, game.away.id, game.timeKnown, game.postponed, game.status]);
}

function merge(games, game) {
  const old = games.get(game.id);
  if (old && facts(old) !== facts(game)) fail(`conflicting snapshots for fixture ${game.id}`);
  // League scoreboards supply round/stage information missing from club schedules.
  games.set(game.id, old ? { ...old, ...game, stage: game.stage || old.stage } : game);
}

function validateTeamPayload(payload, team, season, kind) {
  if (!payload || String(payload.team?.id) !== String(team.id) || !Array.isArray(payload.events) || payload.events.length > 100) fail(`${team.name} ${kind}: missing, wrong-team or oversized schedule`);
  if (payload.requestedSeason?.year !== season && (payload.events.length || payload.requestedSeason)) fail(`${team.name} ${kind}: wrong requested season`);
  return payload.events.map(raw => {
    const game = normalizeSoccerGame(raw);
    if (game.season !== season || ![game.home.id, game.away.id].includes(String(team.id))) fail(`${team.name} ${kind}: wrong season or fixture participants`);
    if (game.day < `${season}-06-01` || game.day >= `${season + 1}-08-01`) fail(`${team.name} ${kind}: fixture outside requested season`);
    return game;
  });
}

function validateBoard(payload, league, season, day) {
  const meta = payload?.leagues?.find(item => item.slug === league);
  if (!meta || meta.season?.year !== season || !Array.isArray(payload.events)) fail(`${league} ${day}: missing or wrong-season scoreboard`);
  if (payload.events.length >= LIMIT) fail(`${league} ${day}: scoreboard reached its result limit`);
  const advertised = meta.calendarType === 'day' && meta.calendar?.some(value => typeof value === 'string' && value.slice(0, 10) === day);
  if (advertised && !payload.events.length) fail(`${league} ${day}: advertised matchday returned no fixtures`);
  const ids = new Set();
  return payload.events.map(raw => {
    const game = normalizeSoccerGame(raw, meta);
    if (game.season !== season || game.league !== league || game.day !== day) fail(`${league} ${day}: wrong date, league or season in scoreboard`);
    if (ids.has(game.id)) fail(`${league} ${day}: duplicate fixture`);
    ids.add(game.id);
    return game;
  });
}

function parseStandings(payload, league, season) {
  if (payload?.season?.year !== season) fail(`${league}: wrong or missing standings season`);
  const entries = [];
  const visit = node => {
    if (Array.isArray(node.standings?.entries)) entries.push(...node.standings.entries);
    for (const child of node.children || []) visit(child);
  };
  visit(payload);
  if (entries.length < 2 || entries.length > 64 || TABLE_SIZES[league] && entries.length !== TABLE_SIZES[league]) fail(`${league}: incomplete standings`);
  const table = {};
  for (const entry of entries) {
    const id = String(entry.team?.id);
    const stats = Object.fromEntries((entry.stats || []).map(stat => [stat.name, stat.value]));
    if (!positiveId(id) || table[id] || !Number.isInteger(stats.rank) || stats.rank < 1 ||
        !Number.isFinite(stats.points) || !Number.isInteger(stats.gamesPlayed) || stats.gamesPlayed < 0) fail(`${league}: malformed standings entry`);
    table[id] = { rank: stats.rank, points: stats.points, played: stats.gamesPlayed };
  }
  return table;
}

/** Validate every followed season and every calendar day before exposing new events. */
export function validateSoccerData(raw, config, now = new Date()) {
  const { teams, leagues, season, window } = settings(config, now);
  if (raw?.season !== season || raw.window?.start !== window.start || raw.window?.end !== window.end) fail('cached soccer season/window is stale or missing');
  const games = new Map(), teamCounts = {}, leagueCounts = {}, standings = {}, warnings = [...(raw.warnings || [])];
  for (const team of teams) {
    const unique = new Map();
    for (const kind of ['results', 'fixtures']) {
      for (const game of validateTeamPayload(raw.teams?.[team.id]?.[kind], team, season, kind)) merge(unique, game);
    }
    const leagueGames = [...unique.values()].filter(game => game.league === team.league).length;
    if (leagueGames !== team.expectedLeagueGames) fail(`${team.name}: incomplete league schedule (${leagueGames}/${team.expectedLeagueGames})`);
    teamCounts[team.id] = { name: team.name, leagueGames, competitive: [...unique.values()].filter(game => !game.friendly).length };
    for (const game of unique.values()) merge(games, game);
  }
  for (const league of leagues) {
    let count = 0;
    for (let day = window.start; day < window.end; day = addDays(day, 1)) {
      const dayGames = validateBoard(raw.boards?.[league]?.[day], league, season, day);
      for (const game of dayGames) merge(games, game);
      count += dayGames.length;
    }
    leagueCounts[league] = count;
    try { standings[league] = parseStandings(raw.standings?.[league], league, season); }
    catch (error) { standings[league] = {}; warnings.push(`Standings unavailable for ${league}; selections use other available signals. ${error.message}`); }
  }
  return { season, games: [...games.values()].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)),
    standings, counts: { teams: teamCounts, leagues: leagueCounts }, raw, window, warnings: [...new Set(warnings)] };
}

async function readJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_BYTES) fail('source response exceeds size limit');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_BYTES) fail('source response exceeds size limit');
    return JSON.parse(text);
  }
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); fail('source response exceeds size limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function pool(jobs, concurrency = 6) {
  let cursor = 0, failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (!failure && cursor < jobs.length) {
      const job = jobs[cursor++];
      try { await job(); } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
}

export async function fetchSoccerData(config, now = new Date(), { fetchImpl = fetch, sleep = sleepDefault, warn } = {}) {
  const { teams, leagues, season, window } = settings(config, now);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = { season, window, teams: {}, boards: {}, standings: {}, warnings: [] };
      const json = async url => {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'FootballAndFriendsCalendar/1.0' } });
        if (!response.ok) fail(`source returned HTTP ${response.status}: ${new URL(url).pathname}`);
        return readJson(response);
      };
      const jobs = [];
      for (const team of teams) {
        raw.teams[team.id] = {};
        for (const kind of ['results', 'fixtures']) jobs.push(async () => {
          const payload = await json(`${SITE}/all/teams/${team.id}/schedule?season=${season}${kind === 'fixtures' ? '&fixture=true' : ''}`);
          validateTeamPayload(payload, team, season, kind);
          raw.teams[team.id][kind] = payload;
        });
      }
      for (const league of leagues) {
        raw.boards[league] = {};
        for (let day = window.start; day < window.end; day = addDays(day, 1)) {
          const requestDay = day;
          jobs.push(async () => {
            // Soccer range queries return HTTP 400. Explicit days also cover rescheduled games.
            const payload = await json(`${SITE}/${league}/scoreboard?dates=${requestDay.replace(/-/g, '')}&limit=${LIMIT}`);
            validateBoard(payload, league, season, requestDay);
            raw.boards[league][requestDay] = payload;
          });
        }
        jobs.push(async () => {
          try { raw.standings[league] = await json(`${TABLES}/${league}/standings?season=${season}`); }
          catch (error) { raw.warnings.push(`Standings fetch failed for ${league}: ${error.message}`); }
        });
      }
      await pool(jobs);
      return validateSoccerData(raw, config, now);
    } catch (error) {
      if (attempt === 2) throw new Error(`Soccer schedules failed after 3 attempts: ${error.message}`, { cause: error });
      warn?.(`Soccer source retry ${attempt + 1}/2: ${error.message}`);
      await sleep(1000 * (attempt + 1));
    }
  }
}
