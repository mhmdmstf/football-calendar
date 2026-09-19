import {addDays, etDay} from './calendar.mjs';

const postseason = type => ['F','D','L','W'].includes(type);
const gap = value => value === '-' ? 0 : Number.isFinite(Number(value)) ? Number(value) : Infinity;
const behind = (team, other) => (other.wins - team.wins + team.losses - other.losses) / 2;
const amount = n => `${n} game${n === 1 ? '' : 's'}`;
const bare = ({hash, created, modified, sequence, ...event}) => event;
export const baseballUid = id => `mlb-${id}@football-watchlist`;

// Ratings describe live standings, not probabilities or predicted results.
export function baseballRaceRatings(standings, threshold = 5) {
  const ratings = new Map();
  for (const team of standings) {
    const reasons = [];
    let score = 0;
    const add = (value, reason) => { score = Math.max(score, value); reasons.push(reason); };
    const eliminated = team.eliminationNumber === 'E' && team.wildCardEliminationNumber === 'E';
    const division = standings.filter(t => t.divisionId === team.divisionId).sort((a,b) => a.divisionRank-b.divisionRank);
    const leader = division[0];
    if (!eliminated && !team.divisionChamp && team.eliminationNumber !== 'E') {
      const distance = team.id === leader?.id ? gap(division[1]?.divisionGamesBack) : gap(team.divisionGamesBack);
      if (distance <= threshold) {
        const position = distance === 0 ? 'tied for the division lead' : team.id === leader?.id ? `lead their division by ${amount(distance)}` : `${amount(distance)} behind the division lead`;
        add(65 - distance * 6, `${team.name}: ${position}.`);
      }
    }
    const wildcards = standings.filter(t => t.leagueId === team.leagueId && !t.divisionLeader && !t.divisionChamp)
      .sort((a,b) => a.wildCardRank-b.wildCardRank);
    const third = wildcards[2], outside = wildcards[3];
    if (!eliminated && !team.clinched && !team.divisionLeader && team.wildCardEliminationNumber !== 'E' && third && outside) {
      const inPosition = wildcards.slice(0,3).some(t => t.id === team.id);
      const distance = inPosition ? behind(outside, team) : behind(team, third);
      if (distance >= 0 && distance <= threshold) {
        const position = distance === 0 ? 'tied at the wild-card cutoff' : inPosition ? `${amount(distance)} ahead of the first team outside the wild cards` : `${amount(distance)} behind the final wild-card spot`;
        add(65 - distance * 6, `${team.name}: ${position}.`);
      }
    }
    if (team.clinched && standings.some(t => t.id !== team.id && t.leagueId === team.leagueId && t.clinched && Math.abs(behind(team,t)) <= 2)) {
      add(18, `${team.name}: already qualified; close records keep postseason home-field positioning in play.`);
    }
    ratings.set(team.id, {score, reasons, eliminated});
  }
  return ratings;
}

