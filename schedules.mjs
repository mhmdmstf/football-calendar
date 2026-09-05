import { normalize } from './calendar.mjs';

export function validateSchedule(data, league, season, now) {
  if (!Array.isArray(data?.events) || data.events.length >= 1000) {
    throw new Error(`${league}: missing or possibly truncated schedule`);
  }
  const games = data.events.map((event, index) => {
    try { return normalize(event, league); }
    catch (cause) { throw new Error(`${league}: invalid event ${event?.id || `at index ${index}`} (${cause.message})`, {cause}); }
  }).filter(g=>g.season===season && [2,3].includes(g.seasonType));
  if (new Date(now).getUTCMonth() >= 7 && games.length < (league==='nfl' ? 250 : 650)) {
    throw new Error(`${league}: unexpectedly incomplete in-season schedule (${games.length})`);
  }
  return games;
}

// A successful HTTP response may still contain an incomplete ESPN snapshot.
// Retry fetching AND validation together; return only a complete usable snapshot.
export async function fetchSchedule(url, league, season, now, {
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
      const games=validateSchedule(data,league,season,now);
      return {data,games};
    } catch(cause) {
      if(attempt===2) throw new Error(`${league}: schedule unusable after 3 attempts. Keeping published calendar unchanged. Last error: ${cause.message}`,{cause});
      warn(`Schedule attempt ${attempt+1}/3 failed: ${cause.message}. Retrying.`);
      await sleep(attempt===0 ? 5000 : 15000);
    }
  }
}
