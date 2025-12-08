# Discord Log Collection Bot

Discord бот для автоматического сбора логов матчей из каналов Discord в реальном времени.

## Возможности

- 🔄 **Автоматический мониторинг** - отслеживает указанные каналы в реальном времени
- 📊 **Привязка к турнирам** - каждый канал связан с конкретным турниром в БД
- ⏰ **Умное завершение** - прекращает сбор через 1 день после окончания турнира
- ✅ **Реакции на сообщения** - показывает статус обработки файлов
- 📥 **Автозагрузка** - скачивает и отправляет логи в parser service
- 🔁 **Обработка истории** - при запуске обрабатывает последние 50 сообщений
- 🔄 **Динамическая перезагрузка** - обновляет список каналов каждые 5 минут

## Как работает

1. Бот подключается к Discord и базе данных
2. Загружает список активных турниров и их каналов из таблицы `tournament_discord_channel`
3. Мониторит каждый активный канал:
   - Турниры с `is_finished = false`
   - Турниры завершенные менее 1 дня назад
4. При новом сообщении с вложением:
   - Скачивает файл
   - Отправляет в parser service
   - Добавляет реакцию ✅ (успех) или ❌ (ошибка)

## Установка

### 1. Установите зависимости

```bash
cd backend/discord
pip install -e .
```

### 2. Настройте переменные окружения

Скопируйте `.env.example` в `.env`:
```bash
cp .env.example .env
```

Заполните переменные:
```bash
# Discord Bot Token
DISCORD_TOKEN=your-bot-token-here

# Parser Service URL
PARSER_URL=http://localhost:8002
ACCESS_TOKEN_SERVICE=your-service-token

# Database (shared with main app)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=anak_tournaments
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

### 3. Создайте Discord бота

1. Перейдите на https://discord.com/developers/applications
2. Нажмите "New Application"
3. В разделе "Bot":
   - Нажмите "Add Bot"
   - Скопируйте токен
   - Включите **Message Content Intent**
   - Включите **Server Members Intent**
4. В разделе "OAuth2" → "URL Generator":
   - Выберите scope: `bot`
   - Выберите permissions:
     - Read Messages/View Channels
     - Send Messages
     - Read Message History
     - Add Reactions
   - Скопируйте ссылку и добавьте бота на сервер

## Использование

### Запуск бота

```bash
python main.py
```

### Настройка каналов для турниров

Добавьте запись в таблицу `tournament_discord_channel`:

```sql
INSERT INTO tournament_discord_channel 
(tournament_id, guild_id, channel_id, channel_name, is_active, created_at)
VALUES 
(1, 123456789012345678, 987654321098765432, 'tournament-logs', true, NOW());
```

Или через API (если создан endpoint):
```bash
curl -X POST "http://localhost:8000/api/tournaments/1/discord-channel" \
  -H "Content-Type: application/json" \
  -d '{
    "guild_id": 123456789012345678,
    "channel_id": 987654321098765432,
    "channel_name": "tournament-logs"
  }'
```

### Получение ID канала в Discord

1. Включите режим разработчика в Discord:
   - User Settings → Advanced → Developer Mode
2. ПКМ на канале → Copy ID

## Модель данных

### TournamentDiscordChannel

```python
class TournamentDiscordChannel(Base):
    tournament_id: int         # ID турнира
    guild_id: int             # ID Discord сервера
    channel_id: int           # ID канала (уникальный)
    channel_name: str | None  # Название канала (опционально)
    is_active: bool           # Активен ли сбор логов
