"""OpenAPI request/response model map for stats-service RPC subjects.

Schemas-only module consumed by the export script — see ``shared.rpc.openapi``.
Models mirror the handlers' direct model construction / flow return annotations
(src/rpc/*.py). Sync acks, ad-hoc dicts and 204 handlers are omitted.
"""

from __future__ import annotations

from shared.core.pagination import Paginated
from shared.rpc.openapi import Op, QueryParam
from shared.schemas.match_doc import MatchDoc
from src import schemas

OPERATIONS: dict[str, Op] = {
    # ── canonical match ingest: the public request is the bare owt.match/1 document ─
    "rpc.stats.ingest.submit": Op(request=MatchDoc, response=schemas.IngestJobRead),
    "rpc.stats.ingest.get": Op(response=schemas.IngestJobRead),
    "rpc.stats.ingest.game_observation": Op(response=schemas.GameObservationRead),
    "rpc.stats.ingest.bind": Op(request=schemas.BindIngestRequest, response=schemas.IngestJobRead),
    # ── match-log admin ────────────────────────────────────────────────────
    "rpc.stats.logs.queue_status": Op(response=schemas.QueueDepth, response_array=True),
    "rpc.stats.logs.history": Op(
        response=schemas.LogHistoryResponse,
        query_params=(
            QueryParam("tournament_id", "integer"),
            QueryParam("encounter_id", "integer"),
            QueryParam("workspace_id", "integer"),
            QueryParam("status"),
            QueryParam("search"),
            QueryParam("limit", "integer"),
            QueryParam("offset", "integer"),
        ),
    ),
    "rpc.stats.logs.stats": Op(
        response=schemas.LogStatsRead,
        query_params=(
            QueryParam("tournament_id", "integer"),
            QueryParam("encounter_id", "integer"),
            QueryParam("workspace_id", "integer"),
        ),
    ),
    "rpc.stats.logs.retry": Op(request=schemas.LogRetryRequest, response=schemas.LogRecordRead),
    "rpc.stats.logs.upload": Op(response=schemas.LogUploadResponse),
    # ── OverFast rank (public reads) ───────────────────────────────────────
    "rpc.stats.rank.user_history": Op(
        response=schemas.RankHistoryResponse,
        query_params=(
            QueryParam("granularity"),
            QueryParam("date_from"),
            QueryParam("date_to"),
            QueryParam("social_account_id", "integer"),
            QueryParam("platform"),
            QueryParam("role"),
        ),
    ),
    "rpc.stats.rank.battle_tag_history": Op(
        response=schemas.RankHistoryResponse,
        query_params=(
            QueryParam("granularity"),
            QueryParam("date_from"),
            QueryParam("date_to"),
            QueryParam("platform"),
            QueryParam("role"),
        ),
    ),
    "rpc.stats.rank.user_current": Op(
        response=schemas.CurrentRanksResponse, query_params=(QueryParam("platform", required=True),)
    ),
    "rpc.stats.rank.stats": Op(response=schemas.RankCollectionStats),
    "rpc.stats.rank.fetch_log": Op(response=schemas.FetchLogRead, response_array=True),
    "rpc.stats.rank.user_collection": Op(response=schemas.CollectionStatusRead, response_array=True),
    "rpc.stats.rank.collect": Op(request=schemas.CollectTriggerRequest, response=schemas.CollectTriggerResponse),
    "rpc.stats.rank.reenable_disabled": Op(
        request=schemas.ReenableDisabledRequest, response=schemas.ReenableDisabledResponse
    ),
    # ── subscription collection admin ──────────────────────────────────────
    "rpc.stats.subscription.stats": Op(response=schemas.SubscriptionCollectionStats),
    "rpc.stats.subscription.check_log": Op(response=schemas.SubscriptionCheckLogRead, response_array=True),
    "rpc.stats.subscription.user_collection": Op(response=schemas.SubscriptionUserCollectionRead, response_array=True),
    "rpc.stats.subscription.collect": Op(
        request=schemas.SubscriptionCollectTriggerRequest,
        response=schemas.SubscriptionCollectTriggerResponse,
    ),
    # ── achievement calculate ──────────────────────────────────────────────
    "rpc.stats.ach.calculate": Op(
        request=schemas.AchievementCalculateRequest, response=schemas.AchievementCalculateResponse
    ),
    "rpc.stats.ach.calculate_tournament": Op(
        request=schemas.AchievementCalculateRequest, response=schemas.AchievementCalculateResponse
    ),
    # ── settings ───────────────────────────────────────────────────────────
    "rpc.stats.settings.list": Op(response=schemas.SettingRead, response_array=True),
    "rpc.stats.settings.get": Op(response=schemas.SettingRead),
    "rpc.stats.settings.upsert": Op(request=schemas.SettingUpsert, response=schemas.SettingRead),
    # ── discord channel ────────────────────────────────────────────────────
    "rpc.stats.discord_channel.get": Op(response=schemas.DiscordChannelRead),
    "rpc.stats.discord_channel.upsert": Op(request=schemas.DiscordChannelUpsert, response=schemas.DiscordChannelRead),
    # ── achievement rules admin ────────────────────────────────────────────
    "rpc.stats.ach.condition_types": Op(response=schemas.ConditionTypeInfo, response_array=True),
    "rpc.stats.ach.validate": Op(
        request=schemas.ConditionTreeValidateRequest, response=schemas.ConditionTreeValidateResponse
    ),
    "rpc.stats.ach.list": Op(
        response=Paginated[schemas.AchievementRuleRead],
        query=schemas.AchievementRuleListQueryParams,
    ),
    "rpc.stats.ach.get": Op(response=schemas.AchievementRuleRead),
    "rpc.stats.ach.create": Op(request=schemas.AchievementRuleCreate, response=schemas.AchievementRuleRead),
    "rpc.stats.ach.update": Op(request=schemas.AchievementRuleUpdate, response=schemas.AchievementRuleRead),
    "rpc.stats.ach.evaluate": Op(request=schemas.EvaluateRequest, response=schemas.EvaluationRunRead),
    "rpc.stats.ach.runs": Op(response=schemas.EvaluationRunRead, response_array=True),
    "rpc.stats.ach.lib_workspaces": Op(response=schemas.AchievementLibraryWorkspaceRead, response_array=True),
    "rpc.stats.ach.lib_list": Op(response=schemas.AchievementLibraryRuleRead, response_array=True),
    "rpc.stats.ach.overrides_list": Op(response=schemas.OverrideRead, response_array=True),
    "rpc.stats.ach.override_create": Op(request=schemas.OverrideCreate, response=schemas.OverrideRead),
}
