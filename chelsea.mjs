import { addDays } from './calendar.mjs';

const ORIGIN = 'https://www.chelseafc.com';
const PAGE_ID = '30EGwHPO9uwBCc75RQY6kg';
const MAX_BYTES = 8 * 1024 * 1024;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const bare = ({ hash, created, modified, sequence, ...event }) => event;
const fail = message => { throw new Error(`Chelsea: ${message}`); };
const isChelsea = event => event.categories?.includes('Chelsea');
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
const positiveId = value => /^\d+$/.test(String(value)) && Number(value) > 0;

export function chelseaSeason(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(+date)) fail('invalid current date');
  return date.getUTCFullYear() - (date.getUTCMonth() < 7 ? 1 : 0);
}

/** Parse the club's English date strings, including its four-letter "Sept" spelling. */
export function parseChelseaDay(value) {
  const match = String(value || '').match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (!match) fail(`invalid fixture date: ${value}`);
  const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
  const day = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  if (!month || !Number.isFinite(Date.parse(day)) || !new Date(day).toISOString().startsWith(day)) fail(`invalid fixture date: ${value}`);
  return day;
}

function londonParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}

export function londonToUtc(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('invalid London date/time');
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(utc));
    utc += wall - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  const p = londonParts(new Date(utc));
  if (`${p.year}-${p.month}-${p.day}` !== day || +p.hour !== hour || +p.minute !== minute) fail('invalid or nonexistent London date/time');
  return new Date(utc).toISOString();
}

function competition(raw) {
  const name = raw.competition.trim();
  const friendly = /friendly|sydney super cup|florida cup|premier league summer series/i.test(name) || /-friendly-/i.test(raw.ctas?.matchCentreLink?.url || '');
  const slugs = {
    'Premier League': 'eng.1', 'Carabao Cup': 'eng.league_cup', 'FA Cup': 'eng.fa', 'Emirates FA Cup': 'eng.fa',
    'UEFA Champions League': 'uefa.champions', 'Champions League': 'uefa.champions',
    'UEFA Europa League': 'uefa.europa', 'Europa League': 'uefa.europa',
    'UEFA Conference League': 'uefa.europa.conf', 'Conference League': 'uefa.europa.conf',
    'FIFA Club World Cup': 'fifa.cwc', 'Club World Cup': 'fifa.cwc',
  };
  return { name, slug: friendly ? 'club.friendly' : slugs[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    isTournament: !friendly && name !== 'Premier League', friendly };
}

export function normalizeChelseaGame(raw, season) {
  const day = parseChelseaDay(raw.kickoffDate);
  const state = raw.status || raw.matchUp?.status || '';
  const cancelled = /cancelled|canceled/i.test(state);
  const postponed = raw.postponed === true || raw.matchUp?.postponed === true || /postponed|abandoned|suspended/i.test(state);
  const tbc = raw.tbc ?? raw.matchUp?.tbc;
  const clock = raw.kickoffTime || raw.matchUp?.kickoffTime || '';
  const validClock = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock);
  const timeKnown = tbc === false && raw.matchUp?.tbc !== true && validClock && !postponed;
  const comp = competition(raw);
  const matchPath = raw.ctas?.matchCentreLink?.url;
  const url = typeof matchPath === 'string' && matchPath.startsWith('/en/match/') ? `${ORIGIN}${matchPath}` : `${ORIGIN}/en/matches/mens-fixtures-and-results`;
  return {
    id: String(raw.optaId), season: season ?? chelseaSeason(`${day}T12:00:00Z`), day,
    date: validClock ? londonToUtc(day, clock) : null, timeKnown,
    away: { name: raw.matchUp.away.clubName }, home: { name: raw.matchUp.home.clubName },
    competition: comp, friendly: comp.friendly, venue: raw.venue || '', url, channels: [], state,
    status: cancelled ? 'CANCELLED' : timeKnown ? 'CONFIRMED' : 'TENTATIVE',
    finished: !cancelled && !postponed && (state === 'PostMatch' || raw.isResult === true || raw.matchUp?.isResult === true),
    inProgress: !cancelled && !postponed && (state === 'Live' || raw.isLive === true || raw.matchUp?.isLive === true),
    postponed, raw,
  };
}

