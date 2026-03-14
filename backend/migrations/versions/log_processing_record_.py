"""Add log_processing_record table for tracking match log upload and processing status

Revision ID: log_processing_record
Revises: oauth_connections
Create Date: 2026-03-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

# revision identifiers, used by Alembic.
revision: str = 'log_processing_record'
down_revision: Union[str, None] = 'oauth_connections'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use DO blocks so re-running the migration is safe if the types already exist
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE log_processing_status AS ENUM ('pending', 'processing', 'done', 'failed');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE log_processing_source AS ENUM ('upload', 'discord', 'manual');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    op.create_table(
        'log_processing_record',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('tournament_id', sa.BigInteger(), nullable=False),
        sa.Column('filename', sa.String(length=500), nullable=False),
        sa.Column(
            'status',
            PGEnum('pending', 'processing', 'done', 'failed', name='log_processing_status', create_type=False),
            nullable=False,
            server_default='pending',
        ),
        sa.Column(
            'source',
            PGEnum('upload', 'discord', 'manual', name='log_processing_source', create_type=False),
            nullable=False,
            server_default='manual',
        ),
        sa.Column('uploader_id', sa.BigInteger(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tournament_id'], ['tournament.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploader_id'], ['auth_user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_log_processing_record_tournament_id', 'log_processing_record', ['tournament_id'])
    op.create_index('ix_log_processing_record_status', 'log_processing_record', ['status'])


def downgrade() -> None:
    op.drop_index('ix_log_processing_record_status', table_name='log_processing_record')
    op.drop_index('ix_log_processing_record_tournament_id', table_name='log_processing_record')
    op.drop_table('log_processing_record')
    op.execute("DROP TYPE IF EXISTS log_processing_status")
    op.execute("DROP TYPE IF EXISTS log_processing_source")
