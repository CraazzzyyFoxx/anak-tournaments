# Authentication Service

Микросервис для аутентификации и авторизации пользователей.

## Функциональность

- 🔐 Регистрация пользователей с валидацией
- 🔑 Аутентификация по email и паролю
- 🎫 JWT токены (access + refresh)
- 🔄 Обновление токенов (refresh)
- 👤 Получение и обновление профиля пользователя
- 🚪 Выход (logout) из одной или всех сессий
- ✅ Валидация токенов для других микросервисов
- 🎮 **Discord OAuth** - вход через Discord
- 🔗 **Связывание Discord** - привязка Discord к существующему аккаунту
- 👥 **Связывание игроков** - привязка игровых профилей к auth пользователю

## Технологии

- **FastAPI** - веб-фреймворк
- **SQLAlchemy 2.0+** - ORM с async поддержкой
- **PostgreSQL** - база данных (общая с основным приложением)
- **JWT** (python-jose) - токены аутентификации
- **Bcrypt** (passlib) - хеширование паролей
- **Pydantic** - валидация данных
- **Loguru** - логирование
- **HTTPX** - HTTP клиент для Discord API

## Структура проекта

```
auth-service/
├── main.py              # Точка входа
├── pyproject.toml       # Зависимости
├── Dockerfile           # Docker образ
├── docker-compose.yml   # Docker композиция
├── .env.example         # Пример переменных окружения
└── src/
    ├── core/            # Основная конфигурация
    │   ├── config.py    # Настройки приложения
    │   ├── db.py        # База данных
    │   └── logging.py   # Логирование
    ├── models.py        # Импорт моделей из shared
    ├── schemas/         # Pydantic схемы
    │   └── auth.py
    ├── services/        # Бизнес-логика
    │   └── auth_service.py
    └── routes/          # API endpoints
        ├── auth.py      # Аутентификация
        └── health.py    # Health checks
```

## Установка и запуск

### Локальный запуск

1. Создайте виртуальное окружение:
```bash
python -m venv venv
venv\Scripts\activate  # Windows
source venv/bin/activate  # Linux/Mac
```

2. Установите зависимости:
```bash
pip install -e .
```

3. Скопируйте `.env.example` в `.env` и настройте переменные:
```bash
cp .env.example .env
```

4. Запустите сервис:
```bash
python main.py
```

Сервис будет доступен на `http://localhost:8001`

### Docker запуск

1. Создайте `.env` файл с необходимыми переменными

2. Запустите через docker-compose:
```bash
docker-compose up -d
```

3. Проверьте health check:
```bash
curl http://localhost:8001/health
```

## API Endpoints

### Основные endpoints

- `GET /` - Информация о сервисе
- `GET /health` - Health check
- `GET /docs` - Swagger документация
- `GET /redoc` - ReDoc документация

### Аутентификация

- `POST /register` - Регистрация нового пользователя
- `POST /login` - Вход (получение токенов)
- `POST /refresh` - Обновление access токена
- `POST /logout` - Выход (отзыв токена)
- `POST /logout-all` - Выход со всех устройств
- `POST /set-password` 🔒 - Установить/сменить пароль
- `GET /me` - Получить текущего пользователя
- `PATCH /me` - Обновить профиль
- `POST /validate` - Валидировать токен (для других сервисов)

### OAuth (Discord)

- `GET /oauth/discord/url` - Получить URL для авторизации Discord
- `GET /oauth/discord/callback` - Обработка callback от Discord (GET версия)
- `POST /oauth/discord/callback` - Обработка callback от Discord (POST версия)
- `POST /oauth/discord/link` 🔒 - Привязать Discord к аккаунту
- `DELETE /oauth/discord/unlink` 🔒 - Отвязать Discord
- `GET /oauth/connections` 🔒 - Все OAuth-связки аккаунта

### Связывание игроков

- `POST /player/link` 🔒 - Привязать игрового персонажа
- `DELETE /player/unlink/{player_id}` 🔒 - Отвязать игрока
- `GET /player/linked` 🔒 - Список привязанных игроков
- `PATCH /player/linked/{player_id}/primary` 🔒 - Установить основного игрока

🔒 - требуется авторизация

## Примеры использования

### Регистрация
```bash
curl -X POST "http://localhost:8001/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "testuser",
    "password": "Password123",
    "first_name": "John",
    "last_name": "Doe"
  }'
```

### Вход
```bash
curl -X POST "http://localhost:8001/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "Password123"
  }'
```

Ответ:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "a1b2c3...",
  "token_type": "bearer"
}
```

### Использование токена
```bash
curl -X GET "http://localhost:8001/me" \
  -H "Authorization: Bearer eyJ..."
```

### Обновление токена
```bash
curl -X POST "http://localhost:8001/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "a1b2c3..."
  }'
```

## Интеграция с другими сервисами

Другие микросервисы могут валидировать токены через endpoint `/validate`:

```python
import httpx

async def validate_token(token: str):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://auth-service:8001/validate",
            headers={"Authorization": f"Bearer {token}"}
        )
        if response.status_code == 200:
            return response.json()  # TokenPayload
        return None
```

## Конфигурация

Основные переменные окружения (см. `.env.example`):

```bash
# Application
ENVIRONMENT=development
DEBUG=True
HOST=0.0.0.0
PORT=8001

# Database (shared with main app)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=tournaments

# JWT
JWT_SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000
```

## База данных

Сервис использует **общую базу данных** с основным приложением:
- Таблицы создаются через Alembic миграции в главном приложении
- Auth-service подключается к существующим таблицам `auth_users` и `refresh_tokens`
- Не требуется отдельных миграций для auth-service

## Разработка

### Логирование

Логи выводятся через Loguru с цветным форматированием:
```
2024-01-15 12:00:00.000 | INFO     | Starting Authentication Service...
2024-01-15 12:00:01.000 | SUCCESS  | Database connection established
2024-01-15 12:00:02.000 | INFO     | Registering new user: user@example.com
```

### Безопасность

- ✅ Пароли хешируются с помощью bcrypt
- ✅ JWT токены подписываются секретным ключом
- ✅ Refresh токены хранятся в базе данных
- ✅ Поддержка отзыва токенов
- ✅ Валидация сложности паролей
- ✅ CORS middleware для защиты от XSS

## Архитектура

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client    │────▶│ Auth Service │────▶│  PostgreSQL  │
│ (Frontend)  │     │   (Port 8001)│     │  (Shared DB) │
└─────────────┘     └──────────────┘     └──────────────┘
                            │                     ▲
                            │                     │
                            ▼                     │
                    ┌──────────────┐             │
                    │  Main App    │─────────────┘
                    │ (Port 8000)  │
                    └──────────────┘
```

## Мониторинг

Health check endpoint доступен для мониторинга:
```bash
curl http://localhost:8001/health
```

Ответ:
```json
{
  "status": "healthy",
  "service": "auth-service"
}
```

## Лицензия

MIT
