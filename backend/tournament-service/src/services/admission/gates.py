"""The HTTP projection: ``blockers`` turned into a 400, and nothing else.

This gate makes no decision: it projects :attr:`AdmissionEvaluation.blockers`,
like the badge and the sort ordinal do, so a server refusal and a client-rendered
refusal come from the same
:class:`~src.services.admission.types.RequirementVerdict` list.

One ``ApiExc`` per blocker, carrying the reason's machine ``code`` (the
convention ``teams.py`` uses and ``lib/registration/team-errors.ts`` consumes),
so the client translates a refusal without re-deriving the rule; ``msg`` is the
Russian fallback for a code it cannot translate yet.

Every blocker is emitted, not just the first, so a player refused for two
reasons is not refused again after fixing one.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from shared.core.errors import ApiExc, ApiHTTPException
from shared.core.social import PROVIDERS
from src.services.admission.requirements import open_profile, subscription
from src.services.admission.types import AdmissionEvaluation, AdmissionStage, RequirementVerdict

if TYPE_CHECKING:
    from shared.services.subscriptions import SubscriptionRequirement
    from src.services.admission.config import AdmissionConfig

__all__ = ("assert_admitted", "describe_requirement")

#: The gate being refused at, in the genitive the sentences below need. Indexed,
#: not ``.get``-ed: a new stage without wording should fail loudly in tests.
_STAGE_NOUNS: Final[dict[AdmissionStage, str]] = {
    AdmissionStage.registration: "регистрации",
    AdmissionStage.check_in: "чек-ина",
}


def describe_requirement(requirement: SubscriptionRequirement) -> str:
    """Human-readable rule, e.g. ``Boosty уровень 2 или Twitch``.

    The message must name the ACTUAL rule: under ``any`` a patron who satisfies
    one of two providers is admitted, so a generic "subscription required" would
    leave a refused patron unable to tell which side to fix.
    """
    parts = []
    for req in requirement.requirements:
        spec = PROVIDERS.get(req.provider)
        label = spec.label if spec is not None else req.provider
        # A threshold of 1 is "any paid tier" — spelling it out reads like a
        # restriction that is not there.
        parts.append(f"{label} уровень {req.min_tier_rank}" if req.min_tier_rank > 1 else label)
    conjunction = " или " if requirement.mode == "any" else " и "
    return conjunction.join(parts)


def _code(verdict: RequirementVerdict) -> str:
    """The machine code for one refusal: the first reason's, which the player acts on.

    ``{key}_blocked`` covers a ``blocked`` verdict with no reasons (a resolver
    bug), so the client still gets something to translate.
    """
    if verdict.reasons:
        return verdict.reasons[0].code
    return f"{verdict.key}_blocked"


def _message(verdict: RequirementVerdict, stage: AdmissionStage, config: AdmissionConfig | None) -> str:
    """The Russian fallback sentence for one refusal.

    Keyed on the GATE stage, not ``verdict.stage``: a requirement armed at
    ``registration`` also blocks check-in, and a patron refused at check-in must
    not read a sign-up message.
    """
    if verdict.key == subscription.KEY:
        head = f"Для {_STAGE_NOUNS[stage]} нужна активная подписка"
        rule = config.subscription_rule if config is not None else None
        return f"{head}: {describe_requirement(rule)}." if rule is not None else f"{head}."
    if verdict.key == open_profile.KEY:
        return "Профиль Overwatch должен быть открыт."
    # A registry entry added without wording. Refusing with the raw key beats
    # either a KeyError (a 500 where the player earned a 400) or admitting them.
    return f"Требование не выполнено: {verdict.key}."


def assert_admitted(
    evaluation: AdmissionEvaluation,
    *,
    stage: AdmissionStage,
    config: AdmissionConfig | None = None,
) -> None:
    """Raise 400 iff ``evaluation`` has blockers. Never decides anything itself.

    ``blockers`` holds only ``blocked`` verdicts whose gate has arrived, and is
    empty once checked in, which makes an organizer's manual check-in an override.

    ``config`` supplies only wording (the subscription rule in the message);
    omitting it costs the rule text, never a refusal.
    """
    if not evaluation.blockers:
        return
    raise ApiHTTPException(
        status_code=400,
        detail=[ApiExc(msg=_message(verdict, stage, config), code=_code(verdict)) for verdict in evaluation.blockers],
    )
