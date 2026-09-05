const EASTERN = 'America/New_York';
const FOX_URL = 'https://www.foxsports.com/big-noon-kickoff-experience';
const ESPN_FEED = 'https://espnpressroom.com/?s=College+GameDay&feed=rss2';
const DAY = 86400000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const definitions = {
  gameday: { name: 'College GameDay', hour: 9, channel: 'ESPN', url: ESPN_FEED },
  bignoon: { name: 'Big Noon Kickoff', hour: 10, channel: 'FOX', url: FOX_URL },
};
const aliases = {
  '99': ['LSU', 'Louisiana State'], '228': ['Clemson'], '251': ['Texas'],
  '194': ['Ohio State'], '145': ['Ole Miss', 'Mississippi'], '249': ['North Texas'],
  '84': ['Indiana'], '201': ['Oklahoma'], '130': ['Michigan'],
  '2305': ['Kansas'], '9': ['Arizona State'],
};

// These announcements were verified on 2026-09-05. Live sources supplement them.
const announced = [
  { show: 'gameday', day: '2026-09-05', pair: ['99', '228'], location: 'Baton Rouge, Louisiana',
    url: 'https://lsusports.net/news/2026/05/12/lsu-to-host-espn-college-gameday-for-kiffin-debut' },
  { show: 'gameday', day: '2026-09-12', pair: ['251', '194'], location: 'Austin, Texas',
    url: 'https://espnpressroom.com/press-release/espns-college-gameday-built-by-the-home-depot-kicks-off-40th-season-in-baton-rouge-with-500th-show-on-the-road/' },
  { show: 'gameday', day: '2026-09-19', pair: ['99', '145'], location: 'The Grove, Oxford, Mississippi',
    url: 'https://olemisssports.com/news/2026/8/21/football-espn-college-gameday-coming-to-ole-miss-on-september-19' },
  { show: 'bignoon', day: '2026-09-05', pair: ['249', '84'], location: 'Bloomington, Indiana', url: FOX_URL },
  { show: 'bignoon', day: '2026-09-12', pair: ['201', '130'], location: 'Ann Arbor, Michigan',
    url: 'https://www.foxsports.com/stories/presspass/fox-sports-unveils-star-studded-2026-college-football-roster' },
  { show: 'bignoon', day: '2026-09-19', pair: ['2305', '9'], location: 'Wembley Stadium, London, United Kingdom',
    url: 'https://www.foxsports.com/stories/presspass/fox-sports-big-noon-kickoff-heads-across-pond-inaugural-union-jack-classic-from-wembley-stadium' },
  { show: 'bignoon', day: '2026-11-28', pair: ['130', '194'], location: 'Columbus, Ohio', hour: 9,
    url: 'https://www.foxsports.com/stories/presspass/fox-sports-unveils-powerhouse-2026-college-football-schedule' },
];

function dateParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: EASTERN, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
}

/** Convert an Eastern wall time to UTC, including US daylight-saving changes. */
export function easternToUtc(day, hour, minute = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('Invalid Eastern date/time');
  const [year, month, date] = day.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const p = dateParts(new Date(utc));
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    utc += wall - represented;
  }
  const p = dateParts(new Date(utc));
  if (`${p.year}-${p.month}-${p.day}` !== day || +p.hour !== hour || +p.minute !== minute) {
    throw new Error('Invalid or nonexistent Eastern wall time');
  }
  return new Date(utc).toISOString();
}

