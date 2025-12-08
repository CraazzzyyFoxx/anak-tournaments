# Миграция: Discord Channel Configuration

## Команды для создания миграции

```bash
cd backend/app
alembic revision --autogenerate -m "Add tournament discord channel table"
alembic upgrade head
```

## Что будет создано

### Новая таблица: tournament_discord_channel

```sql
CREATE TABLE tournament_discord_channel (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
    guild_id BIGINT NOT NULL,
    channel_id BIGINT NOT NULL,
    channel_name VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT tournament_discord_channel_tournament_id_key UNIQUE (tournament_id),
    CONSTRAINT tournament_discord_channel_channel_id_key UNIQUE (channel_id)
);

CREATE INDEX ix_tournament_discord_channel_channel_id ON tournament_discord_channel(channel_id);
```

## Ручная миграция

Если автогенерация не работает, создайте миграцию вручную:

```bash
alembic revision -m "Add tournament discord channel table"
```

Затем отредактируйте файл в `backend/app/src/migrations/versions/`:

```python
"""Add tournament discord channel table

Revision ID: xxx
Revises: yyy
Create Date: 2025-12-08 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'xxx'
down_revision = 'yyy'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create tournament_discord_channel table
    op.create_table(
        'tournament_discord_channel',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tournament_id', sa.Integer(), nullable=False),
        sa.Column('guild_id', sa.BigInteger(), nullable=False),
        sa.Column('channel_id', sa.BigInteger(), nullable=False),
        sa.Column('channel_name', sa.String(length=100), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tournament_id'], ['tournament.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tournament_id'),
        sa.UniqueConstraint('channel_id')
    )
    op.create_index(
        op.f('ix_tournament_discord_channel_channel_id'),
        'tournament_discord_channel',
        ['channel_id'],
        unique=False
    )


def downgrade() -> None:
    # Drop table
    op.drop_index(op.f('ix_tournament_discord_channel_channel_id'), table_name='tournament_discord_channel')
    op.drop_table('tournament_discord_channel')
```

## Примеры использования

### Добавление канала для турнира

```sql
-- Добавить Discord канал для турнира #5
INSERT INTO tournament_discord_channel 
(tournament_id, guild_id, channel_id, channel_name, is_active, created_at)
VALUES 
(5, 123456789012345678, 987654321098765432, 'winter-cup-logs', true, NOW());
```

### Отключение сбора логов

```sql
-- Отключить сбор логов для турнира
UPDATE tournament_discord_channel
SET is_active = false
WHERE tournament_id = 5;
```

### Изменение канала

```sql
-- Изменить канал для турнира
UPDATE tournament_discord_channel
SET channel_id = 111222333444555666,
    channel_name = 'new-logs-channel',
    updated_at = NOW()
WHERE tournament_id = 5;
```

### Просмотр активных каналов

```sql
-- Получить список активных каналов с информацией о турнирах
SELECT 
    tdc.channel_id,
    tdc.channel_name,
    t.id as tournament_id,
    t.number,
    t.name as tournament_name,
    t.is_finished,
    t.end_date
FROM tournament_discord_channel tdc
JOIN tournament t ON tdc.tournament_id = t.id
WHERE tdc.is_active = true
AND (
    t.is_finished = false 
    OR (t.is_finished = true AND t.end_date >= NOW() - INTERVAL '1 day')
)
ORDER BY t.number DESC;
```

## После миграции

1. Перезапустите Discord бота:
```bash
cd backend/discord
python main.py
```

2. Добавьте каналы для ваших турниров

3. Бот автоматически начнет мониторинг

## Проверка

```sql
-- Проверить что таблица создана
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'tournament_discord_channel';

-- Проверить структуру
\d tournament_discord_channel

-- Проверить индексы
SELECT indexname FROM pg_indexes WHERE tablename = 'tournament_discord_channel';
```

## Откат

Если нужно откатить миграцию:
```bash
alembic downgrade -1
```