```

## Логика завершения сбора

Бот прекращает мониторинг канала когда:
1. `is_active = false` в `tournament_discord_channel`
2. ИЛИ `tournament.is_finished = true` И прошло более 1 дня с `tournament.end_date`

Это дает игрокам время скинуть логи даже после официального завершения турнира.

## Обработка файлов

Бот обрабатывает только файлы с расширениями:
- `.txt`
- `.log`
- `.json`

Остальные файлы игнорируются.

### Процесс обработки

1. **Скачивание**: Бот скачивает файл из Discord
2. **Загрузка**: POST `{PARSER_URL}/logs/{tournament_id}/upload`
3. **Обработка**: POST `{PARSER_URL}/logs/{tournament_id}/{filename}`
4. **Реакция**: ✅ если все ОК, ❌ если ошибка

## Логирование

Все события логируются через Loguru:

```
2025-12-08 10:00:00 | INFO | 🚀 Starting Discord Log Collection Bot...
2025-12-08 10:00:01 | SUCCESS | ✅ Bot started as LogBot#1234
2025-12-08 10:00:01 | INFO | 📡 Connected to 3 guilds
2025-12-08 10:00:02 | INFO | 📌 Monitoring channel 987654321098765432 for tournament #5 - Winter Cup
2025-12-08 10:00:02 | SUCCESS | ✅ Loaded 2 active channels
2025-12-08 10:05:00 | INFO | 📨 New message in monitored channel from Player#1234 with 2 attachment(s)
2025-12-08 10:05:01 | INFO | 📥 Downloading match_log_1.txt for tournament 5
2025-12-08 10:05:02 | SUCCESS | ✅ match_log_1.txt uploaded
2025-12-08 10:05:03 | SUCCESS | ✅ match_log_1.txt processed successfully
```

## Архитектура

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Discord   │────▶│  Discord Bot │────▶│    Parser    │
│  Channels   │     │              │     │   Service    │
└─────────────┘     └──────┬───────┘     └──────────────┘
                           │
                           │ reads config
                           ▼
                    ┌──────────────┐
                    │  PostgreSQL  │
                    │              │
                    │ - tournaments│
                    │ - channels   │
                    └──────────────┘
```

## Мониторинг

### Background Task

Бот запускает фоновую задачу, которая:
- Перезагружает список активных каналов каждые 5 минут
- Автоматически начинает/прекращает мониторинг при изменении конфигурации

### События Discord

Бот реагирует на:
- `on_message` - новые сообщения
- `on_message_edit` - редактирование (если добавлены файлы)
- `on_guild_join` - добавление на новый сервер
- `on_guild_remove` - удаление с сервера

## Troubleshooting

### "Bot does not have permission"
- Проверьте что бот имеет права:
  - Read Messages/View Channels
  - Send Messages
  - Add Reactions
- Проверьте права канала (Channel Permissions)

### "Channel not found"
- Убедитесь что бот добавлен на сервер
- Проверьте что `channel_id` правильный
- Проверьте что бот видит канал

### "Parser service unavailable"
- Проверьте что parser service запущен
- Проверьте `PARSER_URL` в `.env`
- Проверьте `ACCESS_TOKEN_SERVICE`

### Каналы не загружаются
- Проверьте подключение к БД
- Убедитесь что таблица `tournament_discord_channel` существует
- Проверьте что `is_active = true`
- Проверьте что турнир не завершен или завершен менее 1 дня назад

## Миграция БД

Создайте миграцию для новой таблицы:

```bash
cd backend/app
alembic revision --autogenerate -m "Add tournament discord channel"
alembic upgrade head
```

Или создайте вручную:

```sql
CREATE TABLE tournament_discord_channel (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
    guild_id BIGINT NOT NULL,
    channel_id BIGINT NOT NULL UNIQUE,
    channel_name VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT tournament_discord_channel_tournament_id_key UNIQUE (tournament_id)
);

CREATE INDEX ix_tournament_discord_channel_channel_id ON tournament_discord_channel(channel_id);
```

## Production

### Docker

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install -e .

COPY . .

CMD ["python", "main.py"]
```

### Systemd Service

```ini
[Unit]
Description=Discord Log Collection Bot
After=network.target postgresql.service

[Service]
Type=simple
User=discord-bot
WorkingDirectory=/opt/discord-bot
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/discord-bot/venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Roadmap

- [ ] Web dashboard для управления каналами
- [ ] Статистика обработанных файлов
- [ ] Retry логика для failed uploads
- [ ] Queue для обработки множества файлов
- [ ] Notifications в Discord при ошибках
- [ ] Support для других типов файлов (zip, rar)
- [ ] Database persistence для failed uploads
