"""Public / captain tournament methods over typed RPC.

Each handler preserves the contract of the former HTTP route it replaced (the
``src/routes/`` HTTP service has been decommissioned): it rehydrates the
gateway-injected identity where a user was required, validates the SAME body
schema, calls the SAME service function with the SAME args, and serializes the
SAME way the route returned. The request schemas and read-model builders now
live in ``src/schemas/{captain,registration,registration_build}.py``.

Serialization parity:
- captain handlers return custom dicts -> returned verbatim.
- registration handlers do NOT use ``response_model_exclude_none`` -> plain
  ``model_dump(mode="json")`` (keep nulls). ``RegistrationFormRead | None`` and
  ``RegistrationRead | None`` may serialize to ``None``.
- saved-view writes DID use ``response_model_exclude_none=True`` ->
  ``model_dump(mode="json", exclude_none=True)``; the delete returns 204 -> None.

Commit semantics: every write service called here commits internally
(captain.submit_captain_report,
map_veto.perform_veto_action, reg_service.create/update/withdraw/check_in,
encounter service.upsert_saved_view/delete_saved_view), so the handlers add no
extra commit. The map-pool state read also commits when it lazily creates the
encounter's veto session (veto_session.ensure_veto_session).

The gateway passes path params as ``data["<name>"]`` (and the primary id as
``data["id"]`` when the RouteSpec sets IDParam), query params as
``data["query"][key] = [values]``, and the JSON body as ``data["payload"]``.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from faststream.rabbit import Channel
from faststream.rabbit.annotations import RabbitMessage

from shared.balancer_registration_statuses import get_status_metas_map
from shared.balancer_subrole_catalog import resolve_subrole_catalog
from shared.core.enums import PickBanKind, SubscriptionCollectionSource
from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.identity import rehydrate_user
from shared.services.profile_visibility import resolve_profiles_open
from shared.services.subscription_realtime import publish_subscriptions_updated
from shared.services.subscription_wiring import build_resolver, build_store
from shared.services.tournament_visibility import assert_tournament_viewable
from src import models, schemas
from src.core import db
from src.core.broker import optional_broker
from src.core.config import settings
from src.core.redis import get_realtime_redis
from src.rpc._helpers import (
    _dump,
    _identity,
    _path_int,
    _payload,
    _require_id,
    _require_q1,
    _run,
)
from src.schemas.captain import (
    CaptainReportSubmission,
    ElectOpenerInput,
    MapReportInput,
    PickBanActionInput,
    PickBanUndoInput,
    VetoAction,
    resolve_optional_viewer_side,
)
from src.schemas.registration import (
    RegistrationCreate,
    RegistrationStatusResponse,
    RegistrationUpdate,
    SubscriptionRedeemRequest,
)
from src.schemas.registration_build import (
    _form_to_read,
    _reg_to_read,
    _resolve_tournament_workspace,
)
from src.schemas.registration_team import (
    RegistrationTeamAcceptRequest,
    RegistrationTeamCreateRequest,
    RegistrationTeamInviteCreateRequest,
    RegistrationTeamListResponse,
    serialize_invite,
)
from src.services import visibility_resolvers
from src.services.encounter import captain as captain_service
from src.services.encounter import flows as encounter_flows
from src.services.encounter import map_report as map_report_service
from src.services.encounter import pick_ban_action as pick_ban_action_service
from src.services.encounter import pick_ban_session as pick_ban_session_service
from src.services.encounter import pick_ban_undo as pick_ban_undo_service
from src.services.encounter import report_form as report_form_service
from src.services.registration import service as reg_service
from src.services.registration import subscription_config
from src.services.registration import teams as team_service
from src.services.registration.subscription_codes import redeem_challenge_code
from src.services.registration.subscription_gate import (
    assert_subscription_allows_check_in,
    assert_subscription_allows_registration,
)
from src.services.registration.subscription_reads import (
    build_subscription_reads,
    serialize_verdicts,
)
from src.services.registration.subscription_status import (
    assert_redeem_attempt_allowed,
    subscription_status_for_user,
)
from src.services.registration.validation import (
    validate_registration_input,
    validate_verified_identity,
)
from src.services.registration.windows import load_registration_open


def _subscription_resolver(session: Any) -> Any:
    """Resolver wired with this service's provider credentials.

    Built per request: the Discord strategy memoizes a guild's role list, and that
    memo must not outlive the request that filled it.
    """
    return build_resolver(
        session,
        discord_bot_token=settings.discord_token,
        twitch_client_id=settings.twitch_client_id,
        broker=optional_broker(),
        proxy=settings.proxy_url,
        # A gate that flips somebody's verdict tells the workspace so, so an open
        # admin list stops showing the stale outcome.
        redis=get_realtime_redis(),
    )


# --- helpers -----------------------------------------------------------------


def _optional_identity(data: dict[str, Any]) -> models.AuthUser | None:
    """Rehydrate identity for AuthOptional routes; None when anonymous.

    The gateway injects ``identity`` only when a valid token is present on an
    AuthOptional route, so the absence of the key means the caller is anonymous.
    """
    if not data.get("identity"):
        return None
    return rehydrate_user(data.get("identity"))


# Coalesces concurrent rebuilds of the public registration list for the same
# tournament. A registration mutation notifies every connected viewer at once
# (the "realtime invalidation herd" -- see the channel comment on
# ``_reg_pub_list`` below), so without this a burst of N viewers refetching
# after one mutation triggers N identical, expensive read-model builds that
# queue behind the channel's ``prefetch_count`` -- the actual driver of this
# endpoint's p95 tail latency. Followers join the leader's task instead of
# starting their own: still exactly one live DB read per burst, just shared by
# everyone asking for the same tournament_id at the same instant. Keyed by
# tournament_id only -- the viewer-dependent visibility check always runs on
# the caller's own session before this is ever reached (see
# ``assert_tournament_viewable``'s cache note), so a hidden tournament's gate
# is never skipped for a follower.
_reg_pub_list_inflight: dict[int, asyncio.Task[Any]] = {}


async def _build_registration_list(tournament_id: int) -> Any:
    async with db.async_session_maker() as session:
        return await reg_service.build_public_registration_list(session, tournament_id=tournament_id)


async def _coalesced_registration_list(tournament_id: int) -> Any:
    task = _reg_pub_list_inflight.get(tournament_id)
    if task is None:
        task = asyncio.create_task(_build_registration_list(tournament_id))
        _reg_pub_list_inflight[tournament_id] = task

        def _cleanup(done: asyncio.Task[Any]) -> None:
            if _reg_pub_list_inflight.get(tournament_id) is done:
                del _reg_pub_list_inflight[tournament_id]

        task.add_done_callback(_cleanup)
    # Shielded: a follower's own cancellation (its caller disconnected/timed
    # out) must not cancel the shared build out from under every other
    # follower -- and unlike a plain ``await task``, ``Task.cancel()`` DOES
    # propagate into whatever future a task is currently awaiting.
    return await asyncio.shield(task)


def register(broker: Any, logger: Any) -> None:
    # ── captain: identity / result submission ─────────────────────────────

    @broker.subscriber("rpc.tournament.captain_my_role")
    async def _captain_my_role(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            encounter = await captain_service._load_encounter(session, encounter_id)
            try:
                side = await captain_service.resolve_captain_side(session, user, encounter)
            except HTTPException:
                side = None
            return {"side": side}

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_submit_report")
    async def _captain_submit_report(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            body = CaptainReportSubmission.model_validate(_payload(data))
            # submit_captain_report commits internally; route returns a custom dict.
            encounter = await captain_service.submit_captain_report(
                session,
                user,
                encounter_id,
                home_score=body.home_score,
                away_score=body.away_score,
                closeness=body.closeness,
                map_codes=[(mc.map_index, mc.code) for mc in body.map_codes],
                comment=body.comment,
                custom_fields=body.custom_fields,
            )
            reports = await captain_service.get_encounter_reports(session, encounter_id)
            return {
                "id": encounter.id,
                "result_status": encounter.result_status,
                "status": encounter.status,
                "home_score": encounter.home_score,
                "away_score": encounter.away_score,
                "closeness": encounter.closeness,
                "reports": reports,
            }

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_reports")
    async def _captain_reports(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # Public read: reports are visible to anyone who can view the encounter.
            encounter_id = _require_id(data)
            tournament_id = await visibility_resolvers.tournament_id_for_encounter(session, encounter_id)
            await assert_tournament_viewable(session, _optional_identity(data), tournament_id)
            # The form config rides this envelope so the report dialog opens with
            # exactly the rules the submit endpoint will enforce, in one round trip.
            return {
                "reports": await captain_service.get_encounter_reports(session, encounter_id),
                "form": _dump(await report_form_service.resolve_report_form(session, tournament_id)),
            }

        return await _run(logger, op)

    # ── captain: map veto (generic pick-ban engine, kind=map) ───────────────
    #
    # Decision #12 (docs/plans/2026-08-09-generic-pickban-engine.md): map
    # veto's RPC paths/shapes stay exactly as-is; only the storage underneath
    # moves onto PickBanConfig/PickBanSession/PickBanEntry. The three adapters
    # below translate the generic engine's item_id/round vocabulary back to
    # the legacy map_id/slot one so EncounterMapPoolModal and MatchReportDialog
    # (the two remaining consumers of this translated shape) need zero changes.

    def _map_entry_from_pick_ban(entry: dict) -> dict:
        return {
            "id": entry["id"],
            "map_id": entry["item_id"],
            "slot": entry["round"],
            "order": entry["order"],
            "action_index": entry["action_index"],
            "picked_by": entry["picked_by"],
            "team_id": entry["team_id"],
            "status": entry["status"],
        }

    def _map_session_from_pick_ban(pb_session: dict) -> dict:
        return {
            "id": pb_session["id"],
            "status": pb_session["status"],
            "first_side": pb_session["first_side"],
            "seed_source": pb_session["seed_source"],
            "home_seed": pb_session["home_seed"],
            "away_seed": pb_session["away_seed"],
            "turn_timer_seconds": pb_session["turn_timer_seconds"],
            "slot_reserves": pb_session["slot_reserves"],
            "started_at": pb_session["started_at"],
            "current_step_started_at": pb_session["current_step_started_at"],
        }

    def _map_state_from_pick_ban(state: dict) -> dict:
        pb_session = state["session"]
        return {
            "session": _map_session_from_pick_ban(pb_session) if pb_session is not None else None,
            "reason": state.get("reason"),
            "sequence": state["sequence"],
            "pool": [_map_entry_from_pick_ban(entry) for entry in state["pool"]],
            "viewer_side": state["viewer_side"],
            "viewer_can_act": state["viewer_can_act"],
            "allowed_actions": state["allowed_actions"],
            "current_step_index": state["current_step_index"],
            "current_step": state["current_step"],
            "expected_action": state["expected_action"],
            "turn_side": state["turn_side"],
            "current_slot": state["current_round"],
            "is_complete": state["is_complete"],
        }

    @broker.subscriber("rpc.tournament.captain_map_pool")
    async def _captain_map_pool(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # Public route — no identity required, but hidden tournaments 404.
            encounter_id = _require_id(data)
            tournament_id = await visibility_resolvers.tournament_id_for_encounter(session, encounter_id)
            await assert_tournament_viewable(session, _optional_identity(data), tournament_id)
            pick_ban = await pick_ban_session_service.get_pick_ban_session(session, encounter_id, PickBanKind.MAP)
            if pick_ban is None:
                return []
            pool = await pick_ban_action_service.get_pick_ban_pool(session, pick_ban, encounter_id, PickBanKind.MAP)
            return [_map_entry_from_pick_ban(pick_ban_action_service.serialize_pick_ban_entry(e)) for e in pool]

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_map_pool_state")
    async def _captain_map_pool_state(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # Optional auth: a captain sees their side annotated, anyone else gets
            # viewer_side=None (the pool serializes identically either way).
            encounter_id = _require_id(data)
            user = _optional_identity(data)
            tournament_id = await visibility_resolvers.tournament_id_for_encounter(session, encounter_id)
            await assert_tournament_viewable(session, user, tournament_id)
            encounter = await captain_service._load_encounter(session, encounter_id)
            viewer_side = await resolve_optional_viewer_side(session, user, encounter)
            state = await pick_ban_action_service.get_pick_ban_state(
                session, encounter_id, PickBanKind.MAP, viewer_side=viewer_side
            )
            return _map_state_from_pick_ban(state)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_veto")
    async def _captain_veto(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            body = VetoAction.model_validate(_payload(data))
            encounter = await captain_service._load_encounter(session, encounter_id)
            captain_side = await captain_service.resolve_captain_side(session, user, encounter)
            # perform_pick_ban_action commits internally; route returns a custom dict.
            entry = await pick_ban_action_service.perform_pick_ban_action(
                session,
                encounter_id,
                PickBanKind.MAP,
                captain_side,
                body.map_id,
                body.action,
            )
            return {
                "id": entry.id,
                "map_id": entry.item_id,
                "status": entry.status,
                "picked_by": entry.picked_by,
            }

        return await _run(logger, op)

    def _parse_kind(data: dict) -> PickBanKind:
        raw = data.get("kind")
        if raw not in ("map", "hero"):
            raise HTTPException(status_code=422, detail="kind must be 'map' or 'hero'")
        return PickBanKind(raw)

    @broker.subscriber("rpc.tournament.captain_pick_ban_state")
    async def _captain_pick_ban_state(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            kind = _parse_kind(data)
            encounter_id = _require_id(data)
            user = _optional_identity(data)
            tournament_id = await visibility_resolvers.tournament_id_for_encounter(session, encounter_id)
            await assert_tournament_viewable(session, user, tournament_id)
            encounter = await captain_service._load_encounter(session, encounter_id)
            viewer_side = await resolve_optional_viewer_side(session, user, encounter)
            return await pick_ban_action_service.get_pick_ban_state(
                session, encounter_id, kind, viewer_side=viewer_side
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_pick_ban_act")
    async def _captain_pick_ban_act(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            kind = _parse_kind(data)
            user = _identity(data)
            encounter_id = _require_id(data)
            body = PickBanActionInput.model_validate(_payload(data))
            encounter = await captain_service._load_encounter(session, encounter_id)
            captain_side = await captain_service.resolve_captain_side(session, user, encounter)
            entry = await pick_ban_action_service.perform_pick_ban_action(
                session, encounter_id, kind, captain_side, body.item_id, body.action
            )
            return pick_ban_action_service.serialize_pick_ban_entry(entry)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_pick_ban_elect_opener")
    async def _captain_pick_ban_elect_opener(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            kind = _parse_kind(data)
            user = _identity(data)
            encounter_id = _require_id(data)
            body = ElectOpenerInput.model_validate(_payload(data))
            encounter = await captain_service._load_encounter(session, encounter_id)
            captain_side = await captain_service.resolve_captain_side(session, user, encounter)
            pick_ban = await pick_ban_session_service.get_pick_ban_session(session, encounter_id, kind)
            if pick_ban is None:
                raise HTTPException(status_code=400, detail="No round is awaiting an opener choice")
            await pick_ban_session_service.elect_round_opener(
                session, pick_ban, first_side=body.first_side, acting_side=captain_side
            )
            return pick_ban_action_service.serialize_pick_ban_session(pick_ban)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_pick_ban_undo")
    async def _captain_pick_ban_undo(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            kind = _parse_kind(data)
            user = _identity(data)
            encounter_id = _require_id(data)
            body = PickBanUndoInput.model_validate(_payload(data))
            encounter = await captain_service._load_encounter(session, encounter_id)
            captain_side = await captain_service.resolve_captain_side(session, user, encounter)
            # Commits internally; returns the resulting undo block (empty
            # `item_ids` once the undo landed and the step it restored is open
            # again).
            return await pick_ban_undo_service.perform_undo(
                session, encounter_id, kind, captain_side, consent=body.consent
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_report_map")
    async def _captain_report_map(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            map_id = _path_int(data, "map_id")
            body = MapReportInput.model_validate(_payload(data))
            encounter = await captain_service._load_encounter(session, encounter_id)
            captain_side = await captain_service.resolve_captain_side(session, user, encounter)
            team_id = encounter.home_team_id if captain_side == "home" else encounter.away_team_id
            return await map_report_service.submit_map_report(
                session,
                encounter,
                map_id=map_id,
                team_id=team_id,
                reporter_user_id=user.id,
                home_score=body.home_score,
                away_score=body.away_score,
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.captain_ready")
    async def _captain_ready(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            encounter_id = _require_id(data)
            encounter = await captain_service._load_encounter(session, encounter_id)
            captain_side, captain_user_id, _team_id = await captain_service.resolve_captain_identity(
                session, user, encounter
            )
            # mark_ready commits internally.
            readiness = await pick_ban_session_service.mark_ready(session, encounter, captain_side, captain_user_id)
            return {"readiness": readiness}

        return await _run(logger, op)

    # ── public registration (user sign-up) ────────────────────────────────

    @broker.subscriber("rpc.tournament.reg_pub_form")
    async def _reg_pub_form(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # Public route — no identity required, but hidden tournaments 404.
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, _optional_identity(data), tournament_id)
            form = await reg_service.get_registration_form(session, tournament_id)
            if form is None:
                return None
            subrole_catalog = await resolve_subrole_catalog(session, form.workspace_id)
            # The rule is the workspace's now; fetched once here so the sync serializer
            # below stays free of round trips.
            requirement = await subscription_config.load_workspace_requirement_blob(session, form.workspace_id)
            is_open = await load_registration_open(session, tournament_id)
            return _dump(
                _form_to_read(
                    form,
                    is_open=is_open,
                    subrole_catalog=subrole_catalog,
                    subscription_requirement=requirement,
                )
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.reg_pub_create")
    async def _reg_pub_create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            body = RegistrationCreate.model_validate(_payload(data))

            # Subscription admission gate. Blocks only what can be decided WITHOUT
            # the patron typing anything: a provider still satisfiable by a challenge
            # code is deferred to check-in, where that field exists.
            form = await reg_service.get_registration_form(session, tournament_id)
            await assert_subscription_allows_registration(
                form=form,
                auth_user_id=user.id,
                resolver=_subscription_resolver(session),
            )

            # Full use-case (validation, duplicate check, create, serialize)
            # lives in the service layer; commits internally.
            return _dump(
                await reg_service.submit_public_registration(
                    session, tournament_id=tournament_id, auth_user=user, body=body
                )
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.reg_pub_get_me")
    async def _reg_pub_get_me(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            reg = await reg_service.get_registration(session, tournament_id, user.id)
            if reg is None:
                return None
            form = await reg_service.get_registration_form(session, tournament_id)
            show_ranks = form.show_ranks if form is not None else False
            profiles_open = (
                (await resolve_profiles_open(session, [reg], scope=form.open_profile_scope)).get(reg.id)
                if form is not None and form.require_open_profile
                else None
            )
            # The registrant's own read carries the same verdicts the public list
            # does, so their card can show why they are (not) admitted.
            subscription_reads = await build_subscription_reads(
                form=form,
                auth_user_id_by_registration={reg.id: user.id},
                resolver=_subscription_resolver(session),
            )
            own = subscription_reads.get(reg.id)
            workspace_id = (
                form.workspace_id if form is not None else await _resolve_tournament_workspace(session, tournament_id)
            )
            status_meta_map = await get_status_metas_map(session, workspace_id=workspace_id)
            return _dump(
                _reg_to_read(
                    reg,
                    workspace_id=workspace_id,
                    status_meta_map=status_meta_map,
                    show_ranks=show_ranks,
                    profiles_open=profiles_open,
                    subscription_outcome=own.outcome.value if own is not None else None,
                    subscription_verdicts=(serialize_verdicts(own.verdicts) if own is not None else None),
                )
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.reg_pub_update_me")
    async def _reg_pub_update_me(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            body = RegistrationUpdate.model_validate(_payload(data))

            form = await reg_service.get_registration_form(session, tournament_id)
            if form is None:
                raise HTTPException(status_code=404, detail="Registration form not found")

            reg = await reg_service.get_registration(session, tournament_id, user.id)
            if reg is None:
                raise HTTPException(status_code=404, detail="No registration found")
            if reg.status != "pending":
                raise HTTPException(status_code=400, detail="Cannot update a registration that is not pending")

            validate_registration_input(form, body, partial=True)
            await validate_verified_identity(
                session,
                form=form,
                payload=body,
                # get_registration eager-loads workspace_member (the
                # registration's only identity anchor since dbarch02).
                player_id=reg.workspace_member.player_id if reg.workspace_member is not None else None,
                partial=True,
            )

            # update_registration commits internally.
            updated = await reg_service.update_registration(
                session,
                reg,
                **body.model_dump(exclude_unset=True),
            )
            status_meta_map = await get_status_metas_map(session, workspace_id=form.workspace_id)
            return _dump(
                _reg_to_read(
                    updated,
                    workspace_id=form.workspace_id,
                    status_meta_map=status_meta_map,
                    show_ranks=form.show_ranks,
                )
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.reg_pub_withdraw_me")
    async def _reg_pub_withdraw_me(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            reg = await reg_service.get_registration(session, tournament_id, user.id)
            if reg is None:
                raise HTTPException(status_code=404, detail="No registration found")
            # withdraw_registration commits internally.
            await reg_service.withdraw_registration(session, reg)
            return _dump(RegistrationStatusResponse(status="withdrawn", message="Registration withdrawn"))

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.reg_pub_check_in")
    async def _reg_pub_check_in(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            reg = await reg_service.get_registration(session, tournament_id, user.id)
            if reg is None:
                raise HTTPException(status_code=404, detail="No registration found")

            # "All profiles open" admission gate: block check-in only when the profile is
            # confirmed closed. Unknown (not yet fetched) fails open.
            form = await reg_service.get_registration_form(session, tournament_id)
            if form is not None and form.require_open_profile:
                verdict = (await resolve_profiles_open(session, [reg], scope=form.open_profile_scope)).get(reg.id)
                if verdict is False:
                    raise HTTPException(
                        status_code=400,
                        detail="Your Overwatch profile is private. Make it public to check in.",
                    )

            # Subscription admission gate. Same contract as the profile gate one
            # block up: block only on a CONFIRMED refusal, so a provider outage
            # (unknown) can never lock anybody out of a live check-in.
            await assert_subscription_allows_check_in(
                form=form,
                auth_user_id=user.id,
                resolver=_subscription_resolver(session),
            )

            # check_in_registration commits internally.
            checked_in = await reg_service.check_in_registration(
                session,
                reg,
                checked_in_by=user.id,
            )
            workspace_id = await _resolve_tournament_workspace(session, tournament_id)
            status_meta_map = await get_status_metas_map(session, workspace_id=workspace_id)
            return _dump(
                _reg_to_read(
                    checked_in,
                    workspace_id=workspace_id,
                    status_meta_map=status_meta_map,
                    show_ranks=form.show_ranks if form else False,
                )
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.sub_me")
    async def _sub_me(data: dict, msg: RabbitMessage) -> dict:
        """The caller's own subscription standing for this tournament.

        Read-only and non-forcing: the registration form polls it to render the
        per-provider chips, so it must not spend a provider call per page view.
        """

        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            form = await reg_service.get_registration_form(session, tournament_id)
            return _dump(
                await subscription_status_for_user(
                    form=form,
                    auth_user_id=user.id,
                    resolver=_subscription_resolver(session),
                )
            )

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.sub_redeem_code")
    async def _sub_redeem_code(data: dict, msg: RabbitMessage) -> dict:
        """Redeem a challenge code published in a subscriber-only post.

        Rate-limited per user: this endpoint is a guessing oracle, and the codes
        are short enough to brute-force without a ceiling.
        """

        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            body = SubscriptionRedeemRequest.model_validate(_payload(data))
            form = await reg_service.get_registration_form(session, tournament_id)
            if form is None:
                raise HTTPException(status_code=404, detail="Registration form not found")

            await assert_redeem_attempt_allowed(workspace_id=form.workspace_id, auth_user_id=user.id)
            await redeem_challenge_code(
                store=build_store(session),
                workspace_id=form.workspace_id,
                auth_user_id=user.id,
                provider=body.provider,
                submitted_code=body.code,
            )
            await session.commit()
            # Redemption writes the entitlement straight through the store, so the
            # resolver's own signal never fires for it. Published here, after the
            # commit, which also makes this the one path with no ordering caveat.
            await publish_subscriptions_updated(
                get_realtime_redis(),
                form.workspace_id,
                reason=SubscriptionCollectionSource.redeem,
            )
            return _dump(
                await subscription_status_for_user(
                    form=form,
                    auth_user_id=user.id,
                    resolver=_subscription_resolver(session),
                )
            )

        return await _run(logger, op)

    # Isolated QoS: the participants list is the heaviest public read and fans
    # out to every connected viewer after each registration mutation (the
    # realtime invalidation herd). On its own channel a burst of list rebuilds
    # can no longer occupy the default channel's RPC_PREFETCH_COUNT slots and
    # starve the write RPCs (check-in/register) queued behind it — mirrors
    # recalculation_events._EVENTS_CHANNEL.
    @broker.subscriber("rpc.tournament.reg_pub_list", channel=Channel(prefetch_count=8))
    async def _reg_pub_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            # Public route — no identity required. The visibility check is
            # viewer-dependent and always runs on this call's own session; the
            # (expensive, viewer-agnostic) read-model build below is coalesced
            # across concurrent callers -- see ``_coalesced_registration_list``.
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, _optional_identity(data), tournament_id)
            return _dump(await _coalesced_registration_list(tournament_id))

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_list_public")
    async def _regteam_list_public(data: dict, msg: RabbitMessage) -> dict:
        """The public "Teams" roster for a tournament.

        Distinct from the admin ``regteam_list``: invites are omitted, because a
        public roster must not leak who has been asked and declined. Terminal teams
        are omitted too — a rejected team is not part of the field.
        """

        async def op(session: Any) -> Any:
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, _optional_identity(data), tournament_id)
            pairs = await team_service.list_teams(session, tournament_id=tournament_id, include_terminal=False)
            items = [await team_service.describe_team(session, team) for team, _occupancy in pairs]
            return _dump(RegistrationTeamListResponse(items=items, total=len(items)))

        return await _run(logger, op)

    # ── public team registration (captain + invitee flows) ─────────────────
    #
    # Every handler here is a *public* surface: the invitee flows in particular are
    # reachable by anyone holding a link. The service layer owns the row lock, the
    # slot decision and the machine error codes; these handlers only translate
    # transport to arguments. See docs/plans/2026-08-20-team-registration.md §4.

    @broker.subscriber("rpc.tournament.regteam_create")
    async def _regteam_create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            tournament_id = _path_int(data, "tournament_id")
            await assert_tournament_viewable(session, user, tournament_id)
            body = RegistrationTeamCreateRequest.model_validate(_payload(data))

            # Same gate as solo registration: the captain is a registrant like any
            # other, so an unsubscribed account cannot slip in by founding a team.
            form = await reg_service.get_registration_form(session, tournament_id)
            await assert_subscription_allows_registration(
                form=form,
                auth_user_id=user.id,
                resolver=_subscription_resolver(session),
            )

            team, _registration = await team_service.create_team(
                session,
                tournament_id=tournament_id,
                auth_user=user,
                name=body.name,
                slot_code=body.slot_code,
                body=body.registration,
            )
            # The captain sees their own outstanding offers; a public roster does not.
            return _dump(await team_service.describe_team(session, team, include_invites=True))

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_invite")
    async def _regteam_invite(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            team_id = _path_int(data, "team_id")
            body = RegistrationTeamInviteCreateRequest.model_validate(_payload(data))
            ttl = timedelta(days=body.ttl_days) if body.ttl_days is not None else team_service.DEFAULT_INVITE_TTL
            invite, raw_token = await team_service.invite_member(
                session,
                team_id=team_id,
                auth_user=user,
                slot_code=body.slot_code,
                is_substitute=body.is_substitute,
                target_auth_user_id=body.target_auth_user_id,
                ttl=ttl,
            )
            # The raw token is returned exactly once, here, and never stored or
            # re-served: only its sha256 is persisted.
            return _dump(serialize_invite(invite)) | {"token": raw_token}

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_invite_revoke")
    async def _regteam_invite_revoke(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            await team_service.revoke_invite(
                session,
                invite_id=_path_int(data, "invite_id"),
                auth_user=user,
            )
            return None

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_accept")
    async def _regteam_accept(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            body = RegistrationTeamAcceptRequest.model_validate(_payload(data))
            team, _registration = await team_service.accept_invite(
                session,
                auth_user=user,
                body=body.registration,
                token=body.token,
                invite_id=body.invite_id,
            )
            # An invitee is now a member, so their own offers view is theirs to see.
            return _dump(await team_service.describe_team(session, team, include_invites=True))

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_decline")
    async def _regteam_decline(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            payload = _payload(data) or {}
            await team_service.decline_invite(
                session,
                auth_user=user,
                token=payload.get("token"),
                invite_id=payload.get("invite_id"),
            )
            return None

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_kick")
    async def _regteam_kick(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            await team_service.kick_member(
                session,
                team_id=_path_int(data, "team_id"),
                registration_id=_path_int(data, "registration_id"),
                auth_user=user,
            )
            return None

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_leave")
    async def _regteam_leave(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            await team_service.leave_team(session, team_id=_path_int(data, "team_id"), auth_user=user)
            return None

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_transfer_captain")
    async def _regteam_transfer_captain(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            await team_service.transfer_captaincy(
                session,
                team_id=_path_int(data, "team_id"),
                registration_id=_path_int(data, "registration_id"),
                auth_user=user,
            )
            return None

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.regteam_disband")
    async def _regteam_disband(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            await team_service.disband_team(session, team_id=_path_int(data, "team_id"), auth_user=user)
            return None

        return await _run(logger, op)

    # ── encounter saved-view writes ───────────────────────────────────────

    @broker.subscriber("rpc.tournament.saved_view_create")
    async def _saved_view_create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            workspace_id = _require_q1(data, "workspace_id", int)
            if not user.is_workspace_member(workspace_id):
                raise HTTPException(status_code=403, detail="Not a member of this workspace")
            body = schemas.EncounterSavedViewCreate.model_validate(_payload(data))
            # upsert_saved_view commits internally; route uses response_model_exclude_none=True.
            saved_view = await encounter_flows.save_view(
                session,
                workspace_id=workspace_id,
                auth_user_id=user.id,
                data=body,
            )
            return _dump(saved_view, exclude_none=True)

        return await _run(logger, op)

    @broker.subscriber("rpc.tournament.saved_view_delete")
    async def _saved_view_delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = _identity(data)
            saved_view_id = _path_int(data, "saved_view_id")
            workspace_id = _require_q1(data, "workspace_id", int)
            if not user.is_workspace_member(workspace_id):
                raise HTTPException(status_code=403, detail="Not a member of this workspace")
            # delete_saved_view commits internally; route returns 204 (no body).
            await encounter_flows.delete_saved_view(
                session,
                workspace_id=workspace_id,
                auth_user_id=user.id,
                saved_view_id=saved_view_id,
            )
            return None

        return await _run(logger, op)
