# Steam persona names on profiles: release note

A Steam account's handle is its decimal account id (`players.social_account.username`), so profiles showed a number.
They now show the persona name: the profile header, the admin people list and inspector (`SocialAccountBadge`) and
the admin social-accounts editor read `display_name`, falling back to the id while there is none. The id stays in the
chip's tooltip and, in the admin editor, next to the name. Matching, the Deadlock collector and the
`steamcommunity.com/profiles/<id64>` link still work on the id. Registration and mix identity handles still show the
id.

Where the name comes from (identity-service, `src/services/steam_profiles.py`):

- **Steam sign-in / link**: the profile fetched for the OAuth user is written with the account.
- **Any other new Steam account, or a changed account id** (admin add/edit, registration, balancer roster, Deadlock log
  ingest): `shared.services.social_identity` stages `SteamAccountChangedEvent` in the same transaction. The outbox
  relays it to the new `steam_account_changed` queue (DLQ `steam_account_changed.dlq`), and identity-service fetches
  the name. A changed id drops the old id's name at once.
- **Daily refresh** of every Steam account, also run once at identity-service startup. A name Steam does not answer
  for keeps the last known one.

The source is the Steam Web API (`GetPlayerSummaries`, 100 ids a request) when `STEAM_WEB_API_KEY` is set, else
deadlock-api's keyless copy (1000 ids a request), which may lag Steam by months for someone who does not play Deadlock.
Every fetch is best effort: a failed batch changes nothing and the next run retries.

## Migration and deploy

One migration after `mixpick01`: **`socdn01`** adds nullable `players.social_account.display_name` (varchar 255;
metadata-only, `lock_timeout` 3 s). Nothing is backfilled by the migration: identity-service's startup refresh fills
every existing Steam account.

Deploy from one SHA. Run the migration first, then roll identity-service (it declares the new queue and DLQ), the
services that write social accounts (app, tournament, balancer, stats), the gateway (regenerated `schemas.json`) and the
frontend. Before identity-service has declared the queue, an event published to it is dropped; the startup refresh
covers those accounts.

Downgrade drops the column and every stored name; the frontend falls back to the id.

## Configuration

| File | Variable | Default | Effect |
| --- | --- | --- | --- |
| `auth.env` | `STEAM_WEB_API_KEY` | unset | Steam Web API key (<https://steamcommunity.com/dev/apikey>) for persona names and avatars. Unset = deadlock-api |
