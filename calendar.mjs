import { createHash } from 'node:crypto';

export const etParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(new Date(date)).map(p => [p.type, p.value]));
export function etDay(date) {
  const p = etParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
export function atEastern(day, hour, minute = 0) {
  const target = Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  let candidate = target;
  for (let i = 0; i < 3; i++) {
    const p = etParts(candidate);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    candidate += target - represented;
  }
  return new Date(candidate).toISOString();
}
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escapeText = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function foldLine(line) {
  const parts = []; let chunk = ''; let bytes = 0;
  for (const c of line) {
    const size = Buffer.byteLength(c);
    if (bytes + size > 75) { parts.push(chunk); chunk = ' '; bytes = 1; }
    chunk += c; bytes += size;
  }
  parts.push(chunk);
  return parts.join('\r\n');
}
export function renderCalendar(events, name) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Football Worth Watching//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:UTC', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeText(e.uid)}`, `DTSTAMP:${stamp(e.modified)}`,
      `CREATED:${stamp(e.created)}`, `LAST-MODIFIED:${stamp(e.modified)}`, `SEQUENCE:${e.sequence}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.end.replace(/-/g, '')}`);
    else lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`);
    lines.push(`SUMMARY:${escapeText(e.title)}`, `DESCRIPTION:${escapeText(e.description)}`,
      `LOCATION:${escapeText(e.location)}`, `URL:${e.url || 'https://www.espn.com/college-football/schedule'}`,
      `CATEGORIES:${e.categories.map(escapeText).join(',')}`, `STATUS:${e.status}`,
      // Watch windows block time; TBD all-day placeholders must not block an entire day.
      `TRANSP:${e.allDay || e.status === 'CANCELLED' ? 'TRANSPARENT' : 'OPAQUE'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
export function normalize(e, league) {
  const c = e.competitions?.[0];
  if (!c || !e.id || !e.date || !e.season) throw new Error(`Invalid ${league} event`);
  const teams = (c.competitors || []).map(t => ({
    id: String(t.team?.id || t.id || ''), name: t.team?.displayName || 'TBD',
    short: t.team?.location || t.team?.shortDisplayName || 'TBD',
    rank: t.curatedRank?.current > 0 && t.curatedRank.current <= 25 ? t.curatedRank.current : null,
    side: t.homeAway
  }));
  const venue = c.venue || {};
  return { id: String(e.id), league, season: e.season.year, seasonType: e.season.type,
    week: e.week?.number || 0, date: e.date, day: etDay(e.date),
    timeKnown: c.timeValid === true && !c.status?.isTBDFlex,
    teams, home: teams.find(t => t.side === 'home'), away: teams.find(t => t.side === 'away'),
    venue: [venue.fullName, venue.address?.city, venue.address?.state, venue.address?.country].filter(Boolean).join(', '),
    country: venue.address?.country || '',
    channels: [...new Set([...(c.broadcasts || []).flatMap(b => b.names || []), ...(c.geoBroadcasts || []).filter(b => b.region === 'us').map(b => b.media?.shortName).filter(Boolean)])],
    notes: (c.notes || []).map(n => n.headline || '').join('; '),
    spread: typeof c.odds?.[0]?.spread === 'number' ? Math.abs(c.odds[0].spread) : null,
    url: e.links?.find(l => l.rel?.includes('summary'))?.href || `https://www.espn.com/${league === 'nfl' ? 'nfl' : 'college-football'}/game/_/gameId/${e.id}`,
    status: /cancel/i.test(c.status?.type?.name || '') ? 'CANCELLED' : /postpon/i.test(c.status?.type?.name || '') ? 'TENTATIVE' : 'CONFIRMED'
  };
}
export function gameEvent(g, reasons) {
  const playoff = g.seasonType === 3 && (g.league === 'nfl' || /college football playoff/i.test(g.notes));
  const matchup = g.league === 'nfl' ? `${g.away?.name || 'TBD'} at ${g.home?.name || 'TBD'}` : `${g.away?.short || 'TBD'} at ${g.home?.short || 'TBD'}`;
  const unknownTeams = g.teams.every(t => t.name === 'TBD');
  const prefix = g.league === 'nfl' ? 'NFL' : 'CFB';
  const stage = playoff ? g.notes.replace(/College Football Playoff/g, 'CFP').replace(/ Presented by .*/i, '') : '';
  let title = unknownTeams && stage ? `${stage} - teams TBA` : `${prefix}: ${matchup}${stage ? ` (${stage})` : ''}`;
  if (!g.timeKnown) title += ' [time TBA]';
  const desc = [reasons.join('\n'), g.notes, `Teams: ${g.away?.name || 'TBD'} at ${g.home?.name || 'TBD'}`,
    g.channels.length ? `US broadcast: ${g.channels.join(' / ')}. Availability elsewhere varies.` : 'Broadcast to be announced.',
    g.timeKnown ? 'Viewing window: 3.5 hours (4 hours for championships); finish is approximate.' : 'Kickoff has not been announced. This all-day marker will become a timed event when confirmed.',
    g.status === 'TENTATIVE' ? 'Schedule status: postponed or subject to confirmation.' : '',
    `Schedule: ${g.url}`].filter(Boolean).join('\n\n');
  return { uid: `${g.league}-${g.id}@football-watchlist`, gameId: g.id,
    title, start: g.timeKnown ? new Date(g.date).toISOString() : g.day,
    end: g.timeKnown ? new Date(Date.parse(g.date) + (/championship|super bowl/i.test(g.notes) ? 4 : 3.5) * 3600000).toISOString() : addDays(g.day, 1),
    allDay: !g.timeKnown, description: desc, location: g.venue, url: g.url,
    status: !g.timeKnown && g.status !== 'CANCELLED' ? 'TENTATIVE' : g.status,
    categories: [g.league === 'nfl' ? 'NFL' : 'College', ...(playoff ? ['Playoffs'] : [])] };
}
export function nflReasons(g) {
  if (g.seasonType === 3 && !/pro bowl/i.test(g.notes)) return ['NFL playoffs: every postseason game.'];
  if (g.seasonType !== 2) return [];
  const p = etParts(g.date), reasons = [];
  if (g.country && !['USA', 'US', 'United States', 'United States of America'].includes(g.country)) reasons.push(`International game: ${g.country}.`);
  if (g.timeKnown && p.weekday === 'Sun' && Number(p.hour) >= 19) reasons.push('Sunday Night Football.');
  if (p.weekday === 'Mon') reasons.push('Monday Night Football.');
  if (p.weekday === 'Thu') reasons.push('Thursday football, including Thanksgiving.');
  if (['Wed', 'Fri', 'Sat'].includes(p.weekday) && g.timeKnown) reasons.push('Standalone NFL game outside the regular Sunday afternoon slate.');
  return reasons;
}
export function selectCollege(games, config, featuredIds, now, previous = []) {
  const selected = new Map(); const futureLimit = Date.parse(now) + config.selectionHorizonDays * 86400000;
  const add = (g, reason) => { const a = selected.get(g.id) || []; if (!a.includes(reason)) a.push(reason); selected.set(g.id, a); };
  for (const g of games) {
    if (config.excludeGameIds.includes(g.id)) continue;
    const favorites = g.teams.filter(t => config.favoriteCollegeTeamIds.includes(t.id));
    if (favorites.length) add(g, `Following ${favorites.map(t=>t.short).join(' and ')}: every game.`);
    if (/college football playoff/i.test(g.notes)) add(g, 'College Football Playoff: every round.');
    if (g.seasonType === 2 && /championship/i.test(g.notes)) add(g, 'Conference championship.');
    for (const r of config.rivalries) if (r.teams.every(id => g.teams.some(t => t.id === id))) add(g, `Major rivalry: ${r.name}.`);
    if (featuredIds.includes(g.id)) add(g, 'Confirmed College GameDay or Big Noon featured matchup.');
    if (config.includeGameIds.includes(g.id)) add(g, 'Added to the watchlist.');
    const prior = previous.find(e => e.gameId === g.id && e.categories.includes('National pick'));
    if (prior && g.seasonType === 2) add(g, prior.selectionReason || 'Retained national watchlist selection.');
  }
  const weeks = games.filter(g=>g.seasonType===2).reduce((m, g) => { const k = `${g.season}-${g.week}`; m.set(k, [...(m.get(k) || []), g]); return m; }, new Map());
  for (const group of weeks.values()) {
    const countNational = () => group.filter(g => selected.has(g.id) && !g.teams.some(t => config.favoriteCollegeTeamIds.includes(t.id))).length;
    const candidates = group.filter(g => g.seasonType === 2 && !selected.has(g.id) && !config.excludeGameIds.includes(g.id) && Date.parse(g.date) >= Date.parse(now) && Date.parse(g.date) <= futureLimit).map(g => {
      const ranks = g.teams.map(t => t.rank).filter(Boolean).sort((a,b) => a-b);
      const rankedPair = ranks.length === 2;
      const competitive = g.spread !== null && g.spread <= 10;
      const upset = ranks.length === 1 && competitive;
      const holidayFeature = ranks.length > 0 && ['Sun','Mon'].includes(etParts(g.date).weekday) && g.channels.some(c=>['ABC','NBC','ESPN'].includes(c));
      let score = rankedPair ? 110 - ranks[0] - ranks[1] : upset ? 65 - ranks[0] - g.spread : 0;
      if(!score && holidayFeature) score=35-ranks[0];
      const reason = rankedPair ? `National pick: ranked matchup (#${ranks[0]} vs #${ranks[1]}) at selection.` : upset ? `National pick: a ranked team in a potentially competitive game (market spread ${g.spread} points at selection). Upset possibility is an estimate.` : 'National pick: Sunday or Monday national broadcast featuring a ranked team.';
      return {g,score,reason};
    }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.g.date.localeCompare(b.g.date) || a.g.id.localeCompare(b.g.id));
    for (const {g,reason} of candidates) { if (countNational() >= config.nationalGamesPerWeek) break; add(g,reason); }
  }
  return selected;
}
export function stabilize(events, previous, now) {
  const old = new Map(previous.map(e => [e.uid,e]));
  return events.map(e => {
    const hash = fingerprint(e); const prior = old.get(e.uid); const same = prior?.hash === hash;
    return {...e, hash, created: prior?.created || now, modified: same ? prior.modified : now, sequence: prior ? prior.sequence + (same ? 0 : 1) : 0};
  });
}
