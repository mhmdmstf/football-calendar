const API = 'https://statsapi.mlb.com/api/v1';
const TYPES = new Set(['R', 'F', 'D', 'L', 'W']);
const POSTSEASON_MAX = { F: 12, D: 20, L: 14, W: 7 };
const POSTSEASON_MIN = { F: 8, D: 12, L: 8, W: 4 };
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_GAMES = 1200;
const DAY_MS = 86400000;
const HYDRATE = 'team,seriesStatus,probablePitcher,broadcasts';
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = message => { throw new Error(`MLB: ${message}`); };
const validId = value => /^\d+$/.test(String(value)) && Number(value) > 0;
const integer = value => Number.isInteger(value) && value >= 0;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const validInstant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function easternDay(now) {
  const date = new Date(now);
  if (!Number.isFinite(+date)) fail('invalid current date');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeTeam(team = {}) {
  return {
    id: validId(team.id) ? String(team.id) : '',
    name: team.name || 'Team TBD', short: team.shortName || team.name || 'Team TBD',
    placeholder: team.placeholder === true || !validId(team.id) || /^(?:TBD|TBA|Team TBD)$/i.test(team.name || ''),
    leagueId: Number(team.league?.id) || null, divisionId: Number(team.division?.id) || null,
  };
}

/** MLB series numbers match the official postseason/series endpoint's F_1, D_1, etc. */
export function baseballSeriesKey(game) {
  const home = Number(game.teams?.home?.seriesNumber);
  const away = Number(game.teams?.away?.seriesNumber);
  if (game.gameType === 'R') {
    const homeId = game.teams?.home?.team?.id;
    const awayId = game.teams?.away?.team?.id;
    if (!Number.isInteger(home) || home < 1 || !Number.isInteger(away) || away < 1 || !validId(homeId) || !validId(awayId)) return null;
    return `${game.season}/R/${awayId}:${away}/${homeId}:${home}`;
  }
  if (!Number.isInteger(home) || home < 1 || home !== away) return null;
  return `${game.season}/${game.gameType}/${home}`;
}

export function normalizeBaseballGame(raw) {
  const code = raw.status?.codedGameState;
  const state = raw.status?.detailedState || 'Unknown';
  const cancelled = code === 'C' || /cancelled|canceled|not necessary|unnecessary/i.test(state);
  const interrupted = ['D', 'T', 'U'].includes(code) || /postponed|suspended/i.test(state);
  const timeKnown = raw.status?.startTimeTBD === false;
  const away = normalizeTeam(raw.teams?.away?.team);
  const home = normalizeTeam(raw.teams?.home?.team);
  const finished = !cancelled && !interrupted && (['F', 'O'].includes(code) || raw.status?.abstractGameState === 'Final');
  const ifNecessary = raw.ifNecessary === 'Y' && !finished;
  return {
    id: String(raw.gamePk), season: Number(raw.season), type: raw.gameType,
    day: raw.officialDate, date: new Date(raw.gameDate).toISOString(), timeKnown,
    away, home, venue: raw.venue?.name || '', url: `https://www.mlb.com/gameday/${raw.gamePk}`,
    channels: [...new Set((raw.broadcasts || []).filter(b => b.type === 'TV' && b.name).map(b => b.name))],
    pitchers: ['away', 'home'].map(side => raw.teams?.[side]?.probablePitcher?.fullName).filter(Boolean),
    stage: raw.description || raw.seriesStatus?.shortDescription || raw.seriesDescription || '',
    seriesGameNumber: Number(raw.seriesGameNumber || raw.seriesStatus?.gameNumber) || null,
    seriesKey: baseballSeriesKey(raw), seriesOver: raw.seriesStatus?.isOver === true,
    ifNecessary, status: cancelled ? 'CANCELLED' : interrupted || !timeKnown || away.placeholder || home.placeholder || ifNecessary ? 'TENTATIVE' : 'CONFIRMED',
    state, finished,
    raw,
  };
}

/** Prefer MLB's replacement row, including a resumed game retaining its original officialDate. */
export function deduplicateBaseballGames(rawGames) {
  const byId = new Map();
  const replacement = (candidate, other) => [other.rescheduleDate, other.resumeDate]
    .some(date => validInstant(date) && Date.parse(date) === Date.parse(candidate.gameDate));
  for (const raw of rawGames) {
    const id = String(raw.gamePk);
    const previous = byId.get(id);
    if (!previous) { byId.set(id, raw); continue; }
    if (replacement(raw, previous)) { byId.set(id, raw); continue; }
    if (replacement(previous, raw)) continue;
    const changedDate = Date.parse(raw.gameDate) - Date.parse(previous.gameDate);
    if (changedDate > 0 || (changedDate === 0 && raw.status?.codedGameState === 'C')) byId.set(id, raw);
    else if (changedDate === 0 && ['D', 'T', 'U'].includes(previous.status?.codedGameState) &&
      !['D', 'T', 'U'].includes(raw.status?.codedGameState)) byId.set(id, raw);
  }
  return [...byId.values()];
}

export function normalizeBaseballSchedule(payload) {
  return deduplicateBaseballGames(payload.dates.flatMap(date => date.games)).map(normalizeBaseballGame);
}

/** Validate before replacing any published schedule. Call on raw cached payloads too. */
export function validateBaseballSchedule(payload, year, now = new Date()) {
  if (!Number.isInteger(year) || year < 2022 || year > 2100) fail('invalid season');
  if (!payload || !Array.isArray(payload.dates) || payload.dates.length > 150 ||
      !integer(payload.totalGames) || payload.totalGames < 1 || payload.totalGames > MAX_GAMES) fail('missing or oversized schedule');
  let count = 0;
  for (const date of payload.dates) {
    if (!validDay(date.date) || !date.date.startsWith(`${year}-`) || !Array.isArray(date.games) || !integer(date.totalGames) || date.totalGames !== date.games.length) fail('invalid schedule date bucket');
    count += date.games.length;
    for (const raw of date.games) {
      if (!validId(raw.gamePk) || Number(raw.season) !== year || !TYPES.has(raw.gameType) ||
          !validDay(raw.officialDate) || !raw.officialDate.startsWith(`${year}-`) || !validInstant(raw.gameDate) ||
          new Date(raw.gameDate).getUTCFullYear() !== year) fail('invalid game identity, season, type or date');
      if (!raw.status || typeof raw.status.startTimeTBD !== 'boolean' || typeof raw.status.detailedState !== 'string') fail(`missing status for ${raw.gamePk}`);
      if (raw.gameType !== 'R' && !baseballSeriesKey(raw)) fail(`missing or mismatched postseason series number for ${raw.gamePk}`);
      for (const side of ['away', 'home']) {
        const team = raw.teams?.[side]?.team;
        if (!team || !validId(team.id) || typeof team.name !== 'string' || !team.name.trim()) fail(`missing ${side} team for ${raw.gamePk}`);
        if (team.season != null && Number(team.season) !== year) fail(`wrong team season for ${raw.gamePk}`);
      }
    }
  }
  if (count !== payload.totalGames) fail(`incomplete schedule: advertised ${payload.totalGames}, received ${count}`);
  const games = normalizeBaseballSchedule(payload);
  const counts = Object.fromEntries(Object.keys(POSTSEASON_MAX).map(type => [type, games.filter(g => g.type === type).length]));
  const firstPost = games.filter(g => g.type !== 'R').map(g => g.day).sort()[0];
  const today = easternDay(now);
  const beforePlay = today.startsWith(`${year}-09`) && (!firstPost || today < firstPost);
  const minimum = beforePlay ? POSTSEASON_MAX : POSTSEASON_MIN;
  for (const [type, expected] of Object.entries(minimum)) {
    if (counts[type] < expected || counts[type] > POSTSEASON_MAX[type]) fail(`incomplete postseason round ${type}: ${counts[type]} games`);
  }
  return games;
}

const RAW_STANDING_FIELDS = ['divisionRank', 'wildCardRank', 'leagueRank', 'divisionGamesBack', 'wildCardGamesBack',
  'eliminationNumber', 'wildCardEliminationNumber', 'magicNumber'];

export function normalizeStandings(payload) {
  return payload.records.flatMap(record => record.teamRecords.map(team => ({
    ...normalizeTeam(team.team), leagueId: Number(record.league.id), divisionId: Number(record.division.id),
    wins: team.wins, losses: team.losses, gamesPlayed: team.gamesPlayed,
    ...Object.fromEntries(RAW_STANDING_FIELDS.map(key => [key, team[key] == null ? null : String(team[key])])),
    divisionChamp: team.divisionChamp === true, divisionLeader: team.divisionLeader === true, clinched: team.clinched === true,
  })));
}

export function validateBaseballStandings(payload, year, now = new Date()) {
  if (!payload || !Array.isArray(payload.records) || payload.records.length !== 6) fail('standings must contain six divisions');
  const nowTime = +new Date(now);
  const divisions = new Set();
  const ids = new Set();
  for (const record of payload.records) {
    if (record.standingsType !== 'regularSeason' || ![103, 104].includes(Number(record.league?.id)) ||
      ![200, 201, 202, 203, 204, 205].includes(Number(record.division?.id)) ||
      !Array.isArray(record.teamRecords) || record.teamRecords.length !== 5) fail('invalid standings division');
    if (divisions.has(Number(record.division.id))) fail('duplicate standings division');
    divisions.add(Number(record.division.id));
    const updated = Date.parse(record.lastUpdated);
    if (!Number.isFinite(updated) || new Date(updated).getUTCFullYear() !== year ||
      updated > nowTime + DAY_MS || updated < nowTime - 3 * DAY_MS) fail('standings are stale or from another season');
    for (const team of record.teamRecords) {
      if (Number(team.season) !== year || Number(team.team?.season) !== year || !validId(team.team?.id) ||
        !team.team.name || team.team.placeholder || ids.has(String(team.team.id))) fail('invalid, duplicate or wrong-season standings team');
      if (![team.wins, team.losses, team.gamesPlayed].every(integer) || team.wins + team.losses > team.gamesPlayed || team.gamesPlayed > 170) fail('invalid standings record');
      if (!/^[1-5]$/.test(String(team.divisionRank)) || !/^(?:[1-9]|1[0-5])$/.test(String(team.leagueRank))) fail('invalid standings rank');
      ids.add(String(team.team.id));
    }
  }
  if (ids.size !== 30) fail('standings must contain 30 unique teams');
  return normalizeStandings(payload);
}

async function boundedJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_BYTES) fail('source response exceeds size limit');
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); fail('source response exceeds size limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_BYTES) fail('source response exceeds size limit');
  }
  return JSON.parse(text);
}

