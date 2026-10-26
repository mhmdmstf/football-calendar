import { addDays } from './calendar.mjs';

const bare = ({ hash, created, modified, sequence, ...event }) => event;
const isSoccer = event => event.uid?.startsWith('soccer-') && event.categories?.includes('Soccer');
const leagueOf = game => game.league || game.competition.slug;
const idsOf = game => [String(game.home.id), String(game.away.id)];
const knockoutStage = stage => /\b(?:quarter[\s-]?finals?|semi[\s-]?finals?|finals?|round of 16|knockout|play[\s-]?offs?)\b/i.test(stage || '');
const clubName = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clubAliases = new Map([
  ['internazionale', 'inter milan'], ['inter', 'inter milan'], ['milan', 'ac milan'],
  ['fc barcelona', 'barcelona'], ['bayern munchen', 'bayern munich'], ['fc bayern munchen', 'bayern munich'],
  ['atletico de madrid', 'atletico madrid'], ['paris saint germain', 'psg'], ['paris sg', 'psg'],
  ['olympique marseille', 'marseille'], ['olympique de marseille', 'marseille'], ['olympique lyonnais', 'lyon'],
  ['as monaco', 'monaco'], ['as roma', 'roma'], ['as saint etienne', 'saint etienne'],
  ['rc lens', 'lens'], ['lille osc', 'lille'], ['athletic club', 'athletic bilbao'],
]);
const canonical = name => clubAliases.get(clubName(name)) || clubName(name);
const notableClubs = new Set([
  'arsenal', 'liverpool', 'manchester city', 'manchester united', 'tottenham hotspur',
  'real madrid', 'barcelona', 'atletico madrid', 'bayern munich', 'borussia dortmund',
  'bayer leverkusen', 'rb leipzig', 'inter milan', 'ac milan', 'juventus', 'napoli', 'atalanta',
  'psg', 'marseille', 'lyon', 'monaco', 'benfica', 'porto', 'sporting cp', 'ajax',
]);
const rivalries = [
  ['real madrid', 'barcelona', 'El Clasico'], ['real madrid', 'atletico madrid', 'Madrid derby'],
  ['sevilla', 'real betis', 'Seville derby'], ['athletic bilbao', 'real sociedad', 'Basque derby'],
  ['bayern munich', 'borussia dortmund', 'Bayern-Dortmund rivalry'],
  ['borussia dortmund', 'schalke 04', 'Revierderby'],
  ['inter milan', 'ac milan', 'Milan derby'], ['juventus', 'inter milan', 'Derby d’Italia'],
  ['roma', 'lazio', 'Rome derby'], ['psg', 'marseille', 'Le Classique'],
  ['lens', 'lille', 'Derby du Nord'], ['lyon', 'saint etienne', 'Rhone-Alpes derby'],
  ['arsenal', 'tottenham hotspur', 'North London derby'], ['liverpool', 'everton', 'Merseyside derby'],
  ['manchester city', 'manchester united', 'Manchester derby'],
  ['liverpool', 'manchester united', 'Liverpool-Manchester United rivalry'],
];

export function soccerDay(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(+date)) throw new Error('Soccer: invalid current date');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function soccerWeek(day) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export const soccerUid = id => `soccer-${id}@football-watchlist`;
export const retainSoccerEvents = previous => previous.filter(isSoccer).map(bare);

