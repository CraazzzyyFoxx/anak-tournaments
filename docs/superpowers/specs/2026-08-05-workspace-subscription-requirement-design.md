# Workspace Subscription Requirement — Design

**Status:** accepted (2026-08-05)
**Plan:** `docs/superpowers/plans/2026-08-05-workspace-subscription-requirement.md`
**Builds on:** `docs/superpowers/specs/2026-08-04-workspace-discord-guild-design.md` (same "move it to the workspace" arc, same chokepoint discipline, same expand/contract lesson)

---

## 1. Understanding Summary

- **What:** the subscription *requirement* (`{mode, requirements:[{provider, min_tier_rank}]}`) moves from the per-tournament registration form to the workspace. The form keeps only the on/off toggle.
- **Why:** every new tournament re-asks for the rule — the creation wizard has a full requirement editor on step "Registration" (`RegistrationStep.tsx:83`), and the form builder has another (`RegistrationFormBuilder.tsx:420`). The organizer configures the same thing every time.
- **Who:** workspace admins.
- **Constraints:** the Kleene composition and `parse_requirement` are load-bearing and must not be disturbed; the public check-in dialog reads the rule; the collector in parser-service reads it too, outside the resolver protocol.
- **Non-goals (this iteration):** named presets, per-tournament tier overrides, touching provider config (already workspace-scoped), touching the `require_subscription` toggle's location.

## 2. Current State (verified)

Already workspace-scoped: `subscriptions.provider_config` (role tiers, codes, `verification_method`) and `workspace.discord_guild_id`.

Still per-tournament: `balancer.registration_form.require_subscription` (correct — that IS the toggle) and `balancer.registration_form.subscription_requirement_json` (the rule — this moves).

**Production evidence (2026-08-05):** seven registration forms exist; exactly **one** carries a requirement — tournament 84, workspace 6 (`txao`), `{"mode":"all","requirements":[{"provider":"boosty","min_tier_rank":1}]}`. No workspace has two different rules, so the backfill is unambiguous today.

Six consumers read the pair:

| Consumer | Path |
| --- | --- |
| Registration + check-in gates | `subscription_gate.py:80` `_enforceable_requirement` |
| Form status read | `subscription_status.py:75` |
| List/participants reads | `subscription_reads.py:116` |
| Scheduled collector | `parser-service/.../subscription_collection/service.py:64` — **direct SQL, not via the resolver** |
| Admin collection | `parser-service/.../subscription_collection/admin.py:229` — likewise |
| Read models | `serializers.py:119`, `registration_build.py:109` |

Frontend: two full editors (wizard step, form builder), one read-only description (`ReviewStep.tsx:53`), and one public consumer (`TournamentParticipantsPage.tsx:1084`, check-in dialog).

## 3. Assumptions

| # | Assumption | Confirmed |
| --- | --- | --- |
| A1 | One requirement per workspace is enough now; presets come later | yes |
| A2 | The schema must accept presets later **without a breaking migration** | yes — explicit |
| A3 | `require_subscription` stays on the form; it is the per-tournament decision | yes |
| A4 | Scale is trivial (5 workspaces, 7 forms) | verified in production |

## 4. Design

### 4.1 Data

```python
class SubscriptionRequirement(db.TimeStampIntegerMixin):
    __tablename__ = "requirement"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_subscription_requirement_workspace_name"),
        {"schema": SUBSCRIPTIONS_SCHEMA},
    )
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)      # 'default' for now
    requirement_json: Mapped[dict] = mapped_column(JSON, nullable=False, server_default="{}", default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)
```

Plus a **partial unique index** on `(workspace_id) WHERE is_default` — exactly one default per workspace, enforced by the database rather than by convention.

Two deliberate choices:

- **A table, not a column on `workspace`.** A `workspace.subscription_requirement_json` column would need a *data* migration into a table the day presets arrive. A table needs only new rows. That is precisely what A2 asks for.
- **The blob stays a blob inside the row**, rather than normalising `requirements[]` into a child table. It keeps `parse_requirement` and the entire Kleene stack reusable **verbatim** — the same discipline that let the Discord-guild move leave `DiscordRoleResolver` and its ~20 tests untouched. Normalising would buy referential tidiness and cost a rewrite of the one piece of logic nobody should be rewriting.

Presets later are additive only: insert more rows, add a nullable `registration_form.subscription_requirement_id` FK (`NULL` = the workspace default), expose a dropdown.

### 4.2 Read path — the seam already exists

`SubscriptionResolver` already answers a workspace-scoped question that is not part of `evaluate`: `accepted_code_providers(workspace_id, providers)` (`subscription_entitlements.py:303`), which reaches the DB through `EntitlementStore.load_configs`. The requirement is the same shape of question, so it goes through the same seam:

- `EntitlementStore` protocol gains `load_requirement(workspace_id) -> dict | None` (the raw blob).
- `SqlEntitlementStore.load_requirement` selects the default row.
- `SubscriptionResolver.load_requirement(workspace_id) -> SubscriptionRequirement | None` parses it, failing open on a malformed blob exactly as the call sites do today.

Every gate then collapses to one line:

```python
async def _enforceable_requirement(form, resolver):
    if form is None or not getattr(form, "require_subscription", False):
        return None
    return await resolver.load_requirement(workspace_id=form.workspace_id)
```

