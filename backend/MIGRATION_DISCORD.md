# Миграция: Discord OAuth и связывание игроков

## Команды для создания миграции

```bash
cd backend/app
alembic revision --autogenerate -m "Add Discord OAuth and player linking tables"
alembic upgrade head
```

## Что будет создано

### Новые таблицы

#### auth_user_discord
```sql
CREATE TABLE auth_user_discord (
    id SERIAL PRIMARY KEY,
    auth_user_id INTEGER NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    discord_id BIGINT NOT NULL UNIQUE,
    discord_username VARCHAR(100) NOT NULL,
    discord_discriminator VARCHAR(10),
    discord_avatar VARCHAR(500),
    discord_email VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX ix_auth_user_discord_discord_id ON auth_user_discord(discord_id);
```

#### auth_user_player
```sql
CREATE TABLE auth_user_player (
    id SERIAL PRIMARY KEY,
    auth_user_id INTEGER NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX ix_auth_user_player_auth_user_id ON auth_user_player(auth_user_id);
CREATE INDEX ix_auth_user_player_player_id ON auth_user_player(player_id);
```

### Изменения существующих таблиц

#### auth_user
```sql
-- Сделать пароль nullable (для OAuth пользователей)
ALTER TABLE auth_user ALTER COLUMN hashed_password DROP NOT NULL;

-- Добавить поле avatar_url
ALTER TABLE auth_user ADD COLUMN avatar_url VARCHAR(500);
```

## Ручная миграция (если нужно)

Если автогенерация не работает, создайте миграцию вручную:

```bash
alembic revision -m "Add Discord OAuth and player linking tables"
```

Затем отредактируйте созданный файл в `backend/app/src/migrations/versions/`:

```python
"""Add Discord OAuth and player linking tables

Revision ID: xxx
Revises: yyy
Create Date: 2025-12-08 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'xxx'
down_revision = 'yyy'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make hashed_password nullable
    op.alter_column('auth_user', 'hashed_password',
                    existing_type=sa.String(length=255),
                    nullable=True)
    
    # Add avatar_url to auth_user
    op.add_column('auth_user', sa.Column('avatar_url', sa.String(length=500), nullable=True))
    
    # Create auth_user_discord table
    op.create_table(
        'auth_user_discord',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('auth_user_id', sa.Integer(), nullable=False),
        sa.Column('discord_id', sa.BigInteger(), nullable=False),
        sa.Column('discord_username', sa.String(length=100), nullable=False),
        sa.Column('discord_discriminator', sa.String(length=10), nullable=True),
        sa.Column('discord_avatar', sa.String(length=500), nullable=True),
        sa.Column('discord_email', sa.String(length=255), nullable=True),
        sa.Column('access_token', sa.Text(), nullable=True),
        sa.Column('refresh_token', sa.Text(), nullable=True),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['auth_user_id'], ['auth_user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('discord_id')
    )
    op.create_index(op.f('ix_auth_user_discord_discord_id'), 'auth_user_discord', ['discord_id'], unique=False)
    
    # Create auth_user_player table
    op.create_table(
        'auth_user_player',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('auth_user_id', sa.Integer(), nullable=False),
        sa.Column('player_id', sa.Integer(), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['auth_user_id'], ['auth_user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['player_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('player_id')
    )


def downgrade() -> None:
    # Drop tables
    op.drop_table('auth_user_player')
    op.drop_index(op.f('ix_auth_user_discord_discord_id'), table_name='auth_user_discord')
    op.drop_table('auth_user_discord')
    
    # Remove avatar_url
    op.drop_column('auth_user', 'avatar_url')
    
    # Make hashed_password not nullable again
    op.alter_column('auth_user', 'hashed_password',
                    existing_type=sa.String(length=255),
                    nullable=False)
```

## После миграции

1. Перезапустите auth-service:
```bash
cd backend/auth-service
python main.py
```

2. Проверьте Swagger документацию:
```
http://localhost:8001/docs
```

3. Должны появиться новые разделы:
   - Discord OAuth
   - Player Linking

## Проверка миграции

```sql
-- Проверить что таблицы созданы
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('auth_user_discord', 'auth_user_player');

-- Проверить структуру auth_user
\d auth_user

-- Проверить индексы
SELECT indexname FROM pg_indexes WHERE tablename IN ('auth_user_discord', 'auth_user_player');
```

## Откат миграции

Если нужно откатить:
```bash
alembic downgrade -1
```
