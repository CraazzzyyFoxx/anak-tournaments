# Archive — superseded plan/spec split

**Frozen. Do not add to this directory.**

`specs/` held the design of a change and `plans/` its implementation plan. That split is gone;
new work goes in [`../plans/`](../plans/) as a single dated document.

What is here is historical: read it to find out *why* a decision was made, never as a
description of how the system currently behaves. Some of these documents describe designs that
were never implemented, and internal links between them have rotted as files moved or were
deleted. Neither is repaired.

For the current system, start at [`../README.md`](../README.md).

Two documents here are still linked from the live index because nothing has replaced them:

- [`plans/2026-07-06-subdomains-ops-runbook.md`](plans/2026-07-06-subdomains-ops-runbook.md) — the workspace subdomain and custom-domain operations runbook.
- [`specs/2026-08-06-nginx-dos-hardening-design.md`](specs/2026-08-06-nginx-dos-hardening-design.md) — the nginx rate-limit design, referenced from [`../architecture.md`](../architecture.md) because the limits still ship in `limit_req_dry_run` mode.