function flatten(payload, kind) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length > 30) fail(`${kind}: missing or oversized fixture groups`);
  const games = [];
  for (const group of payload.items) {
    if (!Array.isArray(group.items)) fail(`${kind}: malformed fixture group`);
    games.push(...group.items);
  }
  for (const latest of [payload.latestResult?.fixture, payload.latest?.fixture]) if (latest) games.push(latest);
  if (games.length > 200) fail(`${kind}: oversized fixture list`);
  return games;
}

function facts(game) {
  return JSON.stringify([game.id, game.season, game.day, game.date, game.timeKnown, game.away.name,
    game.home.name, game.competition.slug, game.venue, game.status, game.postponed]);
}

/** Both official snapshots are required; no inferred cup rounds or invented opponents. */
export function validateChelseaSchedules(schedules, season, now = new Date()) {
  if (!Number.isInteger(season) || season < 2020 || season > 2099 || !Number.isFinite(+new Date(now))) fail('invalid season or current date');
  const selections = schedules?.results?.seasons?.filter(s => s.selectedValue === true);
  const label = `${season}/${String(season + 1).slice(-2)}`;
  if (!Array.isArray(selections) || selections.length !== 1 || selections[0].displayText !== label) {
    fail(`results season changed or is unverified; expected ${label}. Keep the last good schedule until the season rollover.`);
  }
  const games = new Map();
  for (const kind of ['results', 'fixtures']) {
    if (Array.isArray(schedules[kind]?.competitions)) {
      const selected = schedules[kind].competitions.filter(item => item.selectedValue === true);
      if (selected.length !== 1 || !/^all competitions$/i.test(String(selected[0].displayText || '').trim())) fail(`${kind}: source competition filter is not All Competitions`);
    }
    for (const raw of flatten(schedules[kind], kind)) {
      if (!raw || !positiveId(raw.optaId) || typeof raw.competition !== 'string' || !raw.competition.trim()) fail(`${kind}: missing fixture identity or competition`);
      const teams = [raw.matchUp?.home?.clubName, raw.matchUp?.away?.clubName];
      if (teams.some(name => typeof name !== 'string' || !name.trim()) || teams[0] === teams[1] || teams.filter(name => name === 'Chelsea').length !== 1) fail(`${kind}: wrong or missing Chelsea fixture participants`);
      if (typeof (raw.tbc ?? raw.matchUp?.tbc) !== 'boolean' || typeof (raw.status || raw.matchUp?.status) !== 'string') fail(`${kind}: missing fixture status or confirmation flag`);
      const game = normalizeChelseaGame(raw, season);
      // A season can include June/July tournaments and preseason. League dates still identify its own season.
      if (game.day < `${season}-06-01` || game.day >= `${season + 1}-08-01` ||
          game.competition.slug === 'eng.1' && (game.day < `${season}-08-01` || game.day >= `${season + 1}-07-01`)) {
        fail(`${kind}: fixture ${game.id} is outside season ${label}; the upcoming endpoint may have switched seasons`);
      }
      if ((raw.tbc ?? raw.matchUp?.tbc) === false && !game.date && !game.postponed && game.status !== 'CANCELLED') fail(`${kind}: confirmed fixture has no valid kickoff`);
      const existing = games.get(game.id);
      if (existing && facts(existing) !== facts(game)) fail(`conflicting snapshots for fixture ${game.id}`);
      // A completed record may overlap a still-scheduled copy while the two endpoints update.
      if (!existing || game.finished || game.inProgress && !existing.finished) games.set(game.id, game);
    }
  }
  const list = [...games.values()].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const premierLeague = list.filter(game => game.competition.slug === 'eng.1').length;
  if (premierLeague !== 38) fail(`incomplete Premier League season (${premierLeague}/38); keeping the last good schedule`);
  const byCompetition = {};
  for (const game of list) byCompetition[game.competition.slug] = (byCompetition[game.competition.slug] || 0) + 1;
  const friendlies = list.filter(game => game.friendly).length;
  return { season, games: list, counts: { premierLeague, competitive: list.length - friendlies, friendlies, total: list.length, byCompetition }, schedules };
}

