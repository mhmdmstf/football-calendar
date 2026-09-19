FOOTBALL AND FRIENDS

Subscribe to this URL in Apple Calendar, Google Calendar or Outlook:
https://raw.githubusercontent.com/mhmdmstf/football-calendar/main/football.ics

Use a calendar subscription / Add from URL, not a one-time file import.
Apple Calendar on iPhone: Calendars > Add Calendar > Add Subscription Calendar.
https://support.apple.com/guide/iphone/use-multiple-calendars-iph3d1110d4/ios

WHAT IS INCLUDED
- Every Alabama game, including bowls and playoffs.
- College GameDay and Big Noon Kickoff, as separate pregame shows.
- Confirmed show matchups, major rivalries, conference championships and CFP.
- A national shortlist for the next three weeks. Ranked matchups and competitive
  games involving ranked teams are prioritized. Six national games per week is
  the target; must-include rivalries, show picks and playoffs may exceed it.
- NFL Sunday/Monday/Thursday night games, every international game, standalone
  Wednesday/Friday/Saturday games (including holidays), and every playoff game.
- NFL RedZone, regular Sundays 1-8 p.m. US Eastern. Finish is approximate.
- MLB stretch-run picks across the league, with extra weight for the Rays, Mets,
  Guardians and Padres. About one regular-season game per day, no more than two
  per series, looking ten days ahead. Favorites qualify through live race stakes;
  this is not a subscription to every game those teams play.
- Every MLB postseason game, including clearly labelled if-necessary games.
  Unknown first-pitch times are all-day markers until announced. Teams and times
  update under stable IDs; unneeded games are cancelled when a series ends.

HOW IT UPDATES
GitHub runs the updater four times a day. Your calendar app decides how quickly
to fetch changes; its refresh interval can delay updates. The computer does not
need to be on. The feed is public and contains sports events only.

ESPN's public schedule data supplies games, current rankings, venue, US networks,
market spreads and kickoff status. This endpoint is unofficial and has no uptime
guarantee. A failed or incomplete game fetch leaves the last good feed published.
The updater reads ESPN's season calendar, fetches each regular/postseason week
with a supported result limit, and deduplicates overlapping bowl/CFP entries.
Every week must validate before a new feed is published. Date-range requests are
not used because ESPN began rejecting them on September 15, 2026.
The updater retries temporary HTTP, JSON, event-data and incomplete-schedule
failures up to three times before reporting a failed run.
Queued runs start from the latest main branch. If main changes while a run is
publishing, it regenerates against the newer source and saved calendar state,
then retries a normal push (up to three attempts). It never force-pushes.
GitHub reports failed runs in its Actions tab and through account notifications.

MLB supplies its own official schedules, current division/wild-card standings,
probable pitchers and broadcast listings. Regular-season picks prioritize close races
and direct meetings between contenders, then favor the four followed teams. Each
pick explains the standings at selection. Choices are refreshed as the races
change; a favorite with no playoff stakes needs a meaningful opponent to qualify.
The baseball module runs September-November, including the full postseason.
It preserves its last good events if MLB is unavailable, while football can
continue updating; status.json shows a warning and the last MLB refresh date.
All 53 potential 2026 postseason games are initially present. Games beyond the
minimum series length are marked "if necessary"; not all will be played.

The existing football.ics URL is permanent even as other sports are added.
The feed advertises "Football and Friends". Calendar apps may retain a locally
chosen name; rename that subscription in the app if its old label remains.

Picks use transparent rules, not live human editorial review. Each event explains
its inclusion. A small spread identifies potentially competitive games; it does
not predict an upset. National picks are kept once added to avoid calendar churn.
Rivalries and Alabama appear across the available season. Rankings guide only
the upcoming three weeks. Game end times are viewing estimates.

Unannounced kickoffs appear as all-day 'time TBA' markers until confirmed. Their
stable IDs let calendar clients move the same event when the kickoff is assigned.
Timed events use UTC so the calendar handles Brussels, Riyadh and DST correctly.
Future unconfirmed pregame shows are labelled tentative, with location TBA.

CHANGE PREFERENCES
Edit config.json or ask to adjust this calendar. Alabama's ESPN team ID is 333.
favoriteCollegeTeamIds, nationalGamesPerWeek, includeGameIds and excludeGameIds
control the selection. No calendar URL change is needed.
The baseball section stores MLB team IDs (Rays 139, Mets 121, Guardians 114,
Padres 135), daily/series limits, the selection horizon and baseball-only game
overrides. It can be disabled independently. Other sports can be added later.

MAINTENANCE
Node 20+; no packages or API keys needed. Run 'node --test', then
'node generate.mjs'. '--offline' uses the last locally downloaded schedules.
state.json preserves IDs, modification times and past events. status.json records
source counts and show-source warnings. A daily state update keeps this public
repository active even in the offseason, avoiding GitHub's inactivity cutoff.

PRIMARY SCHEDULE REFERENCES
https://www.mlb.com/standings
https://www.mlb.com/postseason
https://statsapi.mlb.com/api/v1/schedule?sportId=1
https://www.espn.com/college-football/schedule
https://www.espn.com/nfl/schedule
https://operations.nfl.com/programs-initiatives/international-growth/nfl-international-games
https://collegefootballplayoff.com/news/2026/6/1/26-27-broadcast-sked
https://www.foxsports.com/big-noon-kickoff-experience
https://espnpressroom.com/press-releases/

Created September 5, 2026. This is a personal sports-calendar tool, not an
official league, broadcaster or team product.
