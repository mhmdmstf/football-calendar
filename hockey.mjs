import { addDays } from './calendar.mjs';

const API = 'https://api-web.nhle.com/v1/club-schedule-season';
const MAX_BYTES = 4 * 1024 * 1024;
const bare = ({ hash, created, modified, sequence, ...event }) => event;
const fail = message => { throw new Error(`NHL: ${message}`); };
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const validInstant = value => typeof value === 'string' && /T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const positive = value => Number.isInteger(value) && value > 0;
const localized = value => typeof value === 'string' ? value : value?.default || '';
const isHockey = event => event.categories?.includes('NHL');
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));

/** September rollover avoids requesting an unpublished next season in early summer. */
export function hockeySeason(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(+date)) fail('invalid current date');
  const year = date.getUTCFullYear() - (date.getUTCMonth() < 8 ? 1 : 0);
  return year * 10000 + year + 1;
}

function team(raw) {
  return { id: String(raw.id), abbrev: raw.abbrev,
    name: [localized(raw.placeName), localized(raw.commonName)].filter(Boolean).join(' ') || raw.abbrev };
}

export function normalizeHockeyGame(raw) {
  const cancelled = /^(?:CNCL|CANCELLED|CANCELED)$/.test(raw.gameScheduleState) || /^(?:CNCL|CANCELLED|CANCELED)$/.test(raw.gameState);
  const postponed = /^(?:PPD|POSTPONED|SUSPENDED)$/.test(raw.gameScheduleState) || /^(?:PPD|POSTPONED|SUSPENDED)$/.test(raw.gameState);
  const finished = !cancelled && !postponed && ['FINAL', 'OFF'].includes(raw.gameState);
  const timeKnown = validInstant(raw.startTimeUTC) && raw.gameScheduleState === 'OK' &&
    !['TBD', 'TBA'].includes(raw.gameState) && raw.startTimeTBD !== true && raw.timeTBD !== true;
  const series = raw.seriesStatus;
  const seriesGameNumber = positive(series?.gameNumberOfSeries) ? series.gameNumberOfSeries : null;
  const seriesKey = raw.gameType === 3 && positive(series?.round) && /^[A-Z]$/.test(series?.seriesLetter || '')
    ? `${raw.season}/${series.round}/${series.seriesLetter}` : null;
  const winsKnown = [series?.topSeedWins, series?.bottomSeedWins].every(n => Number.isInteger(n) && n >= 0);
  const seriesOver = winsKnown && positive(series?.neededToWin) && Math.max(series.topSeedWins, series.bottomSeedWins) >= series.neededToWin;
  const ifNecessary = !finished && raw.gameType === 3 && positive(series?.neededToWin) && seriesGameNumber > series.neededToWin &&
    (!winsKnown || series.topSeedWins + series.bottomSeedWins < seriesGameNumber - 1);
  return {
    id: String(raw.id), season: raw.season, type: raw.gameType, day: raw.gameDate,
    date: validInstant(raw.startTimeUTC) ? new Date(raw.startTimeUTC).toISOString() : null, timeKnown,
    away: team(raw.awayTeam), home: team(raw.homeTeam), venue: localized(raw.venue),
    url: `https://www.nhl.com${typeof raw.gameCenterLink === 'string' && raw.gameCenterLink.startsWith('/gamecenter/') ? raw.gameCenterLink : `/gamecenter/${raw.id}`}`,
    channels: [...new Set((raw.tvBroadcasts || []).map(b => b.network).filter(Boolean))].sort(),
    state: raw.gameState, scheduleState: raw.gameScheduleState, postponed, finished,
    status: cancelled ? 'CANCELLED' : !timeKnown || postponed || ifNecessary ? 'TENTATIVE' : 'CONFIRMED',
    seriesKey, seriesGameNumber, seriesOver, ifNecessary,
    stage: raw.gameType === 3 ? localized(series?.seriesTitle) || 'Stanley Cup Playoffs' : raw.gameType === 1 ? 'Preseason' : 'Regular season',
    raw,
  };
}

function validateSeason(season) {
  const year = Math.floor(season / 10000);
  if (!Number.isInteger(season) || year < 2021 || year > 2099 || season % 10000 !== year + 1) fail('invalid or unsupported season');
  return year;
}

function validateTeams(abbreviations) {
  if (!Array.isArray(abbreviations) || !abbreviations.length || abbreviations.length > 32 ||
      abbreviations.some(t => typeof t !== 'string' || !/^[A-Z]{2,3}$/.test(t)) || new Set(abbreviations).size !== abbreviations.length) fail('invalid team abbreviations');
}