export function seasonSaturdays(year) {
  const september = new Date(Date.UTC(year, 8, 1));
  const laborDay = 1 + (8 - september.getUTCDay()) % 7;
  const first = Date.UTC(year, 8, laborDay - 2);
  const last = Date.UTC(year, 10, 30);
  const days = [];
  for (let time = first; time <= last; time += 7 * DAY) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

function plain(html) {
  return String(html).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ').trim();
}
function normalized(value) { return plain(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function teamNames(team) { return [...new Set([team.short, team.name, ...(aliases[String(team.id)] || [])].filter(Boolean).map(normalized))]; }
function containsTeam(text, team) {
  const padded = ` ${normalized(text)} `;
  return teamNames(team).some(name => padded.includes(` ${name} `));
}
function sameTeamName(team, name) { return teamNames(team).includes(normalized(name)); }
function matchesSeed(game, pair) {
  return game.teams?.length === 2 && pair.every(id => game.teams.some(team => String(team.id) === id ||
    (aliases[id] || []).some(name => sameTeamName(team, name))));
}
function matchup(game) { return game.teams.map(t => t.short || t.name).join(' vs. '); }
function parseDay(text, year) {
  const match = text.match(/\b(?:sat(?:urday)?)[,.]?\s+(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  const day = `${match[3] || year}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(+parsed) && parsed.getUTCDay() === 6 && parsed.toISOString().startsWith(day) ? day : null;
}

/** Only parse FOX's explicit show matchup card, never its noon game listings. */
export function parseFoxSchedule(html, games, now = new Date()) {
  const records = [];
  const cards = html.matchAll(/<div\b[^>]*class=["'][^"']*\bmatchup-body\b[^"']*["'][^>]*>\s*<div\b[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*>([\s\S]*?)<\/div>/gi);
  for (const card of cards) {
    const day = parseDay(plain(card[1]), +dateParts(new Date(now)).year);
    if (!day || Math.abs(+new Date(`${day}T12:00:00Z`) - +new Date(now)) > 21 * DAY) continue;
    const pair = plain(card[2]).split(/\s+vs\.?\s+/i);
    if (pair.length !== 2) continue;
    const matches = games.filter(g => g.day === day && g.teams?.length === 2 && pair.every(name => g.teams.some(t => sameTeamName(t, name))));
    if (matches.length === 1) records.push({ show: 'bignoon', day, gameId: String(matches[0].id),
      label: matchup(matches[0]), location: '', url: FOX_URL });
  }
  return records;
}

/** Reject ambiguous articles rather than guess which matchup GameDay is visiting. */
export function parseGameDayFeed(xml, games) {
  const records = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const value = tag => item[1].match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '';
    const title = plain(value('title'));
    if (!/college gameday/i.test(title) || /basketball/i.test(title)) continue;
    const published = new Date(plain(value('pubDate')));
    if (!Number.isFinite(+published)) continue;
    const body = value('content:encoded');
    const first = plain(body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || value('description'));
    if (!/gameday/i.test(first) || !/\b(?:show|pregame)\b/i.test(first)) continue;
    const day = parseDay(first, published.getUTCFullYear());
    if (!day || Math.abs(+new Date(`${day}T12:00:00Z`) - +published) > 21 * DAY) continue;
    const matches = games.filter(g => g.day === day && g.teams?.length === 2 && g.teams.every(t => containsTeam(first, t)));
    if (matches.length !== 1) continue;
    const timing = first.match(/from\s+(\d{1,2})(?::(\d{2}))?\s*a\.?m\.?\s+to\s+noon\s+ET/i);
    if (!timing || +timing[1] < 6 || +timing[1] > 11) continue;
    const url = plain(value('link'));
    if (!/^https:\/\/espnpressroom\.com\//.test(url)) continue;
    records.push({ show: 'gameday', day, gameId: String(matches[0].id), label: matchup(matches[0]),
      hour: +timing[1], minute: +(timing[2] || 0), location: '', url });
  }
  return records;
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FootballWatchlistCalendar/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function getShows(games, now = new Date(), { offline = false } = {}) {
  const warnings = [];
  const featuredIds = new Set();
  const seasons = new Set(games.map(g => Number(g.season)).filter(y => Number.isInteger(y) && y >= 2020 && y <= 2100));
  if (!seasons.size) {
    const p = dateParts(new Date(now));
    seasons.add(+p.year - (+p.month < 3 ? 1 : 0));
  }
  const known = new Map(announced.filter(r => seasons.has(+r.day.slice(0, 4))).map(r => [`${r.show}:${r.day}`, { ...r }]));
  if (!offline) {
    const sources = [{ name: 'Big Noon', url: FOX_URL, parse: text => parseFoxSchedule(text, games, now) },
      { name: 'College GameDay', url: ESPN_FEED, parse: text => parseGameDayFeed(text, games) }];
    const results = await Promise.allSettled(sources.map(async source => source.parse(await fetchText(source.url))));
    results.forEach((result, i) => {
      if (result.status === 'rejected') warnings.push(`${sources[i].name} announcement refresh failed: ${result.reason.message}. Retaining verified announcements; other sites remain TBA.`);
      else if (!result.value.length) warnings.push(`${sources[i].name}: no unambiguous current announcement matched the game schedule; retaining verified announcements and TBA placeholders.`);
      else for (const record of result.value) {
        const key = `${record.show}:${record.day}`;
        const previous = known.get(key);
        const sameGame = previous && games.some(g => String(g.id) === record.gameId &&
          (previous.gameId ? previous.gameId === record.gameId : matchesSeed(g, previous.pair)));
        known.set(key, { ...(sameGame ? previous : {}), ...record, location: record.location || (sameGame ? previous.location : '') || '' });
      }
    });
  }
  const days = new Set([...seasons].flatMap(seasonSaturdays));
  for (const record of known.values()) days.add(record.day);
  const events = [];
  for (const day of [...days].sort()) for (const [show, def] of Object.entries(definitions)) {
    const record = known.get(`${show}:${day}`);
    // Announced special dates do not imply that the other show is also airing.
    if (!record && ![...seasons].some(year => seasonSaturdays(year).includes(day))) continue;
    const game = record && games.find(g => g.day === day && (record.gameId ? String(g.id) === record.gameId : matchesSeed(g, record.pair)));
    if (game) featuredIds.add(String(game.id));
    const label = record?.location || record?.label || (record ? 'announced site' : 'location TBA');
    const startHour = record?.hour ?? def.hour;
    const description = record
      ? `${def.name} on ${def.channel}. ${game ? `Featured game: ${matchup(game)}. ` : ''}Broadcast window: ${startHour}:${String(record?.minute || 0).padStart(2, '0')} a.m. to noon Eastern. Broadcast schedules can change.\nSource: ${record.url}`
      : `Usual Saturday broadcast window: ${def.hour}:00 a.m. to noon Eastern on ${def.channel}. Location and this week's broadcast hours have not been confirmed. Tentative placeholder, subject to broadcast changes.\nSource: ${def.url}`;
    events.push({ uid: `show-${show}-${day}@football-watchlist`, title: `${def.name}: ${label}`,
      ...(game ? { gameId: String(game.id) } : {}),
      start: easternToUtc(day, startHour, record?.minute || 0), end: easternToUtc(day, 12), allDay: false,
      status: record ? 'CONFIRMED' : 'TENTATIVE', description, location: record?.location || '',
      url: record?.url || def.url, categories: ['College', 'Pregame'] });
  }
  return { events, featuredIds: [...featuredIds], warnings };
}
