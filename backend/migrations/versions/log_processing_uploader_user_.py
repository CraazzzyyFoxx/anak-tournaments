"""Change log_processing_record.uploader_id FK from auth_user to user

Revision ID: log_processing_uploader_user
Revises: log_processing_record
Create Date: 2026-03-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'log_processing_uploader_user'
down_revision: Union[str, None] = 'log_processing_record'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullify existing uploader_id values since auth_user IDs don't map to user IDs
    op.execute("UPDATE log_processing_record SET uploader_id = NULL")

    # Drop old FK referencing auth_user
    op.drop_constraint(
        'log_processing_record_uploader_id_fkey',
        'log_processing_record',
        type_='foreignkey',
    )

    # Add new FK referencing user
    op.create_foreign_key(
        'log_processing_record_uploader_id_fkey',
        'log_processing_record',
        'user',
        ['uploader_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.execute("UPDATE log_processing_record SET uploader_id = NULL")

    op.drop_constraint(
        'log_processing_record_uploader_id_fkey',
        'log_processing_record',
        type_='foreignkey',
    )

    op.create_foreign_key(
        'log_processing_record_uploader_id_fkey',
        'log_processing_record',
        'auth_user',
        ['uploader_id'],
        ['id'],
        ondelete='SET NULL',
    )
