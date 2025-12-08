# Микросервисная архитектура

## Обзор

Приложение разделено на несколько микросервисов для улучшения масштабируемости, независимости развертывания и разделения ответственности.

## Сервисы

### 1. Main App (порт 8000)
**Расположение:** `backend/app/`

Основное приложение турниров, включает:
- Управление турнирами
- Управление командами
- Матчи и encounter
- Аналитика и статистика
- Достижения
- Игровые режимы, герои, карты

**База данных:** PostgreSQL (общая с auth-service)

### 2. Auth Service (порт 8001)
**Расположение:** `backend/auth-service/`

Микросервис аутентификации и авторизации:
- Регистрация пользователей
- Вход/выход
- JWT токены (access + refresh)
- Управление refresh токенами
- Валидация токенов для других сервисов

**База данных:** PostgreSQL (общая с main app)

### 3. Parser (standalone)
**Расположение:** `backend/parser/`

Парсер для сбора данных из внешних источников:
- Сбор информации о матчах
- Обработка статистики игроков
- Импорт данных турниров

**База данных:** PostgreSQL (общая)

### 4. Discord Bot (standalone)
**Расположение:** `backend/discord/`

Discord бот для интеграции с Discord:
- Уведомления о матчах
- Команды для взаимодействия
- Интеграция с турнирами

### 5. Twitch Integration (standalone)
**Расположение:** `backend/twitch/`

Интеграция с Twitch:
- Стриминг уведомления
- Twitch события

## Shared Library

**Расположение:** `backend/shared/`

Общая библиотека для всех сервисов:
- **Models:** Все модели базы данных (SQLAlchemy)
- **Core:** Базовые классы и утилиты
- **Enums:** Общие перечисления

Все сервисы импортируют модели из shared:
```python
from shared.models import AuthUser, Tournament, Team
from shared.core.db import Base, TimeStampUUIDMixin
```

## Взаимодействие сервисов

### Общая база данных

Все сервисы используют **одну базу данных PostgreSQL**:
- Миграции выполняются в main app (Alembic)
- Остальные сервисы подключаются к существующим таблицам
- Shared модели обеспечивают единую схему

### HTTP взаимодействие

#### Main App → Auth Service

Main app может вызывать auth-service для валидации токенов:

```python
from src.clients.auth_client import auth_client

# Validate token
user_payload = await auth_client.validate_token(token)
```

Альтернативно, main app может валидировать JWT локально (рекомендуется):
- Использует тот же JWT_SECRET_KEY
- Декодирует токен без обращения к auth-service
- Обращается к auth-service только для операций с пользователями

## Архитектурная диаграмма

```
┌──────────────┐
│   Frontend   │
│  (React/Vue) │
└──────┬───────┘
       │
       │ HTTP/REST
       │
   ┌───▼────────────────────────────────┐
   │         API Gateway / Nginx        │
   └───┬────────────────────────────┬───┘
       │                            │
       │ /api/...                   │ /auth/...
       │                            │
┌──────▼──────────┐         ┌───────▼────────────┐
│   Main App      │         │   Auth Service     │
│   (Port 8000)   │         │   (Port 8001)      │
│                 │         │                    │
│ - Tournaments   │         │ - Registration     │
│ - Teams         │         │ - Login/Logout     │
│ - Matches       │         │ - JWT Tokens       │
│ - Analytics     │         │ - Token Validation │
│ - Achievements  │         │                    │
└────────┬────────┘         └─────────┬──────────┘
         │                            │
         └────────────┬───────────────┘
                      │
              ┌───────▼──────────┐
              │   PostgreSQL     │
              │  (Shared DB)     │
              │                  │
              │ - auth_users     │
              │ - refresh_tokens │
              │ - tournaments    │
              │ - teams          │
              │ - matches        │
              │ - ...            │
              └──────────────────┘
```

## Deployment

### Docker Compose (Development)

Каждый сервис имеет свой `docker-compose.yml`:

```bash
# Start auth service
cd backend/auth-service
docker-compose up -d

# Start main app
cd backend/app
docker-compose up -d
```