function scheduleFacts(game) {
  return JSON.stringify([game.season, game.type, game.day, game.date, game.timeKnown,
    game.away.id, game.away.abbrev, game.home.id, game.home.abbrev, game.venue,
    game.state, game.scheduleState, game.seriesKey, game.seriesGameNumber, game.seriesOver]);
}

/** Accept raw per-team snapshots; return a JSON-safe cache containing both raw and normalized data. */
export function validateHockeySchedules(schedules, teamAbbrevs, season, now = new Date()) {
  validateTeams(teamAbbrevs);
  const year = validateSeason(season);
  if (!Number.isFinite(+new Date(now))) fail('invalid current date');
  const expectedRegular = year >= 2026 ? 84 : 82;
  const games = new Map();
  const counts = {};
  for (const abbreviation of teamAbbrevs) {
    const payload = schedules?.[abbreviation];
    if (!payload || payload.currentSeason !== season || !Array.isArray(payload.games) || payload.games.length > 130) fail(`${abbreviation}: missing, wrong-season or oversized schedule`);
    const ids = new Set();
    counts[abbreviation] = { regular: 0, playoffs: 0, preseason: 0 };
    for (const raw of payload.games) {
      const id = String(raw.id);
      if (!/^\d{10}$/.test(id) || !id.startsWith(`${year}${String(raw.gameType).padStart(2, '0')}`) ||
          raw.season !== season || ![1, 2, 3].includes(raw.gameType) || !validDay(raw.gameDate) ||
          raw.gameDate < `${year}-07-01` || raw.gameDate >= `${year + 1}-09-01`) fail(`${abbreviation}: invalid game identity, type, season or date`);
      if (ids.has(id)) fail(`${abbreviation}: duplicate game ${id}`);
      ids.add(id);
      const participants = [raw.awayTeam, raw.homeTeam];
      if (participants.some(t => !t || !positive(t.id) || !/^[A-Z]{2,3}$/.test(t.abbrev || '')) ||
          participants[0].id === participants[1].id || participants[0].abbrev === participants[1].abbrev ||
          !participants.some(t => t.abbrev === abbreviation)) fail(`${abbreviation}: wrong or missing game participants`);
      if (typeof raw.gameState !== 'string' || !raw.gameState || typeof raw.gameScheduleState !== 'string' || !raw.gameScheduleState) fail(`${abbreviation}: missing game state`);
      if (raw.startTimeUTC != null && raw.startTimeUTC !== '' && !validInstant(raw.startTimeUTC)) fail(`${abbreviation}: malformed game time`);
      const game = normalizeHockeyGame(raw);
      counts[abbreviation][{ 1: 'preseason', 2: 'regular', 3: 'playoffs' }[game.type]]++;
      const existing = games.get(id);
      if (existing && scheduleFacts(existing) !== scheduleFacts(game)) fail(`conflicting team snapshots for shared game ${id}`);
      if (existing) existing.channels = [...new Set([...existing.channels, ...game.channels])].sort();
      else games.set(id, game);
    }
    if (counts[abbreviation].regular !== expectedRegular) fail(`${abbreviation}: incomplete regular season (${counts[abbreviation].regular}/${expectedRegular})`);
    if (counts[abbreviation].playoffs > 28) fail(`${abbreviation}: unexpected playoff game count`);
  }
  return { season, games: [...games.values()].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id)), counts, schedules };
}

async function readJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_BYTES) fail('schedule response exceeds size limit');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_BYTES) fail('schedule response exceeds size limit');
    return JSON.parse(text);
  }
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); fail('schedule response exceeds size limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function fetchHockeySchedules(teamAbbrevs, season, now = new Date(), { fetchImpl = fetch, sleep = sleepDefault, warn } = {}) {
  validateTeams(teamAbbrevs);
  validateSeason(season);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await Promise.allSettled(teamAbbrevs.map(async abbreviation => {
        const response = await fetchImpl(`${API}/${abbreviation}/${season}`, {
          signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'FootballAndFriendsCalendar/1.0' },
        });
        if (!response.ok) fail(`${abbreviation}: source returned HTTP ${response.status}`);
        return [abbreviation, await readJson(response)];
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      return validateHockeySchedules(Object.fromEntries(results.map(result => result.value)), teamAbbrevs, season, now);
    } catch (error) {
      if (attempt === 2) throw new Error(`NHL schedules failed after 3 attempts: ${error.message}`, { cause: error });
      warn?.(`NHL source retry ${attempt + 1}/2: ${error.message}`);
      await sleep(1000 * (attempt + 1));
    }
  }
}

export const hockeyUid = id => `nhl-${id}@football-watchlist`;