export function selectBaseball(games, standings, config, now, previous = []) {
  const selected = new Map();
  const today = etDay(now), limit = addDays(today, config.selectionHorizonDays ?? 10);
  const favorites = new Set((config.favoriteTeamIds || []).map(String));
  const excluded = new Set((config.excludeGameIds || []).map(String));
  const included = new Set((config.includeGameIds || []).map(String));
  const old = new Set(previous.filter(e => e.categories.includes('MLB')).map(e => e.gameId));
  for (const game of games) {
    if (excluded.has(game.id)) continue;
    if (postseason(game.type)) selected.set(game.id, ['MLB postseason: every game, from the Wild Card Series through the World Series.']);
    else if (included.has(game.id)) selected.set(game.id, ['Added to the baseball watchlist.']);
  }
  const ratings = baseballRaceRatings(standings, config.gamesBackThreshold ?? 5);
  const candidates = games.filter(g => g.type === 'R' && g.day >= today && g.day < limit &&
    !g.finished && g.status !== 'CANCELLED' && !/postpon|suspend/i.test(g.state) &&
    (!g.timeKnown || Date.parse(g.date) >= Date.parse(now)) && !excluded.has(g.id)).map(game => {
    const teams = [game.away, game.home];
    const stakes = teams.map(t => ratings.get(t.id) || {score:0,reasons:[]});
    const meaningful = stakes.filter(s => s.score > 0);
    if (!meaningful.length) return null;
    const followed = teams.filter(t => favorites.has(t.id));
    const direct = meaningful.length === 2 && teams[0].leagueId === teams[1].leagueId;
    const score = Math.max(...stakes.map(s=>s.score)) + (direct ? 24 : meaningful.length === 2 ? 8 : 0) +
      followed.length * 12 + (old.has(game.id) ? 4 : 0);
    const reasons = [...(direct ? ['Two teams with live postseason stakes meet directly.'] : []), ...stakes.flatMap(s=>s.reasons),
      ...(followed.length ? [`Following ${followed.map(t=>t.name).join(' and ')}.`] : []), `Standings snapshot: ${today}.`];
    return {game, score, reasons, series:game.seriesKey || `${game.away.id}/${game.home.id}`};
  }).filter(Boolean);
  const seriesCounts = new Map(), playedByDay = new Map();
  // Earlier picks in this same series still consume its allowance tomorrow.
  for (const event of previous.filter(e=>e.mlbGameType === 'R' && e.status !== 'CANCELLED')) {
    const game = games.find(g=>g.id === event.gameId);
    if (game && game.status !== 'CANCELLED' && (game.finished || Date.parse(game.date) < Date.parse(now) && !/postpon|suspend/i.test(game.state))) {
      if(event.mlbSeriesKey) seriesCounts.set(event.mlbSeriesKey,(seriesCounts.get(event.mlbSeriesKey) || 0)+1);
      playedByDay.set(game.day,(playedByDay.get(game.day) || 0)+1);
    }
  }
  for (const day of [...new Set(candidates.map(c=>c.game.day))].sort()) {
    const choices = candidates.filter(c=>c.game.day === day).sort((a,b) =>
      (b.score - (seriesCounts.get(b.series) || 0)*25) - (a.score - (seriesCounts.get(a.series) || 0)*25) ||
      a.game.date.localeCompare(b.game.date) || a.game.id.localeCompare(b.game.id));
    let count = games.filter(g=>g.type === 'R' && g.day === day && selected.has(g.id)).length + (playedByDay.get(day) || 0);
    for (const candidate of choices) {
      if (count >= (config.gamesPerDay ?? 1)) break;
      if (selected.has(candidate.game.id) || (seriesCounts.get(candidate.series) || 0) >= (config.gamesPerSeries ?? 2)) continue;
      selected.set(candidate.game.id,candidate.reasons);
      seriesCounts.set(candidate.series,(seriesCounts.get(candidate.series) || 0)+1);
      count++;
    }
  }
  return selected;
}

