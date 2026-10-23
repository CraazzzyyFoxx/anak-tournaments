# Mix rooms, stage П3 — Discord: release note

The Discord side of pickup mixes now handles every game a mix runs, not only Overwatch. The signup card counts and
lists roles by the mix's own game: Overwatch roles with their emoji and division badges, League of Legends positions
by name, and Deadlock (one role) by rank alone, with no role counters and nothing to set up. It marks away players and
leaves them out of the role counters. It shows each lobby's stage (Idle, Draft setup, Draft, Ready, Pre-game, Live),
with how long a running match or a live draft has run. Its footer names the account the game needs next to Discord:
Battle.net for Overwatch, Riot ID for League of Legends, Steam for Deadlock (it said Battle.net for every game). Its
five buttons are Join, My seat, Leave, Away and Back; Away and Back are the site's Step away switch. The Overwatch
division badge appears only for Overwatch, on the card, the seat panel and the lineup picture.

The seat form (My seat → Edit roles) asks for the game's top roles in order, at most three, plus Full flex where the
game has it. Deadlock has no form; its seat panel shows the rank and the away status. League of Legends has five
positions but three slots: the form's first label says the full order of all five is set on the site, and saving the
form stores the three it shows, so a five-position order set on the site comes back as three. The form does not refuse
and does not keep the hidden positions.

Each lobby captain gets one notification, in the bell and as a Discord direct message (the DM only if the
**Matches** switch is on), linking the lobby's room on the platform host, so the bell's link opens from any
community's host too:

- **Ban room:** sent only when Start match requests the room, that is, when the mix has a ban preset (Side selection
  included) and the lobby a two-team lineup. A Start without bans sends nothing.
- **Draft:** sent when Start draft starts the clock. A captain handed a started draft, whether it is running or paused,
  gets one too, since the resume sends nothing.

Nothing is sent at the seed, per pick, per ban or on resume. A captain with no site account gets nothing. The dedupe key
allows one notification per room and captain. Spec: `docs/superpowers/specs/2026-10-21-mix-rooms-draft-bans-design.md`
§12.

There is no migration and no new queue. tournament-service becomes a second producer of the existing
`pickup_mix_changed` queue: a mix match's hero room completing, being cancelled, reopened or reset queues it, so the
card follows Pre-game ↔ Live. Deploy balancer-service, tournament-service, app-service, discord-service and the
frontend **from one SHA**. If the deploy is staggered, deploy discord-service and app-service before balancer-service:
they must know the new notification kinds before balancer-service writes one. Otherwise app-service never DMs the row,
or the bot cannot render it.

At deploy, two kinds of open Discord element stop answering, because their `custom_id` format changed: the «Edit
roles» button of a seat panel opened before the deploy, and a seat form open at that moment. Clicking either answers
"this button no longer works"; opening My seat again gives a working panel. The panels' other buttons keep working.
Signup cards already in channels keep their three buttons until the mix next changes. The re-render then adds Away,
Back and the lobby stages.

## Wire changes

| Change | Kind |
| --- | --- |
| `rpc.balancer.custom.discord_view`: `discipline`, `discipline_roles[{code,label}]`, `discipline_flex`; `signup.lobbies[{lobby_index,state,live_started_at}]`; `signup.players[].away` | additive (internal RPC) |
| Self state (`rpc.balancer.custom.self_*`, the site's `…/me`): `discipline`, `discipline_roles`, `discipline_flex` | additive |
| Discord `custom_id`: `mix.setup` target `<game>-<discipline>-<order>-<flex>`; seat form `mix.seat_set:<game>-<discipline>` | **breaking** for panels and forms open at deploy |
| Discord actions `mix.away`, `mix.back` → `rpc.balancer.custom.self_away` | new |
| Notification kinds `mix.ban_room_opened`, `mix.draft_started` (`{custom_game_id, mix_name, lobby}`, DM group `matches`, link `/balancer/mix/<id>/lobby/<letter>` on the platform host, in the bell and the DM) | new |
| `pickup_mix_changed` also produced by tournament-service (`change: "pick_ban"`); `emit_pickup_mix_changed` now `shared.services.pickup_mix_realtime` | new producer / internal move |

## Not in this release

Hero picks (П4), map veto, a pick or ban count on the card, and League of Legends position names in Russian.