async function request(url, validate, { fetchImpl, sleep, warn }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'SportsWatchlistCalendar/1.0' } });
      if (!response.ok) fail(`source returned HTTP ${response.status}`);
      return validate(await boundedJson(response));
    } catch (error) {
      if (attempt === 2) throw new Error(`MLB source failed after 3 attempts: ${error.message}`, { cause: error });
      warn?.(`MLB source retry ${attempt + 1}/2: ${error.message}`);
      await sleep(1000 * (attempt + 1));
    }
  }
}

export async function fetchBaseballData(year, now = new Date(), { fetchImpl = fetch, sleep = defaultSleep, warn } = {}) {
  const options = { fetchImpl, sleep, warn };
  const today = easternDay(now);
  const query = new URLSearchParams({ sportId: '1', season: String(year), startDate: `${year}-09-01`, endDate: `${year}-11-30`,
    gameTypes: 'R,F,D,L,W', hydrate: HYDRATE });
  const games = await request(`${API}/schedule?${query}`, payload => validateBaseballSchedule(payload, year, now), options);
  const needStandings = games.some(g => g.type === 'R' && g.day >= today && !g.finished && g.status !== 'CANCELLED');
  let standings = [];
  if (needStandings) {
    const query = new URLSearchParams({ leagueId: '103,104', season: String(year), standingsTypes: 'regularSeason', date: today, hydrate: 'team' });
    standings = await request(`${API}/standings?${query}`, payload => validateBaseballStandings(payload, year, now), options);
  }
  return { games, standings };
}