export function hockeyEvent(game, config = {}) {
  const timed = game.timeKnown && !game.postponed;
  const playoff = game.type === 3;
  const matchup = `${game.away.name} at ${game.home.name}`;
  let title = `NHL: ${matchup}${playoff ? ` - ${game.stage}${game.seriesGameNumber ? ` Game ${game.seriesGameNumber}` : ''}` : game.type === 1 ? ' [preseason]' : ''}`;
  if (game.ifNecessary) title += ' [if necessary]';
  if (game.postponed) title += ' [postponed / time TBA]';
  else if (!timed) title += ' [time TBA]';
  if (game.status === 'CANCELLED') title = `Cancelled: ${title}`;
  const followed = [game.away, game.home].filter(t => (config.teamAbbreviations || []).includes(t.abbrev));
  const description = [
    followed.length ? `Following ${followed.map(t => t.name).join(' and ')}: every regular-season game and announced playoff game.` : 'Added to the hockey watchlist.',
    playoff ? 'Playoff games are added as the NHL announces them. Later games may depend on series results.' : '',
    game.postponed ? 'The original start time is no longer a viewing appointment. This marker will update when the NHL confirms the revised schedule.' :
      timed ? 'Viewing window: 3 hours; finish is approximate and playoff overtime can run longer.' : 'Start time is unconfirmed. This all-day marker will become a timed event when announced.',
    game.channels.length ? `Listed broadcasts: ${game.channels.join(' / ')}. Availability varies by country and provider.` : 'Broadcast to be announced.',
    `Official schedule: ${game.url}`,
  ].filter(Boolean).join('\n\n');
  return {
    uid: hockeyUid(game.id), gameId: game.id, nhlSeason: game.season, nhlGameType: game.type,
    nhlTeamAbbreviations: [game.away.abbrev, game.home.abbrev], nhlSeriesKey: game.seriesKey,
    nhlSeriesGameNumber: game.seriesGameNumber, nhlIfNecessary: game.ifNecessary,
    title, start: timed ? game.date : game.day,
    end: timed ? new Date(Date.parse(game.date) + 3 * 3600000).toISOString() : addDays(game.day, 1),
    allDay: !timed, status: game.status, description, location: game.venue, url: game.url,
    categories: ['NHL', playoff ? 'Playoffs' : game.type === 1 ? 'Preseason' : 'Regular season', ...followed.map(t => t.name)],
  };
}

export const retainHockeyEvents = previous => previous.filter(isHockey).map(bare);

export function buildHockeyEvents(data, config, now = new Date(), previous = []) {
  if (config.enabled === false) return { events: [], warnings: [] };
  const excluded = new Set((config.excludeGameIds || []).map(String));
  const included = new Set((config.includeGameIds || []).map(String));
  const followed = new Set(config.teamAbbreviations || []);
  const games = new Map(data.games.map(game => [game.id, game]));
  const selected = game => !excluded.has(game.id) && (game.type !== 1 || config.includePreseason === true) &&
    (included.has(game.id) || [game.away.abbrev, game.home.abbrev].some(t => followed.has(t)));
  const events = new Map(data.games.filter(selected).map(game => [hockeyUid(game.id), hockeyEvent(game, config)]));
  const warnings = [];
  for (const old of previous.filter(isHockey)) {
    if (excluded.has(String(old.gameId)) || events.has(old.uid) || games.has(String(old.gameId))) continue;
    if (old.nhlGameType === 1 && config.includePreseason !== true) continue;
    if (old.nhlTeamAbbreviations?.length && !old.nhlTeamAbbreviations.some(t => followed.has(t)) && !included.has(String(old.gameId))) continue;
    const past = Date.parse(old.allDay ? `${old.start}T23:59:59Z` : old.start) < Date.parse(now);
    const clincher = old.nhlGameType === 3 && old.nhlSeriesKey && positive(old.nhlSeriesGameNumber) && data.games.some(game =>
      game.seriesKey === old.nhlSeriesKey && game.finished && game.seriesOver && positive(game.seriesGameNumber) && game.seriesGameNumber < old.nhlSeriesGameNumber);
    if (clincher && old.status !== 'CANCELLED') {
      events.set(old.uid, { ...bare(old), status: 'CANCELLED', title: `Cancelled: ${old.title}`,
        description: `No longer necessary: this playoff series has finished.\n\n${old.description}` });
    } else {
      events.set(old.uid, bare(old));
      if (!past && old.status !== 'CANCELLED') warnings.push(`NHL: game ${old.gameId} is missing from the latest schedule; retained its previous entry awaiting confirmation.`);
    }
  }
  return { events: [...events.values()], warnings };
}
