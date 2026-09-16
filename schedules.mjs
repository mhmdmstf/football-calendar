import { normalize } from './calendar.mjs';

const inSeason=now=>new Date(now).getUTCMonth()>=7 || new Date(now).getUTCMonth()<2;

export function validateSchedule(data, league, season, now) {
  if (!Array.isArray(data?.events) || data.events.length >= 1000) {
    throw new Error(`${league}: missing or possibly truncated schedule`);
  }
  const games = data.events.map((event, index) => {
    try { return normalize(event, league); }
    catch (cause) { throw new Error(`${league}: invalid event ${event?.id || `at index ${index}`} (${cause.message})`, {cause}); }
  }).filter(g=>g.season===season && [2,3].includes(g.seasonType));
  if (inSeason(now) && games.length < (league==='nfl' ? 250 : 650)) {
    throw new Error(`${league}: unexpectedly incomplete in-season schedule (${games.length})`);
  }
  return games;
}

// A successful HTTP response may still contain an incomplete ESPN snapshot.
// Retry fetching AND validation together; return only a complete usable snapshot.
async function fetchValidated(url, league, validate, {
  fetchImpl=fetch,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  warn=message=>console.warn(message)
}={}) {
  for(let attempt=0; attempt<3; attempt++) {
    try {
      const response=await fetchImpl(url, {
        signal:AbortSignal.timeout(45000),
        headers:{'User-Agent':'FootballWatchlist/1.0 (+https://github.com/mhmdmstf/football-calendar)',
          ...(attempt ? {'Cache-Control':'no-cache'} : {})}
      });
      if(!response.ok) throw new Error(`${league}: HTTP ${response.status}`);
      const data=await response.json();
      const value=validate(data);
      return {data,value};
    } catch(cause) {
      if(attempt===2) throw new Error(`${league}: schedule unusable after 3 attempts. Keeping published calendar unchanged. Last error: ${cause.message}`,{cause});
      warn(`Schedule attempt ${attempt+1}/3 failed: ${cause.message}. Retrying.`);
      await sleep(attempt===0 ? 5000 : 15000);
    }
  }
}

export async function fetchSchedule(url,league,season,now,options={}) {
  const {data,value:games}=await fetchValidated(url,league,data=>validateSchedule(data,league,season,now),options);
  return {data,games};
}

const WEEK_LIMIT=500;

function validateWeek(data,league,season,type,week,now) {
  if(!Array.isArray(data?.events) || data.events.length>=WEEK_LIMIT) {
    throw new Error(`${league}: missing or possibly truncated week ${type}/${week}`);
  }
  if(data.season?.year!==season || data.season?.type!==type || data.week?.number!==week) {
    throw new Error(`${league}: response does not match requested season/week ${season}/${type}/${week}`);
  }
  if(inSeason(now) && data.events.length===0) throw new Error(`${league}: unexpectedly empty week ${type}/${week}`);
  for(const event of data.events) {
    const game=normalize(event,league);
    const expectedWeek=league==='college-football' && type===3 && week===999 ? 1 : week;
    if(game.season!==season || game.seasonType!==type || game.week!==expectedWeek) {
      throw new Error(`${league}: event ${game.id} does not match requested season/week ${season}/${type}/${week}`);
    }
  }
  return data.events;
}

export function seasonWeeks(data,league,season) {
  const metadata=data?.leagues?.[0];
  if(metadata?.season?.year!==season || !Array.isArray(metadata.calendar)) {
    throw new Error(`${league}: missing calendar metadata for season ${season}`);
  }
  const weeks=[];
  for(const period of metadata.calendar) {
    const type=Number(period.value);
    if(![2,3].includes(type)) continue;
    if(!Array.isArray(period.entries)) throw new Error(`${league}: missing week list for season type ${type}`);
    for(const entry of period.entries) {
      const week=Number(entry.value);
      if(!Number.isInteger(week) || week<0 || week>999) throw new Error(`${league}: invalid schedule week`);
      if(league==='nfl' && type===3 && /pro bowl/i.test(`${entry.label} ${entry.alternateLabel}`)) continue;
      if(!weeks.some(w=>w.type===type && w.week===week)) weeks.push({type,week});
    }
  }
  if(!weeks.some(w=>w.type===2 && w.week===1)) throw new Error(`${league}: regular-season weeks are missing`);
  if(!weeks.some(w=>w.type===3)) throw new Error(`${league}: postseason weeks are missing`);
  return weeks;
}

// Date ranges began returning HTTP 400 on 2026-09-15. Fetch every advertised
// week instead. Values above ESPN's accepted limit can silently fall back to 25.
export async function fetchSeasonSchedule(league,season,now,options={}) {
  const urlFor=({type,week})=>`https://site.api.espn.com/apis/site/v2/sports/football/${league}/scoreboard?dates=${season}&seasontype=${type}&week=${week}&limit=${WEEK_LIMIT}${league==='college-football'?'&groups=80':''}`;
  const first={type:2,week:1};
  const {data:seed,value:weeks}=await fetchValidated(urlFor(first),league,data=>{
    validateWeek(data,league,season,2,1,now);
    return seasonWeeks(data,league,season);
  },options);
  const pages=new Map([['2/1',seed.events]]);
  const pending=weeks.filter(w=>w.type!==2 || w.week!==1);
  // Bound concurrency so a season refresh stays gentle on the public source.
  await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
    while(pending.length) {
      const item=pending.shift();
      const {value:events}=await fetchValidated(urlFor(item),league,data=>validateWeek(data,league,season,item.type,item.week,now),options);
      pages.set(`${item.type}/${item.week}`,events);
    }
  }));
  const unique=new Map();
  for(const item of weeks) {
    for(const event of pages.get(`${item.type}/${item.week}`)) unique.set(String(event.id),event);
  }
  // The Bowls and CFP pages overlap. Retain a single event per stable ESPN ID.
  const data={...seed,events:[...unique.values()]};
  return {data,games:validateSchedule(data,league,season,now)};
}
