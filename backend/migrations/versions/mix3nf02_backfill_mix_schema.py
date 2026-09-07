"""Backfill normalized pickup-mix relations.

Revision ID: mix3nf02
Revises: mix3nf01
Create Date: 2026-08-29 00:10:00.000000

The migration aborts on malformed or ambiguous legacy data -- a maintenance
operator must repair the reported rows rather than have them silently dropped.
Two kinds of row are deleted instead, both already unreachable by the running
application and both impossible to keep under the constraints mix3nf03 adds.
Each is counted in a NOTICE:

* a co-host id naming an account that no longer exists (nobody can authenticate
  as a deleted account, and the new foreign key would reject it);
* a ``casual.team`` row no match refers to. The old foreign key ran
  ``match -> team``, so deleting a match -- a mix hard-delete cascades into one
  -- left both of its sides and their seats behind. No read path reaches them:
  history is always loaded from the match outwards.

A team shared by two match sides is *not* deleted and is not guessable either,
so it aborts the window: picking a side would silently drop half of a real
played match.

Membership is deliberately *not* revalidated here. It is an RBAC fact that the
new code checks when a grant is *made*; re-deciding it for grants already in
the database would revoke live access on any workspace whose role bookkeeping
predates the check.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "mix3nf02"
down_revision: str | Sequence[str] | None = "mix3nf01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            dead_grants bigint;
        BEGIN
            IF EXISTS (
                SELECT 1 FROM balancer.custom_game_player
                WHERE roles_json IS NOT NULL AND jsonb_typeof(roles_json) <> 'array'
            ) THEN
                RAISE EXCEPTION 'mix3nf02: custom_game_player.roles_json contains a non-array value';
            END IF;
            IF EXISTS (
                SELECT 1 FROM balancer.custom_game
                WHERE co_host_user_ids IS NOT NULL AND jsonb_typeof(co_host_user_ids) <> 'array'
            ) THEN
                RAISE EXCEPTION 'mix3nf02: custom_game.co_host_user_ids contains a non-array value';
            END IF;
            IF EXISTS (
                SELECT 1 FROM balancer.custom_game
                WHERE config_json IS NOT NULL AND jsonb_typeof(config_json) <> 'object'
            ) THEN
                RAISE EXCEPTION 'mix3nf02: custom_game.config_json contains a non-object value';
            END IF;
            IF EXISTS (
                SELECT 1 FROM balancer.custom_game
                WHERE config_json ? 'team_count'
            ) THEN
                RAISE EXCEPTION 'mix3nf02: legacy config_json.team_count requires manual review';
            END IF;
            IF EXISTS (
                SELECT 1 FROM balancer.custom_game
                WHERE config_json ? 'team_names'
                  AND jsonb_typeof(config_json -> 'team_names') <> 'object'
            ) THEN
                RAISE EXCEPTION 'mix3nf02: config_json.team_names contains a non-object value';
            END IF;
            IF EXISTS (
                SELECT 1 FROM balancer.custom_game
                WHERE config_json ? 'role_mask'
                  AND jsonb_typeof(config_json -> 'role_mask') <> 'object'
            ) THEN
                RAISE EXCEPTION 'mix3nf02: config_json.role_mask contains a non-object value';
            END IF;
            IF EXISTS (
                SELECT 1
                FROM balancer.custom_game cg
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    COALESCE(cg.co_host_user_ids, '[]'::jsonb)
                ) AS value
                WHERE value !~ '^[0-9]+$'
            ) THEN
                RAISE EXCEPTION 'mix3nf02: co_host_user_ids contains a non-numeric user id';
            END IF;
            SELECT count(*) INTO dead_grants
            FROM balancer.custom_game cg
            CROSS JOIN LATERAL jsonb_array_elements_text(
                COALESCE(cg.co_host_user_ids, '[]'::jsonb)
            ) AS value
            WHERE NOT EXISTS (
                SELECT 1 FROM auth."user" account WHERE account.id = value::bigint
            );
            IF dead_grants > 0 THEN
                RAISE NOTICE 'mix3nf02: dropping % co-host grant(s) naming a deleted account', dead_grants;
            END IF;
            IF EXISTS (
                SELECT 1
                FROM balancer.custom_game cg
                WHERE cg.outcome_json IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM casual.match match WHERE match.custom_game_id = cg.id
                  )
            ) THEN
                RAISE EXCEPTION 'mix3nf02: outcome_json exists without a casual.match snapshot';
            END IF;
            IF EXISTS (
                SELECT 1
                FROM casual.team team
                JOIN casual.match match
                  ON match.home_team_id = team.id OR match.away_team_id = team.id
                GROUP BY team.id
                HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION 'mix3nf02: a casual.team row is shared by more than one match side';
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        UPDATE balancer.custom_game_player
        SET participation = CASE
            WHEN is_active = false THEN 'benched'
            WHEN must_play = true THEN 'must_play'
            ELSE 'pool'
        END,
        role_selection_mode = CASE
            WHEN roles_json IS NULL THEN 'all_ranked'
            ELSE 'explicit'
        END
        """
    )
    op.execute(
        """
        INSERT INTO balancer.custom_game_player_role
            (custom_game_player_id, role, priority)
        SELECT player.id, role.value, role.ordinality::integer
        FROM balancer.custom_game_player player
        CROSS JOIN LATERAL jsonb_array_elements_text(player.roles_json)
            WITH ORDINALITY AS role(value, ordinality)
        WHERE player.roles_json IS NOT NULL
        ON CONFLICT (custom_game_player_id, role) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO balancer.custom_game_co_host (custom_game_id, user_id)
        SELECT DISTINCT cg.id, account.id
        FROM balancer.custom_game cg
        CROSS JOIN LATERAL jsonb_array_elements_text(
            COALESCE(cg.co_host_user_ids, '[]'::jsonb)
        ) AS value
        JOIN auth."user" account ON account.id = value::bigint
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO balancer.custom_game_team_name (custom_game_id, team_index, name)
        SELECT cg.id, names.key::integer, left(names.value, 60)
        FROM balancer.custom_game cg
        CROSS JOIN LATERAL jsonb_each_text(
            COALESCE(cg.config_json -> 'team_names', '{}'::jsonb)
        ) AS names(key, value)
        WHERE names.key ~ '^[0-7]$' AND btrim(names.value) <> ''
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO balancer.custom_game_role_slot (custom_game_id, role, slot_count)
        SELECT cg.id, slots.key, slots.value::integer
        FROM balancer.custom_game cg
        CROSS JOIN LATERAL jsonb_each_text(
            COALESCE(cg.config_json -> 'role_mask', '{}'::jsonb)
        ) AS slots(key, value)
        WHERE slots.value ~ '^[1-9][0-9]*$'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE balancer.custom_game
        SET points_per_win = CASE
                WHEN config_json ->> 'points_per_win' ~ '^[1-9][0-9]*$'
                 AND (config_json ->> 'points_per_win')::integer <= 1000
                THEN (config_json ->> 'points_per_win')::integer
                ELSE NULL
            END,
            balancer_config_json = NULLIF(
                config_json - ARRAY['role_mask', 'team_names', 'points_per_win'],
                '{}'::jsonb
            ),
            balance_result_json = result_json
        """
    )

    # Orphan snapshots: the old foreign key ran ``match -> team``, so deleting a
    # match (a mix hard-delete cascades into one) left both of its team rows and
    # their seats behind. Nothing can read them -- every history path starts at
    # the match and eager-loads its sides -- and a row with no match cannot
    # satisfy the ``match_id NOT NULL`` mix3nf03 adds. Inverting that key is what
    # stops the leak; this clears what it already produced.
    op.execute(
        """
        DO $$
        DECLARE
            orphan_teams bigint;
        BEGIN
            SELECT count(*) INTO orphan_teams
            FROM casual.team team
            WHERE NOT EXISTS (
                SELECT 1 FROM casual.match match
                WHERE match.home_team_id = team.id OR match.away_team_id = team.id
            );
            IF orphan_teams > 0 THEN
                RAISE NOTICE 'mix3nf02: deleting % casual.team row(s) no match refers to', orphan_teams;
                DELETE FROM casual.team team
                WHERE NOT EXISTS (
                    SELECT 1 FROM casual.match match
                    WHERE match.home_team_id = team.id OR match.away_team_id = team.id
                );
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        UPDATE casual.team team
        SET match_id = match.id, side = 'home', score = match.home_score
        FROM casual.match match
        WHERE match.home_team_id = team.id
        """
    )
    op.execute(
        """
        UPDATE casual.team team
        SET match_id = match.id, side = 'away', score = match.away_score
        FROM casual.match match
        WHERE match.away_team_id = team.id
        """
    )
    op.execute(
        """
        UPDATE casual.player snapshot
        SET display_name_snapshot = COALESCE(
            member.display_name,
            player.name,
            '#' || snapshot.workspace_member_id::text
        )
        FROM workspace_member member
        JOIN players."user" player ON player.id = member.player_id
        WHERE member.id = snapshot.workspace_member_id
        """
    )
    # A member whose row is gone leaves nothing to read a name from, and the
    # snapshot column exists precisely so the seat outlives them: fall back to
    # the same ``#<id>`` label the UI already renders for an unresolvable member.
    op.execute(
        """
        UPDATE casual.player
        SET display_name_snapshot = '#' || COALESCE(workspace_member_id::text, 'unknown')
        WHERE display_name_snapshot IS NULL
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM balancer.custom_game_player WHERE participation IS NULL) THEN
                RAISE EXCEPTION 'mix3nf02: participation backfill left NULL rows';
            END IF;
            IF EXISTS (SELECT 1 FROM balancer.custom_game_player WHERE role_selection_mode IS NULL) THEN
                RAISE EXCEPTION 'mix3nf02: role-selection backfill left NULL rows';
            END IF;
            IF EXISTS (SELECT 1 FROM casual.team WHERE match_id IS NULL OR side IS NULL OR score IS NULL) THEN
                RAISE EXCEPTION 'mix3nf02: casual.team backfill left NULL rows';
            END IF;
            IF EXISTS (SELECT 1 FROM casual.player WHERE display_name_snapshot IS NULL) THEN
                RAISE EXCEPTION 'mix3nf02: casual.player snapshot name backfill left NULL rows';
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    raise NotImplementedError(
        "mix3nf02 transforms valuable mix data; restore a pre-maintenance backup or roll forward"
    )
