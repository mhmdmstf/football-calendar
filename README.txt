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
- Every Tampa Bay Rays and New York Mets regular-season game. Next season's
  games appear once MLB publishes the schedule. Spring training is excluded.
- MLB stretch-run picks across the league, with extra weight for the Rays, Mets,
  Guardians and Padres. About one regular-season game per day, no more than two
  per series, looking ten days ahead. These extra picks qualify through live race
  stakes; the complete Rays and Mets schedules do not count against these limits.
- Every MLB postseason game, including clearly labelled if-necessary games.
  Unknown first-pitch times are all-day markers until announced. Teams and times
  update under stable IDs; unneeded games are cancelled when a series ends.
- Every Carolina Hurricanes and San Jose Sharks regular-season game, plus their
  playoff games as the NHL announces them. Preseason is excluded. Meetings
  between the two teams appear once. Viewing windows are three hours, estimated.
- Chelsea men's first-team matches across all competitions. League fixtures
  appear across the published season; cup matches are added as draws
  assign Chelsea a fixture. Friendlies are excluded. League viewing windows are
  two hours and cup windows two and a half hours, both estimated.
- Every Como and RC Lens men's competitive match, including assigned cup and
  European fixtures. Shared games appear once. Friendlies are excluded.
- A European watchlist for the current and following week: up to six domestic
  matches across the Premier League, Serie A, La Liga, Bundesliga and Ligue 1,
  with at most two per league, plus up to four Champions League matches per week.
  Chelsea, Como and Lens games are additional and are never duplicated.

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
probable pitchers and broadcast listings. Extra regular-season picks prioritize close races
and direct meetings between contenders, then favor the four followed teams. Each
pick explains the standings at selection. Choices are refreshed as the races
change; an extra pick needs meaningful playoff stakes to qualify.
The baseball module updates Rays and Mets schedules throughout the year.
The national stretch-run picks and full postseason update September-November.
It preserves its last good events if MLB is unavailable, while football can
continue updating; status.json shows a warning and the last MLB refresh date.
All 53 potential 2026 postseason games are initially present. Games beyond the
minimum series length are marked "if necessary"; not all will be played.

NHL games come from the league's official team schedules. Confirmed start times
update under stable game IDs, including rescheduling and cancellation. Unknown
times and unresolved postponements use transparent all-day markers. An NHL
source problem preserves the previous hockey entries while other sports can
refresh; status.json records any warning and the last successful NHL check.

Chelsea uses the club's official all-competitions fixtures and results, checked
together against a complete 38-match Premier League season. Confirmed kickoffs
use UK local time converted to UTC. Dates still marked TBC by Chelsea and
unresolved postponements appear as transparent all-day markers. Fixture changes
update the same event; generic cup rounds or finals are not added unless Chelsea
has an assigned match. A source problem preserves Chelsea's previous entries
while other sports can refresh, with the last successful Chelsea check and any
warning recorded in status.json.

Como, Lens and the European watchlist use ESPN's public soccer schedules and
standings. Club results and upcoming fixtures are checked together against a
complete league schedule (38 Como games and 34 Lens games). Daily scoreboards
cover the two-week watchlist window. Choices favor strong table positions,
major rivalries, strong club matchups and later Champions League rounds. Each
pick explains its selection. Existing picks are kept to avoid constant churn
and count against their week's limits, including games already played.
ESPN does not reliably distinguish TV-confirmed kickoffs from provisional ones.
Its listed future times are therefore marked provisional; explicit unknown
times and postponements use transparent all-day markers. Stable match IDs keep
reschedules in the same calendar event. Failed soccer refreshes retain the last
good soccer entries and leave a warning while the other sports keep updating.

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
overrides. alwaysIncludeTeamIds controls complete regular-season subscriptions
(Rays and Mets); favoriteTeamIds controls extra stretch-run selection weights.
It can be disabled independently. Other sports can be added later.
The hockey section stores NHL team abbreviations (CAR and SJS), preseason
preference and hockey-only game overrides. It can be disabled independently.
The chelsea section controls Chelsea's inclusion, friendlies and excluded match
IDs. It can be disabled independently without changing the subscription URL.
The soccer section stores Como (2572) and Lens (175), the eligible leagues,
weekly watchlist limits and excluded match IDs. Chelsea stays in its official
source module; its matches are excluded from the separate European selection.

MAINTENANCE
Node 20+; no packages or API keys needed. Run 'node --test', then
'node generate.mjs'. '--offline' uses the last locally downloaded schedules.
state.json preserves IDs, modification times and past events. status.json records
source counts and show-source warnings. A daily state update keeps this public
repository active even in the offseason, avoiding GitHub's inactivity cutoff.

PRIMARY SCHEDULE REFERENCES
https://www.chelseafc.com/en/matches/mens-fixtures-and-results
https://www.espn.com/soccer/team/fixtures/_/id/2572/como
https://www.espn.com/soccer/team/fixtures/_/id/175/lens
https://www.uefa.com/uefachampionsleague/fixtures-results/
https://www.nhl.com/hurricanes/schedule
https://www.nhl.com/sharks/schedule
https://api-web.nhle.com/v1/club-schedule-season/CAR/now
https://api-web.nhle.com/v1/club-schedule-season/SJS/now
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