export function baseballEvent(game, reasons, config = {}) {
  const playoff = postseason(game.type);
  const postponed = /postpon|suspend/i.test(game.state);
  const timed = game.timeKnown && !postponed;
  const matchup = `${game.away.name} at ${game.home.name}`;
  let title = `MLB: ${playoff ? `${game.stage} - ` : ''}${matchup}`;
  if (game.ifNecessary && game.status !== 'CANCELLED') title += ' [if necessary]';
  if (postponed) title += ' [postponed / time TBA]';
  else if (!timed) title += ' [time TBA]';
  if (game.status === 'CANCELLED') title = `Cancelled: ${title}`;
  const description = [reasons.join('\n'),
    playoff && game.ifNecessary ? 'This game is only played if the series requires it. It will be cancelled in this feed if no longer needed.' : '',
    [game.away,game.home].some(t=>t.placeholder) ? 'Bracket positions are placeholders. Teams will update when MLB confirms the matchup.' : '',
    postponed ? 'The original start time is no longer a viewing appointment. This marker will update when MLB supplies the revised schedule.' :
      timed ? `Viewing window: ${playoff ? 3.5 : 3} hours; finish is approximate.` : 'First pitch has not been announced. This all-day marker will become a timed event when confirmed.',
    game.pitchers?.length ? `Probable pitchers (subject to change): ${game.pitchers.join(' / ')}.` : '',
    game.channels?.length ? `Listed broadcasts: ${game.channels.join(' / ')}. Availability varies by country and provider.` : 'Broadcast to be announced.',
    `Official schedule: ${game.url}`].filter(Boolean).join('\n\n');
  return {uid:baseballUid(game.id),gameId:game.id,mlbSeason:game.season,mlbGameType:game.type,
    mlbSeriesKey:game.seriesKey,mlbSeriesGameNumber:game.seriesGameNumber,mlbIfNecessary:game.ifNecessary,
    mlbTeamIds:[game.away.id,game.home.id],selectionReasons:reasons,
    title,start:timed ? new Date(game.date).toISOString() : game.day,
    end:timed ? new Date(Date.parse(game.date)+(playoff ? 3.5 : 3)*3600000).toISOString() : addDays(game.day,1),
    allDay:!timed,description,location:game.venue,url:game.url,
    status:game.status === 'CANCELLED' ? 'CANCELLED' : !timed || game.ifNecessary || [game.away,game.home].some(t=>t.placeholder) ? 'TENTATIVE' : game.status,
    categories:['MLB',playoff ? 'Playoffs' : 'Pennant race',...[game.away,game.home].filter(t=>(config.favoriteTeamIds || []).includes(t.id)).map(t=>t.name)]};
}

export function buildBaseballEvents(data, config, now, previous = []) {
  const prior = previous.filter(e=>e.categories.includes('MLB'));
  const games = new Map(data.games.map(g=>[g.id,g]));
  const picks = selectBaseball(data.games,data.standings,config,now,prior);
  const events = new Map(), warnings = [];
  for (const [id,reasons] of picks) events.set(baseballUid(id),baseballEvent(games.get(id),reasons,config));
  for (const old of prior) {
    if((config.excludeGameIds || []).includes(old.gameId)) continue;
    const game = games.get(old.gameId);
    const past = Date.parse(old.allDay ? `${old.start}T23:59:59Z` : old.start) < Date.parse(now);
    const seriesFinished = !game && old.mlbIfNecessary && old.mlbSeriesKey && Number.isInteger(old.mlbSeriesGameNumber) && old.mlbSeriesGameNumber > 0 && data.games.some(g =>
      g.seriesKey === old.mlbSeriesKey && g.finished && g.seriesOver && Number.isInteger(g.seriesGameNumber) && g.seriesGameNumber > 0 && g.seriesGameNumber < old.mlbSeriesGameNumber);
    if (seriesFinished && old.status !== 'CANCELLED') {
      events.set(old.uid,{...bare(old),status:'CANCELLED',title:`Cancelled: ${old.title}`,
        description:`No longer necessary: this postseason series has finished.\n\n${old.description}`});
    } else if (game?.status === 'CANCELLED' || game && (past || /postpon|suspend/i.test(game.state))) {
      events.set(old.uid,baseballEvent(game,old.selectionReasons || ['Previously selected for the watchlist.'],config));
    } else if (!events.has(old.uid) && !game && (past || old.categories.includes('Playoffs'))) {
      events.set(old.uid,bare(old));
      if (!past && old.status !== 'CANCELLED') warnings.push(`MLB: awaiting confirmation for missing playoff game ${old.gameId}; retained its previous entry.`);
    }
  }
  return {events:[...events.values()],warnings};
}

export const retainBaseballEvents = previous => previous.filter(e=>e.categories.includes('MLB')).map(bare);