/** Transparent selection rules: current table positions, major rivalries and prominent club pairings. */
export function rateSoccerGame(game, standings = {}) {
  const league = leagueOf(game), champions = league === 'uefa.champions';
  const table = standings[league] || {};
  const rows = [table[String(game.home.id)], table[String(game.away.id)]];
  const names = [canonical(game.home.name), canonical(game.away.name)];
  const rivalry = rivalries.find(([a, b]) => names.includes(a) && names.includes(b));
  const prominent = names.filter(name => notableClubs.has(name)).length;
  let score = champions ? 20 : 0;
  const reasons = [];
  if (rivalry) { score += 120; reasons.push(`Major rivalry: ${rivalry[2]}.`); }
  if (rows.every(row => Number.isInteger(row?.rank) && row.rank > 0 && row.played > 0)) {
    const ranks = rows.map(row => row.rank);
    const cutoff = champions ? 12 : 6;
    if (ranks.every(rank => rank <= cutoff)) {
      score += 90 + (cutoff * 2 - ranks[0] - ranks[1]);
      reasons.push(`Both clubs are in the current top ${cutoff}: ${game.home.name} #${ranks[0]}, ${game.away.name} #${ranks[1]}.`);
    } else if (!champions && Math.min(...ranks) <= 3 && Math.max(...ranks) <= (['fra.1', 'ger.1'].includes(league) ? 9 : 10)) {
      score += 55 + 20 - ranks[0] - ranks[1];
      reasons.push(`A current top-three club faces a top-half opponent: ${game.home.name} #${ranks[0]}, ${game.away.name} #${ranks[1]}.`);
    } else if (champions) {
      score += Math.max(0, 40 - ranks[0] - ranks[1]);
      reasons.push(`Champions League table: ${game.home.name} #${ranks[0]}, ${game.away.name} #${ranks[1]}.`);
    }
    // A close points gap is useful context only between teams already near the top.
    if (!champions && ranks.every(rank => rank <= 4) && rows.every(row => Number.isFinite(row.points))) {
      const gap = Math.abs(rows[0].points - rows[1].points);
      if (gap <= 6) { score += 15 - gap; reasons.push(`Top-four meeting with ${gap} point${gap === 1 ? '' : 's'} separating the teams.`); }
    }
  }
  if (prominent === 2) { score += 60; reasons.push('High-profile club matchup.'); }
  else if (champions && prominent === 1) score += 12;
  if (champions) {
    const knockout = knockoutStage(game.stage);
    if (knockout) { score += 100; reasons.unshift(`Champions League knockout tie${game.stage ? `: ${game.stage}` : ''}.`); }
    else reasons.unshift(`Champions League watchlist${game.stage ? `: ${game.stage}` : ''}.`);
  }
  return { score, reasons };
}

export function soccerEvent(game, selection = {}, now = new Date()) {
  const timed = game.timeKnown === true && !game.postponed && Number.isFinite(Date.parse(game.date));
  const cancelled = game.status === 'CANCELLED';
  const provisional = timed && game.timeConfirmed !== true && !game.finished;
  const league = leagueOf(game);
  const knockout = knockoutStage(game.stage) || /(?:\.fa|league_cup|copa|cup)/i.test(league);
  const hours = knockout ? 2.5 : 2;
  let title = `${game.home.name} vs ${game.away.name} - ${game.competition.name}`;
  if (game.postponed) title += ' [postponed / date and time TBC]';
  else if (!timed) title += ' [date/time TBC]';
  else if (provisional) title += ' [provisional]';
  if (cancelled) title = `Cancelled: ${title}`;
  const kind = selection.kind || 'followed';
  const reasons = selection.reasons || ['Following this club’s competitive fixtures.'];
  const selectedOn = selection.selectedOn || soccerDay(now);
  const description = [
    reasons.join('\n'),
    kind !== 'followed' ? `Selection made ${selectedOn}. Table positions describe that snapshot, not predicted results. Picks are kept once added.` : '',
    game.postponed ? 'The original kickoff is no longer a viewing appointment. This marker will update when a revised fixture is listed.' :
      !timed ? 'The date or kickoff is unconfirmed. This transparent all-day marker will update when a time is listed.' :
        provisional ? 'Provisional source-listed date and kickoff. ESPN does not reliably distinguish TV-confirmed dates from provisional fixtures; both may change. The calendar updates when the schedule changes.' : 'Kickoff shown in your calendar’s local time.',
    timed ? `Viewing window: ${hours} hours; finish is approximate${knockout ? ' and extra time or penalties can run longer' : ''}.` : '',
    `Schedule: ${game.url}`,
  ].filter(Boolean).join('\n\n');
  return {
    uid: soccerUid(game.id), gameId: String(game.id), soccerSeason: game.season,
    soccerLeague: league, soccerTeamIds: idsOf(game), soccerFriendly: game.friendly === true,
    soccerSelectionKind: kind, soccerSelectionWeek: selection.week || soccerWeek(game.day),
    soccerSelectionReasons: reasons, soccerSelectedOn: selectedOn,
    title, start: timed ? new Date(game.date).toISOString() : game.day,
    end: timed ? new Date(Date.parse(game.date) + hours * 3600000).toISOString() : addDays(game.day, 1),
    allDay: !timed, status: cancelled ? 'CANCELLED' : !timed || provisional ? 'TENTATIVE' : 'CONFIRMED',
    description, location: game.venue || '', url: game.url,
    categories: ['Soccer', kind === 'followed' ? 'Followed team' : 'European pick', game.competition.name],
  };
}

