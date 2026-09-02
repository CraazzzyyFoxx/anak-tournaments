"""The production requirement list, in the order the registrant sees them.

One entry per requirement, and the entry is the whole declaration: whether this
tournament switched it on, the earliest gate it blocks at, and the pure mapping
from its resolved signal to a verdict. ``resolve.py`` passes this tuple to
:func:`~shared.services.admission.evaluate.evaluate`; nothing else imports it.

Order is load-bearing in exactly one way: ``AdmissionEvaluation.requirements``
preserves it, and the registrant's progress steps are rendered by walking that
tuple. Profile first, then subscription, matching the order the check-in handler
used to call the two checks in.

Three things about the entries are decisions, not incidental:

**The profile stage is a hard-coded literal** (D9). ``AdmissionStage.check_in``
reproduces today's behaviour exactly -- the profile check lives in
``reg_pub_check_in`` and nowhere else -- and an ``open_profile_stage`` column is
deliberately NOT being added until an organizer actually asks for one. Adding a
migration, a form field, an admin control and a serializer field for a toggle
nobody has requested costs more than the change will cost when it is requested,
because this line is the only place that would change: swap the literal for
``cfg.open_profile_stage`` and the gates, the evaluator and the UI all follow.

**The subscription entry is the only reader of**
``registration_form.subscription_stage``. It used to be read by
``subscription_gate.enforces_at_registration`` and re-encoded by the position of
each gate call across seven handlers; funnelling it through one lambda is what
makes "when does this bite" answerable by reading one file.

**``enforces_subscription``, not ``require_subscription``.** The toggle is only
armed when the workspace also has a rule to enforce; an armed toggle over an
empty rule disarms itself rather than refusing everyone.

Adding a third requirement is one entry here plus one signal resolver. Before
this layer it was five client-side copies of the decision, two gates and two
serializers.
"""

from __future__ import annotations

from shared.services.admission.requirements import open_profile, subscription
from shared.services.admission.types import AdmissionStage, Requirement

__all__ = ("REQUIREMENTS",)

REQUIREMENTS: tuple[Requirement, ...] = (
    Requirement(
        key=open_profile.KEY,
        enabled=lambda cfg: cfg.require_open_profile,
        stage=lambda cfg: AdmissionStage.check_in,
        evaluate=open_profile.eval_open_profile,
    ),
    Requirement(
        key=subscription.KEY,
        enabled=lambda cfg: cfg.enforces_subscription,
        stage=lambda cfg: cfg.subscription_stage,
        evaluate=subscription.eval_subscription,
    ),
)