### Production

Рекомендуется использовать Kubernetes или Docker Swarm:
- Каждый сервис как отдельный deployment
- Shared volumes для shared library
- Service mesh для communication
- Centralized logging (ELK/Loki)
- API Gateway (Kong/Nginx)

## Конфигурация

### Environment Variables

Все сервисы используют `.env` файлы:

**Общие переменные:**
```bash
# Database (одинаковые для всех)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=anak_tournaments
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# JWT (одинаковые для app и auth-service)
JWT_SECRET_KEY=your-secret-key
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30
```

**Auth Service:**
```bash
PORT=8001
PROJECT_NAME=Authentication Service
```

**Main App:**
```bash
PORT=8000
PROJECT_NAME=Anak Tournaments API
AUTH_SERVICE_URL=http://localhost:8001
```

## Миграции базы данных

Все миграции выполняются в **main app**:

```bash
cd backend/app
alembic revision --autogenerate -m "Add new table"
alembic upgrade head
```

Другие сервисы просто подключаются к обновленной схеме.

## Разработка

### Добавление нового микросервиса

1. Создайте директорию в `backend/`
2. Создайте структуру проекта (src/, main.py, pyproject.toml)
3. Импортируйте модели из `shared`
4. Настройте подключение к shared DB
5. Добавьте в docker-compose
6. Документируйте API endpoints

### Изменение моделей

1. Обновите модель в `backend/shared/models/`
2. Создайте миграцию в main app
3. Примените миграцию
4. Перезапустите все сервисы

## Мониторинг и логирование

Каждый сервис:
- Использует Loguru для структурированного логирования
- Имеет `/health` endpoint для health checks
- Экспортирует метрики (Prometheus format)

## Security

### JWT Tokens
- Access token: короткий срок жизни (30 минут)
- Refresh token: длинный срок жизни (30 дней)
- Refresh токены хранятся в БД и могут быть отозваны

### CORS
- Настраивается в каждом сервисе
- Ограничение allowed origins

### API Gateway
В production рекомендуется использовать API Gateway:
- Rate limiting
- Authentication middleware
- Request/response transformation
- Load balancing

## Масштабирование

### Горизонтальное масштабирование

Каждый сервис может быть масштабирован независимо:

```yaml
# docker-compose scale
docker-compose up -d --scale auth-service=3
docker-compose up -d --scale app=2
```

### Кэширование

Рекомендуется добавить Redis для:
- Кэширование JWT токенов
- Кэширование частых запросов
- Rate limiting
- Session storage

### Message Queue

Для асинхронных задач рекомендуется:
- RabbitMQ или Kafka
- Celery для background tasks

## Преимущества архитектуры

✅ **Независимость развертывания** - можно обновлять сервисы независимо

✅ **Масштабируемость** - горизонтальное масштабирование каждого сервиса

✅ **Изоляция отказов** - проблема в одном сервисе не влияет на другие

✅ **Разделение ответственности** - каждый сервис отвечает за свою область

✅ **Переиспользование кода** - shared library избегает дублирования

✅ **Гибкость технологий** - можно использовать разные технологии в разных сервисах

## Недостатки и решения

❌ **Сложность** - больше движущихся частей
→ Решение: Docker Compose для локальной разработки, хорошая документация

❌ **Distributed transactions** - транзакции через сервисы сложнее
→ Решение: Shared database + event sourcing для критичных операций

❌ **Латентность** - межсервисное взаимодействие добавляет задержку
→ Решение: JWT валидация локально, кэширование

❌ **Debugging** - сложнее отследить запрос через сервисы
→ Решение: Distributed tracing (Jaeger), correlation IDs

## Roadmap

- [ ] API Gateway (Kong/Nginx)
- [ ] Redis для кэширования
- [ ] Distributed tracing (Jaeger)
- [ ] Centralized logging (ELK)
- [ ] Kubernetes deployment
- [ ] CI/CD pipelines
- [ ] Message queue (RabbitMQ)
- [ ] Service mesh (Istio)