The fake resolvers in the existing test suites already implement this protocol, so they gain one method rather than being rewritten.

**The collector is the exception.** `find_tournaments_requiring_subscriptions` builds its own statement and never sees a resolver. It gains a join to `subscriptions.requirement` on `(workspace_id, is_default)`; `admin.py:229` likewise. Both keep their current "skip empty or malformed" behaviour.

### 4.3 Schemas

- `RegistrationFormUpsert` **loses** `subscription_requirement_json` and its validator.
- `RegistrationFormRead` **keeps** the field, now server-resolved and read-only, filled from the workspace. This is deliberate asymmetry: the public check-in dialog (`TournamentParticipantsPage.tsx:1084`) and `ReviewStep` read the rule, and there is no reason to make every public consumer learn about a new table. Documented at both models.
- New workspace-scoped read/write for the requirement itself, alongside the existing provider-config endpoints in tournament-service (`list_provider_configs` is the neighbour).

### 4.4 UI — one home

`/admin/subscriptions` already exists with `Status` and a **superuser-only** `Settings` tab holding the *global collector* config (`parser.subscription_collection`). That is global, not workspace — so the workspace-scoped configuration gets its own tab rather than joining it.

| Screen | Now | After |
| --- | --- | --- |
| `/admin/subscriptions` | Status · Settings (superuser) | + **Providers** (workspace admin): the provider card **moved here** from the form builder, plus the requirement editor |
| `RegistrationFormBuilder` | toggle + full editor + provider card | toggle + a read-only line ("Требуется: Boosty") + a link to the tab |
| Wizard `RegistrationStep` | toggle + full editor | **toggle only** — the core of the complaint |
| `ReviewStep` | describes the form's rule | describes the workspace rule |

Moving the provider card out of `RegistrationFormBuilder` is part of the same complaint: a workspace-scoped card was being edited from inside a tournament.

### 4.5 Migration — expand/contract, again

The lesson from `wsguild0001`/`0002` applies unchanged, and for the same reason:

| Statement | Must run | Otherwise |
| --- | --- | --- |
| `create_table subscriptions.requirement` + backfill | **before** the code | new `load_requirement` selects a table that does not exist |
| `drop_column registration_form.subscription_requirement_json` | **after** the code | the old ORM still maps it, and SQLAlchemy emits every mapped column in every `SELECT` |

Backfill: one `default` row per workspace, from that workspace's single distinct non-empty blob. **If any workspace has more than one distinct non-empty blob, the migration raises and aborts** rather than silently electing one — picking an admission rule by accident is the exact failure class this arc has spent its time eliminating. Production has zero such workspaces.

### 4.6 Verification

The fail-open guarantees must survive untouched, and the way to prove that is the same as last time: the requirement/Kleene suites (`shared/tests/test_subscription_requirement.py`) and the gate suites must stay green with **only** their fake-resolver stubs extended by one method. If a gate's decision table needs editing, the seam was wrong.

New coverage: `load_requirement` returns the default row's parsed rule; a workspace with no row yields `None` (⇒ toggle on but nothing to enforce ⇒ no provider call, the existing "empty requirement never asks" behaviour); a malformed blob yields `None` rather than raising.

## 5. Decision Log

| Decision | Alternatives | Why |
| --- | --- | --- |
| Table `subscriptions.requirement` | column on `workspace`; two normalised tables | Column forces a data migration when presets arrive; normalising forces a rewrite of `parse_requirement` and the Kleene stack |
| `load_requirement` on the existing resolver/store seam | new parameter through every signature; ORM relationship across three hops | The seam exists (`accepted_code_providers`), and the test fakes already implement the protocol |
| `Read` keeps the field, `Upsert` drops it | remove everywhere | The public check-in dialog and the wizard review read the rule; there is no value in teaching them a new table |
| Migration aborts on ambiguity | elect the most recent blob | A silently chosen admission rule is the failure class this whole arc exists to remove |
| Provider card moves to `/admin/subscriptions` | leave it in the form builder | It is workspace-scoped and was being edited from a tournament screen — same complaint |
| New tab, not the existing Settings tab | reuse Settings | Settings is superuser-only and global (collector interval/batch); this is workspace-scoped admin config |

## 6. Risks

- **Toggle on, no workspace rule.** A form can have `require_subscription = true` while the workspace has no requirement row. Today's equivalent (toggle on, empty blob) is already a documented no-op that never calls a provider, and that behaviour is preserved — but it is now reachable by a *different* route (someone clears the workspace rule and silently disarms every tournament using it). Mitigation: the form builder shows the resolved rule read-only, so "nothing configured" is visible where the toggle is; and the workspace editor warns when a rule is cleared while tournaments have the toggle on.
- **Blast radius of a single edit.** One workspace rule now governs every tournament in that workspace. That is the point, and it is also the hazard: an edit mid-tournament changes admission for a running event. The workspace editor names how many open tournaments currently enforce it.
- **Deploy ordering.** Same two-sided incompatibility as the guild move; see §4.5. Three steps, not one.

## 7. Exit Criteria

Understanding Lock confirmed; approach accepted (one requirement now, preset-ready schema); assumptions A1–A4 confirmed; risks recorded; Decision Log complete.
