"""Add RBAC tables (roles, permissions, user_roles, role_permissions)

Revision ID: rbac_implementation
Revises: 73ae75b49806
Create Date: 2025-12-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'rbac_implementation'
down_revision: Union[str, None] = '73ae75b49806'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create permissions table
    op.create_table(
        'permissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('resource', sa.String(length=100), nullable=False),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_permissions_name'), 'permissions', ['name'], unique=True)
    op.create_index(op.f('ix_permissions_resource'), 'permissions', ['resource'], unique=False)
    op.create_index(op.f('ix_permissions_action'), 'permissions', ['action'], unique=False)

    # Create roles table
    op.create_table(
        'roles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_roles_name'), 'roles', ['name'], unique=True)

    # Create user_roles association table
    op.create_table(
        'user_roles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['auth_user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create role_permissions association table
    op.create_table(
        'role_permissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('permission_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Insert default permissions
    op.execute("""
        INSERT INTO permissions (name, resource, action, description) VALUES
        -- User permissions
        ('user.read', 'user', 'read', 'View user information'),
        ('user.create', 'user', 'create', 'Create new users'),
        ('user.update', 'user', 'update', 'Update user information'),
        ('user.delete', 'user', 'delete', 'Delete users'),
        
        -- Tournament permissions
        ('tournament.read', 'tournament', 'read', 'View tournaments'),
        ('tournament.create', 'tournament', 'create', 'Create tournaments'),
        ('tournament.update', 'tournament', 'update', 'Update tournaments'),
        ('tournament.delete', 'tournament', 'delete', 'Delete tournaments'),
        
        -- Team permissions
        ('team.read', 'team', 'read', 'View teams'),
        ('team.create', 'team', 'create', 'Create teams'),
        ('team.update', 'team', 'update', 'Update teams'),
        ('team.delete', 'team', 'delete', 'Delete teams'),
        
        -- Match permissions
        ('match.read', 'match', 'read', 'View matches'),
        ('match.create', 'match', 'create', 'Create matches'),
        ('match.update', 'match', 'update', 'Update matches'),
        ('match.delete', 'match', 'delete', 'Delete matches'),
        
        -- Analytics permissions
        ('analytics.read', 'analytics', 'read', 'View analytics'),
        ('analytics.update', 'analytics', 'update', 'Update analytics data'),
        
        -- Admin wildcard
        ('admin.*', '*', '*', 'Full administrative access');
    """)

    # Insert default roles
    op.execute("""
        INSERT INTO roles (name, description, is_system) VALUES
        ('admin', 'Full system administrator', true),
        ('tournament_organizer', 'Can manage tournaments', true),
        ('moderator', 'Can moderate content', true),
        ('user', 'Basic user role', true);
    """)

    # Assign permissions to roles
    op.execute("""
        -- Admin gets all permissions
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.name = 'admin';
        
        -- Tournament organizer permissions
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.name = 'tournament_organizer'
        AND p.name IN (
            'tournament.read', 'tournament.create', 'tournament.update', 'tournament.delete',
            'team.read', 'team.create', 'team.update',
            'match.read', 'match.create', 'match.update',
            'analytics.read', 'analytics.update',
            'user.read'
        );
        
        -- Moderator permissions
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.name = 'moderator'
        AND p.name IN (
            'tournament.read', 'tournament.update',
            'team.read', 'team.update',
            'match.read', 'match.update',
            'user.read', 'user.update'
        );
        
        -- Basic user permissions
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id
        FROM roles r
        CROSS JOIN permissions p
        WHERE r.name = 'user'
        AND p.name IN (
            'tournament.read',
            'team.read',
            'match.read',
            'analytics.read',
            'user.read'
        );
    """)

    # Assign 'user' role to all existing users
    op.execute("""
        INSERT INTO user_roles (user_id, role_id)
        SELECT au.id, r.id
        FROM auth_user au
        CROSS JOIN roles r
        WHERE r.name = 'user'
        AND NOT EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id = au.id
        );
    """)


def downgrade() -> None:
    op.drop_table('role_permissions')
    op.drop_table('user_roles')
    op.drop_index(op.f('ix_roles_name'), table_name='roles')
    op.drop_table('roles')
    op.drop_index(op.f('ix_permissions_action'), table_name='permissions')
    op.drop_index(op.f('ix_permissions_resource'), table_name='permissions')
    op.drop_index(op.f('ix_permissions_name'), table_name='permissions')
    op.drop_table('permissions')
