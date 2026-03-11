"""Expand RBAC permissions for admin v1

Revision ID: 1f4f0e9d8c2b
Revises: oauth_connections
Create Date: 2026-03-10 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1f4f0e9d8c2b"
down_revision: str | None = "oauth_connections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO permissions (name, resource, action, description)
        VALUES
            ('player.read', 'player', 'read', 'View players'),
            ('player.create', 'player', 'create', 'Create players'),
            ('player.update', 'player', 'update', 'Update players'),
            ('player.delete', 'player', 'delete', 'Delete players'),
            ('standing.read', 'standing', 'read', 'View standings'),
            ('standing.update', 'standing', 'update', 'Update standings'),
            ('standing.delete', 'standing', 'delete', 'Delete standings'),
            ('standing.recalculate', 'standing', 'recalculate', 'Recalculate standings'),
            ('team.import', 'team', 'import', 'Import or bulk-create teams'),
            ('match.sync', 'match', 'sync', 'Sync encounters from external systems'),
            ('hero.read', 'hero', 'read', 'View heroes'),
            ('hero.create', 'hero', 'create', 'Create heroes'),
            ('hero.update', 'hero', 'update', 'Update heroes'),
            ('hero.delete', 'hero', 'delete', 'Delete heroes'),
            ('hero.sync', 'hero', 'sync', 'Sync heroes from the game source'),
            ('gamemode.read', 'gamemode', 'read', 'View gamemodes'),
            ('gamemode.create', 'gamemode', 'create', 'Create gamemodes'),
            ('gamemode.update', 'gamemode', 'update', 'Update gamemodes'),
            ('gamemode.delete', 'gamemode', 'delete', 'Delete gamemodes'),
            ('gamemode.sync', 'gamemode', 'sync', 'Sync gamemodes from the game source'),
            ('map.read', 'map', 'read', 'View maps'),
            ('map.create', 'map', 'create', 'Create maps'),
            ('map.update', 'map', 'update', 'Update maps'),
            ('map.delete', 'map', 'delete', 'Delete maps'),
            ('map.sync', 'map', 'sync', 'Sync maps from the game source'),
            ('achievement.read', 'achievement', 'read', 'View achievements'),
            ('achievement.create', 'achievement', 'create', 'Create achievements'),
            ('achievement.update', 'achievement', 'update', 'Update achievements'),
            ('achievement.delete', 'achievement', 'delete', 'Delete achievements'),
            ('achievement.calculate', 'achievement', 'calculate', 'Calculate achievements'),
            ('auth_user.read', 'auth_user', 'read', 'View auth users'),
            ('auth_user.update', 'auth_user', 'update', 'Update auth users'),
            ('role.read', 'role', 'read', 'View roles'),
            ('role.create', 'role', 'create', 'Create roles'),
            ('role.update', 'role', 'update', 'Update roles'),
            ('role.delete', 'role', 'delete', 'Delete roles'),
            ('role.assign', 'role', 'assign', 'Assign or remove roles from users'),
            ('permission.read', 'permission', 'read', 'View permissions')
        ON CONFLICT (name) DO NOTHING;
        """
    )

    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        JOIN permissions p ON p.name IN (
            'player.read', 'player.create', 'player.update', 'player.delete',
            'standing.read', 'standing.update', 'standing.delete', 'standing.recalculate',
            'team.import', 'match.sync'
        )
        WHERE r.name = 'tournament_organizer'
        AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.role_id = r.id AND rp.permission_id = p.id
        );
        """
    )

    op.execute(
        """
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        JOIN permissions p ON p.name IN (
            'player.read', 'player.update', 'standing.read'
        )
        WHERE r.name = 'moderator'
        AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.role_id = r.id AND rp.permission_id = p.id
        );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM permissions
        WHERE name IN (
            'player.read', 'player.create', 'player.update', 'player.delete',
            'standing.read', 'standing.update', 'standing.delete', 'standing.recalculate',
            'team.import', 'match.sync',
            'hero.read', 'hero.create', 'hero.update', 'hero.delete', 'hero.sync',
            'gamemode.read', 'gamemode.create', 'gamemode.update', 'gamemode.delete', 'gamemode.sync',
            'map.read', 'map.create', 'map.update', 'map.delete', 'map.sync',
            'achievement.read', 'achievement.create', 'achievement.update', 'achievement.delete', 'achievement.calculate',
            'auth_user.read', 'auth_user.update',
            'role.read', 'role.create', 'role.update', 'role.delete', 'role.assign',
            'permission.read'
        );
        """
    )