async function readJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_BYTES) fail('source response exceeds size limit');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_BYTES) fail('source response exceeds size limit');
    return JSON.parse(text);
  }
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
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function fetchChelseaSchedules(season, now = new Date(), { fetchImpl = fetch, sleep = sleepDefault, warn } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await Promise.allSettled([['results', 'results'], ['fixtures', 'upcoming']].map(async ([kind, path]) => {
        const response = await fetchImpl(`${ORIGIN}/en/api/fixtures/${path}?pageId=${PAGE_ID}`, {
          signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'FootballAndFriendsCalendar/1.0' },
        });
        if (!response.ok) fail(`${kind}: source returned HTTP ${response.status}`);
        return [kind, await readJson(response)];
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      return validateChelseaSchedules(Object.fromEntries(results.map(result => result.value)), season, now);
    } catch (error) {
      if (attempt === 2) throw new Error(`Chelsea schedules failed after 3 attempts: ${error.message}`, { cause: error });
      warn?.(`Chelsea source retry ${attempt + 1}/2: ${error.message}`);
      await sleep(1000 * (attempt + 1));
    }
  }
}

export const chelseaUid = id => `chelsea-${id}@football-watchlist`;

export function chelseaEvent(game, now = new Date()) {
  const timed = game.timeKnown && !game.postponed;
  const hours = game.competition.isTournament ? 2.5 : 2;
  let title = `${game.home.name} vs ${game.away.name} - ${game.competition.name}`;
  if (game.postponed) title += ' [postponed / date and time TBC]';
  else if (!timed) title += ' [date/time TBC]';
  if (game.status === 'CANCELLED') title = `Cancelled: ${title}`;
  const description = [
    'Chelsea men: every competitive fixture published by the club.',
    game.friendly ? 'Friendly included by calendar preference.' : '',
    game.postponed ? 'The original kickoff is no longer a viewing appointment. This marker will update when the club confirms the revised fixture.' :
      timed ? `The club currently lists this kickoff as confirmed. Viewing window: ${hours} hours; finish is approximate${game.competition.isTournament ? ' and extra time or penalties may run longer' : ''}.` :
        'The club marks this fixture TBC. The date shown is provisional; the date and kickoff may change for television or cup scheduling. This transparent all-day marker will update when confirmed.',
    'Fixtures remain subject to later rescheduling. The feed refreshes from Chelsea’s official schedule.',
    `Official match: ${game.url}`,
  ].filter(Boolean).join('\n\n');
  return {
    uid: chelseaUid(game.id), gameId: game.id, chelseaSeason: game.season,
    chelseaCompetition: game.competition.slug, chelseaFriendly: game.friendly,
    title, start: timed ? game.date : game.day,
    end: timed ? new Date(Date.parse(game.date) + hours * 3600000).toISOString() : addDays(game.day, 1),
    allDay: !timed, status: game.status === 'CANCELLED' ? 'CANCELLED' : timed ? 'CONFIRMED' : 'TENTATIVE',
    description, location: game.venue, url: game.url, categories: ['Soccer', 'Chelsea', game.competition.name],
  };
}

export const retainChelseaEvents = previous => previous.filter(isChelsea).map(bare);

export function buildChelseaEvents(data, config, now = new Date(), previous = []) {
  if (config.enabled === false) return { events: [], warnings: [] };
  const excluded = new Set((config.excludeGameIds || []).map(String));
  const games = new Map(data.games.map(game => [game.id, game]));
  const selected = game => !excluded.has(game.id) && (!game.friendly || config.includeFriendlies === true);
  const events = new Map(data.games.filter(selected).map(game => [chelseaUid(game.id), chelseaEvent(game, now)]));
  const warnings = [];
  for (const old of previous.filter(isChelsea)) {
    if (excluded.has(String(old.gameId)) || events.has(old.uid) || games.has(String(old.gameId)) ||
        old.chelseaFriendly && config.includeFriendlies !== true) continue;
    events.set(old.uid, bare(old));
    const past = Date.parse(old.allDay ? `${old.start}T23:59:59Z` : old.start) < Date.parse(now);
    if (!past && old.status !== 'CANCELLED') warnings.push(`Chelsea: fixture ${old.gameId} is missing from the club schedule; retained its previous entry awaiting confirmation.`);
  }
  return { events: [...events.values()], warnings };
}
