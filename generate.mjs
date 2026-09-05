import fs from 'node:fs/promises';
import { etDay, etParts, atEastern, addDays, normalize, gameEvent, nflReasons, selectCollege, stabilize, renderCalendar } from './calendar.mjs';
import { getShows } from './shows.mjs';

const offline = process.argv.includes('--offline');
const now = process.env.CALENDAR_NOW || new Date().toISOString();
const year = new Date(now).getUTCFullYear();
const season = new Date(now).getUTCMonth() < 2 ? year - 1 : year;
const config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const previous = await fs.readFile('state.json', 'utf8').then(JSON.parse).catch(e => { if(e.code === 'ENOENT') return {events:[]}; throw e; });
await fs.mkdir('.cache', {recursive:true});
async function schedules(league) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/${league}/scoreboard?dates=${season}0801-${season+1}0228&limit=1000${league === 'college-football' ? '&groups=80' : ''}`;
  let data;
  if (offline) data = JSON.parse(await fs.readFile(`.cache/${league}.json`, 'utf8'));
  else {
    for(let attempt=0; attempt<3; attempt++) {
      try {
        const r = await fetch(url, {signal:AbortSignal.timeout(45000),headers:{'User-Agent':'FootballWatchlist/1.0 (+https://github.com/mhmdmstf/football-calendar)'}});
        if (!r.ok) throw new Error(`${league}: HTTP ${r.status}`);
        data = await r.json(); break;
      } catch(e) { if(attempt === 2) throw e; await new Promise(r=>setTimeout(r,1500*(attempt+1))); }
    }
    await fs.writeFile(`.cache/${league}.json`,JSON.stringify(data));
  }
  if (!Array.isArray(data.events) || data.events.length >= 1000) throw new Error(`${league}: missing or possibly truncated schedule. Keeping published calendar unchanged.`);
  const games = data.events.map(e=>normalize(e,league)).filter(g=>g.season === season && [2,3].includes(g.seasonType));
  // A disappearing schedule is a source failure, not a reason to erase subscribers' events.
  if (new Date(now).getUTCMonth() >= 7 && games.length < (league === 'nfl' ? 250 : 650)) throw new Error(`${league}: unexpectedly incomplete in-season schedule (${games.length}).`);
  return games;
}
const [nfl,college] = await Promise.all([schedules('nfl'),schedules('college-football')]);
const shows = await getShows(college, now, {offline});
// A source outage or a rolling announcement page must not erase a confirmed stop.
shows.events = shows.events.map(e => {
  const old = previous.events.find(p=>p.uid===e.uid && p.status==='CONFIRMED');
  if(e.status==='TENTATIVE' && old) {
    const {hash,created,modified,sequence,...retained}=old;
    if(retained.gameId) shows.featuredIds.push(retained.gameId);
    return retained;
  }
  return e;
});
for(const old of previous.events.filter(e=>e.categories.includes('Pregame') && e.status==='CONFIRMED' && e.start.startsWith(String(season)))) {
  if(!shows.events.some(e=>e.uid===old.uid)) {
    const {hash,created,modified,sequence,...retained}=old;
    shows.events.push(retained);
    if(retained.gameId) shows.featuredIds.push(retained.gameId);
  }
}
const picks = selectCollege(college, config, shows.featuredIds, now, previous.events);
const generated=[];
for(const g of nfl) { const reasons=nflReasons(g); if(reasons.length && !config.excludeGameIds.includes(g.id)) generated.push(gameEvent(g,reasons)); }
for(const g of college) {
  const reasons=picks.get(g.id); if(!reasons) continue;
  // The Jan 1 bowl-to-time assignments are still TBA. Timed CFP slot events below replace these placeholders.
  if(g.season===2026 && g.day==='2027-01-01' && /playoff quarterfinal/i.test(g.notes)) continue;
  const event=gameEvent(g,reasons);
  const selectionReason=reasons.find(r=>r.startsWith('National pick:') || r==='Retained national watchlist selection.');
  if(selectionReason) {event.categories.push('National pick'); event.selectionReason=selectionReason;}
  for(const team of g.teams.filter(t=>config.favoriteCollegeTeamIds.includes(t.id))) event.categories.push(team.short);
  generated.push(event);
}
if(season===2026) {
  for(const [slot,hour] of [[1,12],[2,16],[3,20]]) {
    const start=atEastern('2027-01-01',hour);
    const assigned=college.find(g=>g.day==='2027-01-01' && /playoff quarterfinal/i.test(g.notes) && g.timeKnown && new Date(g.date).getTime()===new Date(start).getTime());
    const event=assigned ? gameEvent(assigned,['College Football Playoff quarterfinal.']) : {
      title:`CFP quarterfinal ${slot} - bowl and teams TBA`,start,end:new Date(Date.parse(start)+3.5*3600000).toISOString(),allDay:false,
      description:'Confirmed CFP quarterfinal broadcast window. Cotton, Peach and Rose Bowl assignments will be announced December 6. This event updates with the bowl and teams when ESPN confirms the assignment. Finish is approximate.',
      location:'Venue to be announced',url:'https://collegefootballplayoff.com/news/2026/6/1/26-27-broadcast-sked',status:'CONFIRMED',categories:['College','Playoffs']};
    generated.push({...event,uid:`cfp-2026-jan1-slot-${slot}@football-watchlist`});
  }
}
// RedZone follows each actual regular-season Sunday and uses Eastern time across DST changes.
const sundays=[...new Set(nfl.filter(g=>g.seasonType===2 && etParts(g.date).weekday==='Sun').map(g=>g.day))];
for(const day of sundays) generated.push({uid:`redzone-${day}@football-watchlist`,title:'NFL RedZone',start:atEastern(day,13),end:atEastern(day,20),allDay:false,
  description:'Sunday afternoon NFL whip-around coverage. Seven-hour viewing block, 1-8 p.m. US Eastern; the actual finish depends on the late games. International and Sunday night games appear separately.',
  location:'NFL RedZone',url:'https://support.nfl.com/hc/en-us/articles/35869733293844-What-is-NFL-RedZone',status:'CONFIRMED',categories:['NFL','RedZone']});
generated.push(...shows.events);
const floor=addDays(etDay(now),-60);
// Preserve the historical watchlist. A rankings change must not rewrite a game already played.
const merged=new Map(generated.map(e=>[e.uid,e]));
for(const old of previous.events) {
  const day=old.start.slice(0,10);
  if(day>=floor && Date.parse(old.allDay ? `${old.start}T23:59:59Z` : old.start)<Date.parse(now) && !merged.has(old.uid)) {
    const {hash,created,modified,sequence,...event}=old; merged.set(old.uid,event);
  }
}
const events=stabilize([...merged.values()].filter(e=>e.start.slice(0,10)>=floor).sort((a,b)=>a.start.localeCompare(b.start)||a.uid.localeCompare(b.uid)),previous.events,now);
if(new Set(events.map(e=>e.uid)).size!==events.length) throw new Error('Duplicate calendar IDs');
const ics=renderCalendar(events,config.name);
const status={checkedOn:etDay(now),season,events:events.length,nflGames:nfl.length,collegeGames:college.length,warnings:shows.warnings};
// All fetches, selection and validation finish before either output is replaced.
await fs.writeFile('football.ics.tmp',ics);
await fs.writeFile('state.json.tmp',JSON.stringify({...status,events},null,2)+'\n');
await fs.rename('football.ics.tmp','football.ics');
await fs.rename('state.json.tmp','state.json');
await fs.writeFile('status.json',JSON.stringify(status,null,2)+'\n');
console.log(JSON.stringify(status,null,2));
console.log('Next 10 days:');
for(const e of events.filter(e=>e.start>=etDay(now) && e.start<addDays(etDay(now),10))) console.log(`${e.start} | ${e.title}`);