export function buildSoccerEvents(data, config, now = new Date(), previous = []) {
  if (config.enabled === false) return { events: [], warnings: [] };
  const today = soccerDay(now);
  const horizon = addDays(today, config.selectionHorizonDays ?? 14);
  const limit = data.window?.end && data.window.end < horizon ? data.window.end : horizon;
  const excluded = new Set((config.excludeGameIds || []).map(String));
  const followed = new Map((config.teams || []).map(team => [String(team.id), team.name]));
  const domesticLeagues = new Set(config.domesticLeagues || ['eng.1', 'ita.1', 'esp.1', 'ger.1', 'fra.1']);
  const games = new Map(data.games.map(game => [String(game.id), game]));
  const allowed = game => !excluded.has(String(game.id)) && !idsOf(game).includes('363') && !game.friendly;
  const favorites = game => idsOf(game).filter(id => followed.has(id));
  const events = new Map(), warnings = [];
  for (const game of games.values()) {
    if (!allowed(game) || !favorites(game).length) continue;
    const old = previous.find(event => event.uid === soccerUid(game.id));
    events.set(soccerUid(game.id), soccerEvent(game, {
      kind: 'followed', reasons: [`Following ${favorites(game).map(id => followed.get(id)).join(' and ')}: every competitive fixture.`],
      selectedOn: old?.soccerSelectedOn || today,
    }, now));
  }
  for (const old of previous.filter(isSoccer)) {
    if (events.has(old.uid) || excluded.has(String(old.gameId)) || old.soccerTeamIds?.includes('363') || old.soccerFriendly) continue;
    if (old.soccerSelectionKind === 'followed' && !old.soccerTeamIds?.some(id => followed.has(String(id)))) continue;
    const game = games.get(String(old.gameId));
    if (game && !allowed(game)) continue;
    if (game) {
      events.set(old.uid, soccerEvent(game, { kind: old.soccerSelectionKind,
        reasons: old.soccerSelectionReasons, selectedOn: old.soccerSelectedOn, week: old.soccerSelectionWeek }, now));
    } else {
      events.set(old.uid, bare(old));
      const day = old.start.slice(0, 10);
      const expected = old.soccerSelectionKind === 'followed' || day >= (data.window?.start || today) && day < limit;
      if (expected && day >= today && old.status !== 'CANCELLED') warnings.push(`Soccer: fixture ${old.gameId} is missing from the latest source; retained its previous entry awaiting confirmation.`);
    }
  }
  const weekCounts = new Map(), leagueCounts = new Map();
  const count = event => {
    if (event.status === 'CANCELLED' || event.soccerSelectionKind === 'followed') return;
    const kind = event.soccerLeague === 'uefa.champions' ? 'champions' : 'domestic';
    const key = `${event.soccerSelectionWeek}/${kind}`;
    weekCounts.set(key, (weekCounts.get(key) || 0) + 1);
    const leagueKey = `${event.soccerSelectionWeek}/${event.soccerLeague}`;
    leagueCounts.set(leagueKey, (leagueCounts.get(leagueKey) || 0) + 1);
  };
  for (const event of events.values()) count(event);
  const candidates = [...games.values()].filter(game => allowed(game) && !favorites(game).length && !events.has(soccerUid(game.id)) &&
    !game.finished && !game.postponed && game.status !== 'CANCELLED' && game.day >= today && game.day < limit &&
    (!game.timeKnown || Date.parse(game.date) >= Date.parse(now)) &&
    (domesticLeagues.has(leagueOf(game)) || leagueOf(game) === 'uefa.champions'))
    .map(game => ({ game, ...rateSoccerGame(game, data.standings) }))
    .filter(candidate => leagueOf(candidate.game) === 'uefa.champions' || candidate.score >= 50)
    .sort((a, b) => b.score - a.score || a.game.day.localeCompare(b.game.day) || String(a.game.id).localeCompare(String(b.game.id)));
  for (const { game, reasons } of candidates) {
    const league = leagueOf(game), week = soccerWeek(game.day);
    const kind = league === 'uefa.champions' ? 'champions' : 'domestic';
    const cap = kind === 'champions' ? config.championsGamesPerWeek ?? 4 : config.domesticGamesPerWeek ?? 6;
    if ((weekCounts.get(`${week}/${kind}`) || 0) >= cap ||
        kind === 'domestic' && (leagueCounts.get(`${week}/${league}`) || 0) >= (config.maxPerLeague ?? 2)) continue;
    const event = soccerEvent(game, { kind, reasons, selectedOn: today }, now);
    events.set(event.uid, event);
    count(event);
  }
  return { events: [...events.values()].sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid)), warnings };
}
