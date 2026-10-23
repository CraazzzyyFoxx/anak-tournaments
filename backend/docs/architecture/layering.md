# Service Layering (app-service, stats-service)

These are the enforced sub-domain contracts inside the `services/` layer of `app-service` and of
`stats-service`'s public read surface. For the general rpc → services → domain → repository → models
layering every service follows, see [`backend/ARCHITECTURE.md`](../../ARCHITECTURE.md).

Enforced by `backend/app-service/.importlinter` and `backend/stats-service/.importlinter`. Run from `backend/`:

```bash
uv run lint-imports --config app-service/.importlinter
uv run lint-imports --config stats-service/.importlinter
```

## app-service contracts

| Contract | Rule |
|---|---|
| `services-independence` | Inside `src.services`, `user` and `workspace` never import each other, directly or indirectly. |
| `rpc-goes-through-services` | `src.rpc` never imports `user.queries`; it calls one service. |

## stats-service public-read contracts

| Contract | Rule |
|---|---|
| `read-services-layers` | Inside `src.services`, high → low: `achievement_reads` → `user` → `hero`, `map`, `statistics`. |
| `rpc-goes-through-read-services` | `src.rpc` never imports a query class (`user`, `hero`, `statistics`, `achievement_reads` `.queries`); it calls one service. |
| `user-privates` | `user.queries` and `user._mappers` are private to `services.user`. |
| `achievement-reads-privates` | `achievement_reads._mappers` is private to `services.achievement_reads`. |

Existing reverse imports are listed by name under `ignore_imports` in `read-services-layers`
(`map.service` → `hero.queries`, `hero.service`, `user.service`). The list must only shrink.

## How to add a new domain

1. Pick the lowest layer that's compatible with its dependencies (stats-service), or whether it must stay
   independent of `user` and `workspace` (app-service).
2. Add its package name to that layer, or to the independence contract's `modules`, in `.importlinter`.
3. Run `lint-imports`. If it fails, either:
   - Restructure to fit the layering, or
   - Argue for moving up a layer (must not create cycles).
