FOOTBALL WORTH WATCHING

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

HOW IT UPDATES
GitHub runs the updater four times a day. Your calendar app decides how quickly
to fetch changes; its refresh interval can delay updates. The computer does not
need to be on. The feed is public and contains sports events only.

ESPN's public schedule data supplies games, current rankings, venue, US networks,
market spreads and kickoff status. This endpoint is unofficial and has no uptime
guarantee. A failed or incomplete game fetch leaves the last good feed published.
GitHub reports failed runs in its Actions tab and through account notifications.

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

MAINTENANCE
Node 20+; no packages or API keys needed. Run 'node --test', then
'node generate.mjs'. '--offline' uses the last locally downloaded schedules.
state.json preserves IDs, modification times and past events. status.json records
source counts and show-source warnings. A daily state update keeps this public
repository active even in the offseason, avoiding GitHub's inactivity cutoff.

PRIMARY SCHEDULE REFERENCES
https://www.espn.com/college-football/schedule
https://www.espn.com/nfl/schedule
https://operations.nfl.com/programs-initiatives/international-growth/nfl-international-games
https://collegefootballplayoff.com/news/2026/6/1/26-27-broadcast-sked
https://www.foxsports.com/big-noon-kickoff-experience
https://espnpressroom.com/press-releases/

Created September 5, 2026. This is a personal sports-calendar tool, not an
official league, broadcaster or team product.
