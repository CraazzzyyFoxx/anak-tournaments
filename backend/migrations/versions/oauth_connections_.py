"""Add OAuth connections table for generic OAuth support

Revision ID: oauth_connections
Revises: rbac_implementation
Create Date: 2025-12-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'oauth_connections'
down_revision: Union[str, None] = 'rbac_implementation'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create oauth_connections table
    op.create_table(
        'oauth_connections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('auth_user_id', sa.Integer(), nullable=False),
        sa.Column('provider', sa.String(length=50), nullable=False),
        sa.Column('provider_user_id', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('username', sa.String(length=100), nullable=False),
        sa.Column('display_name', sa.String(length=100), nullable=True),
        sa.Column('avatar_url', sa.String(length=500), nullable=True),
        sa.Column('access_token', sa.Text(), nullable=True),
        sa.Column('refresh_token', sa.Text(), nullable=True),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('provider_data', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['auth_user_id'], ['auth_user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('provider', 'provider_user_id', name='uq_provider_user')
    )
    op.create_index(op.f('ix_oauth_connections_provider'), 'oauth_connections', ['provider'], unique=False)
    op.create_index(op.f('ix_oauth_connections_provider_user_id'), 'oauth_connections', ['provider_user_id'], unique=False)

    # Migrate existing Discord OAuth data to new table
    op.execute("""
        INSERT INTO oauth_connections (
            auth_user_id, provider, provider_user_id, email, username,
            display_name, avatar_url, access_token, refresh_token,
            token_expires_at, created_at, updated_at
        )
        SELECT 
            auth_user_id,
            'discord' as provider,
            CAST(discord_id AS VARCHAR) as provider_user_id,
            discord_email,
            discord_username,
            discord_username as display_name,
            CASE 
                WHEN discord_avatar IS NOT NULL 
                THEN CONCAT('https://cdn.discordapp.com/avatars/', discord_id, '/', discord_avatar, '.png')
                ELSE NULL
            END as avatar_url,
            access_token,
            refresh_token,
            token_expires_at,
            created_at,
            updated_at
        FROM auth_user_discord;
    """)


def downgrade() -> None:
    # Recreate data in auth_user_discord if needed
    # Note: This is a lossy downgrade as we lose provider_data and may have non-Discord providers
    op.execute("""
        INSERT INTO auth_user_discord (
            auth_user_id, discord_id, discord_username, discord_discriminator,
            discord_avatar, discord_email, access_token, refresh_token,
            token_expires_at, created_at, updated_at
        )
        SELECT 
            auth_user_id,
            CAST(provider_user_id AS BIGINT) as discord_id,
            username as discord_username,
            NULL as discord_discriminator,
            CASE 
                WHEN avatar_url LIKE '%cdn.discordapp.com%'
                THEN SUBSTRING(avatar_url FROM '/avatars/[0-9]+/([^/]+)\\.png')
                ELSE NULL
            END as discord_avatar,
            email as discord_email,
            access_token,
            refresh_token,
            token_expires_at,
            created_at,
            updated_at
        FROM oauth_connections
        WHERE provider = 'discord';
    """)
    
    op.drop_index(op.f('ix_oauth_connections_provider_user_id'), table_name='oauth_connections')
    op.drop_index(op.f('ix_oauth_connections_provider'), table_name='oauth_connections')
    op.drop_table('oauth_connections')
