# Plans

Design and implementation documents for individual changes. One document per change, covering
both the design and the plan — the earlier split into separate spec and plan files is archived
in [`../superpowers/`](../superpowers/) and not repeated.

## Conventions

- **Filename:** `YYYY-MM-DD-<slug>.md`, dated when the document is created. A change large
  enough to need several files gets a directory instead: `docs/<slug>/`.
- **Status line:** the second line of the document, exactly this shape, so it can be read
  without opening the file in an editor:

  ```
  **Status:** draft | design approved | implementing | implemented (YYYY-MM-DD) | abandoned
  ```

- **Lifecycle:** a plan is point-in-time. Once the change ships, anything that must outlive it
  moves into an evergreen document — [`../architecture.md`](../architecture.md),
  [`../database_erd.md`](../database_erd.md), [`../users-identity.md`](../users-identity.md), a
  component README — and the plan stops being maintained. It is not deleted: `git log` on a
  plan is how the next person finds out why.

Documents predating these conventions are left as they are. Their status, where present, is
written in whatever form the author chose.
