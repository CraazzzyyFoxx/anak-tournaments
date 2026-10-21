# Discipline flex flag (stage F): release note

Stage F of the mix rooms design (spec §6). **Deadlock mixes now move ranks.** Every Deadlock seat used to be the open
slot `flex`, and points per win and the mix ranker skip a seat outside the game's rated roles, so a recorded Deadlock
round moved neither the host's rank book nor the hidden ranker book. Deadlock seats are now `agent`.

No database migration. Deploy every backend service, the gateway (regenerated `schemas.json`) and the frontend from one
SHA, backend first: the frontend reads the new `flex` field of the discipline descriptor, and the mix pages read it as
`false` when an older backend leaves it out. A frontend ahead of its backend would hide Full flex in every mix,
Overwatch included, and clear a player's Full flex flag on the next save of that player. Run the pre-deploy check in
section 4 first.

## 1. What changed

* **`DisciplineSpec.flex`** (`backend/shared/disciplines/spec.py`, default `True`). Deadlock declares `False`: the game
  has no open slot and no Full flex player. One flag covers both.
* **Slot projection** (`shared.domain.team_format.slot_shape`). With `flex=False` every open starter goes to the single
  rated role: Deadlock `open_6v6` is `{agent: 6}` and `open_4v4` is `{agent: 4}`. With several rated roles such a format
  is refused with `TeamFormatError` **`team_format_open_slots_without_flex`**, also when an organizer saves it (422). No
  installed game hits that case today.
* **Mix API.** `is_flex: true` on a host's player patch or a player's own update in a game without Full flex answers
  422 **`full_flex_unsupported`**, before anything is written. `is_flex: false` is accepted.
* **Discipline descriptor.** `GET /api/v1/disciplines` and `GET /api/v1/disciplines/{discipline}/metadata` carry
  `discipline.flex`.
* **Registrations of a one-role game** (tournament-service). Every role write stores the game's only role as primary:
  the public form, the organizer's edit and the Google Sheets sync alike. A write that names no role keeps the stored
  row and its rank. A new registration gets the role without a roles answer, even where the organizer marked the
  question required, so the tournament balancer and the draft keep reading `agent`.
* **Frontend.**
  * A game with one rated role shows no role UI (one helper, `showsRoles` in `lib/roster/ontology.ts`):
    * no role glyph is drawn (`PlayerRoleIcon`);
    * mix board: no role order, Full flex or role switches in **Your seat** and on the player card, which shows the
      rank under a **Rank** heading; no role rail in the lineup, no role chips in the lineup aside, no role-supply
      strip, no role icon on a seat, no role glyphs in **Add players**, and no **Players edit their own roles** switch
      for the host;
    * registration: no **Roles** step (kept only when the form asks for top heroes, then titled after the heroes and
      naming no role), one rank field under the block's own label, no slot picker when founding a team, no slot choice
      and no free-agent role chips in an invite; the team card names no slot (no slot select, no role on an open place,
      a plain **Invite** action, the shortfall as a player count) and an invite offer names no slot; the organizer edits
      a single **Rank** field;
    * tournament pages: the participants pool is one **Players** column and the format card shows no slot glyphs;
    * tournament balancer player sheet: the rank alone, with no role list to order, add to or switch off. Saving keeps
      the sole role's entry active and primary, with its stored rank and sub-role, and creates it for a registration
      that has none. Entries of retired roles are saved unchanged;
    * draft board: no role chips, role column heads, role strip or role labels in the pool, rosters, queue, order grid,
      clock strip or pick island; a pick names the player, an open roster place reads **Open seat**, and journal lines
      name no role;
    * users list and compare page: no role filter.
  * Full flex is hidden wherever the game has none: the mix role editor and the tournament balancer's **Flex player**
    switch. The mix pages (host's player card, the player's **Your seat**) send `is_flex: false` for such a game, which
    also clears a flag stored earlier. A one-role mix save sends `roles: null` (every ranked role), which also repairs a
    stored `roles: []` that would refuse the balance once the first rank lands.
  * New messages (EN/RU): `mixes.self.unrankedOne`, `mixes.lobbies.rankHeading`,
    `tournamentDetail.participantsPool.players`, `registrationOrganizer.form.rankOnly`,
    `registration.roles.matrix.heroesLabelNoRole`, `registration.roles.matrix.heroesPickerLabelNoRole`,
    `registration.roles.topHeroes.descNoRole`, `registrationTeams.list.shortfallCount`,
    `registrationTeams.offers.sentenceNoSlot`, `registrationTeams.offers.sentenceSubstituteNoSlot`,
    `draftRedesign.teams.cell.openSeat`, `draftRedesign.shell.journal.actionNoRole.{pick_made, pick_autopicked,
    pick_overridden, player_role_added}`.
* **Docs.** The organizers' mix, registration and draft pages and the players' mix and registration pages (EN/RU)
  describe Deadlock; `docs/business-logic-inventory.md` records the one-role registration rule, the `{agent: 6}`
  projection and `full_flex_unsupported`.

## 2. Not retroactive

* A Deadlock lineup balanced before this release keeps its `flex` seats until the next **Balance**; recording it moves
  no rank, as before. Recorded rounds are not re-applied.
* `is_flex` stays as stored on old Deadlock mix rows; it changes nothing in a one-role balance and is cleared on the
  next save of that player.

## 3. Deadlock tournaments

The same shape reaches them: the tournament balancer runs on `agent`, a draft records `agent` picks under the role-slot
rules, and the export maps members to the role `agent` instead of no role. A draft completed before the release
re-exports its picked players with no role, as before, at the rank frozen when they were picked; the old export read the
live rank, so the two differ only where a rank was edited after the pick. Its captains now export on `agent`, at the
same live rank. Their pages follow the single-role rule too (section 1): no role step, slot picker or role labels.

## 4. Pre-deploy check

Team-registration members and pending invites holding slot `flex`, and live drafts, of a Deadlock tournament do not
survive the shape change (the slot is no longer in the shape; earlier picks hold no role). Every count of this
read-only query must be zero before deploying; otherwise finish those registrations and drafts first:

    SELECT 'registration_slot_flex' AS what, count(*)
      FROM registration.registration r JOIN tournament.tournament t ON t.id = r.tournament_id
     WHERE t.discipline = 'deadlock' AND r.team_slot_code = 'flex' AND r.deleted_at IS NULL
    UNION ALL
    SELECT 'pending_invite_slot_flex', count(*)
      FROM registration.team_invite i
      JOIN registration.team rt ON rt.id = i.team_id
      JOIN tournament.tournament t ON t.id = rt.tournament_id
     WHERE t.discipline = 'deadlock' AND i.slot_code = 'flex' AND i.state = 'pending'
    UNION ALL
    SELECT 'live_draft', count(*)
      FROM draft.session s JOIN tournament.tournament t ON t.id = s.tournament_id
     WHERE t.discipline = 'deadlock' AND s.status IN ('live', 'paused');

## 5. Verification

Backend, from `backend/`, one service per pytest run:

* `uv run pytest shared/tests/test_team_format.py shared/tests/test_team_format_schemas.py
  shared/tests/test_team_roster.py shared/tests/test_team_format_service.py shared/tests/test_disciplines.py -q`
* `uv run pytest balancer-service/tests/test_custom_game.py balancer-service/tests/test_draft_selection_slots.py
  balancer-service/tests/test_draft_feasibility.py balancer-service/tests/test_draft_export.py
  balancer-service/tests/test_registered_export.py balancer-service/tests/test_registered_export_plan.py
  balancer-service/tests/test_team_export_format.py balancer-service/tests/test_team_export_service.py
  balancer-service/tests/test_mix_lobby_split.py balancer-service/tests/test_feasibility_analyzer.py
  balancer-service/tests/test_player_loader_flex.py balancer-service/tests/test_custom_game_flow.py
  balancer-service/tests/test_custom_game_contract.py -q`
* `uv run pytest app-service/tests/test_discipline_metadata.py -q`
* `uv run pytest tournament-service/tests/test_registration_answers.py tournament-service/tests/test_forced_flex_roles.py
  tournament-service/tests/test_registration_teams.py tournament-service/tests/test_players_export_formats.py
  tournament-service/tests/test_pick_ban_admin_upsert_slots.py -q`
* `bash scripts/export_openapi_schemas.sh --check`

Frontend, from `frontend/`: `bun run typecheck`, then

    bunx vitest run "src/app/(site)/tournaments/[slug]/_views/_components/ParticipantsPool.behavior.test.tsx" \
      "src/app/(site)/tournaments/[slug]/pregame/[encounterId]/_components/pregameRoom.behavior.test.tsx" \
      src/app/balancer/components/PlayerEditSheet.behavior.test.tsx \
      src/app/balancer/mix/PickupAddPlayersDialog.behavior.test.tsx src/app/balancer/mix/PickupLobbyPanel.behavior.test.tsx \
      src/app/balancer/mix/PickupMixHeader.behavior.test.tsx src/app/balancer/mix/PickupMySeatPanel.behavior.test.tsx \
      src/app/balancer/mix/PickupPlayerSheet.behavior.test.tsx src/app/balancer/mix/PickupTeamsPanel.behavior.test.tsx \
      src/app/balancer/mix/pickup-lineup.test.ts src/components/PlayerRoleIcon.test.tsx \
      src/components/draft/DraftJournal.behavior.test.tsx src/components/draft/PickIsland.behavior.test.tsx \
      src/components/draft/TeamRosters.behavior.test.tsx src/components/registration/MyInviteOffers.behavior.test.tsx \
      src/components/registration/MyTeamPanel.i18n.test.tsx src/components/registration/MyTeamPanel.picker.test.tsx \
      src/components/registration/RegistrationSchemaForm.behavior.test.tsx \
      src/components/registration/RoleStep.behavior.test.tsx \
      src/components/registration/TeamRegistrationEntry.behavior.test.tsx \
      src/components/roster-shape/TeamFormatEditor.behavior.test.tsx src/lib/roster/ontology.test.tsx \
      src/i18n/messages.parity.test.ts --maxWorkers=1 --no-file-parallelism
