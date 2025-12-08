# Authentication System Migration Guide

## Обзор

Новая система аутентификации заменяет Clerk на собственное JWT-based решение.

## Миграция базы данных

### Создание миграции

```bash
# Из директории app/
cd app
alembic revision -m "Add auth user and refresh token tables"
```

### Добавьте в миграцию:

```python
from alembic import op
import sqlalchemy as sa

def upgrade():
    # Создание таблицы auth_user
    op.create_table(
        'auth_user',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('username', sa.String(100), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_superuser', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_verified', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('first_name', sa.String(100), nullable=True),
        sa.Column('last_name', sa.String(100), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_auth_user_email'), 'auth_user', ['email'], unique=True)
    op.create_index(op.f('ix_auth_user_username'), 'auth_user', ['username'], unique=True)

    # Создание таблицы refresh_token
    op.create_table(
        'refresh_token',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('token', sa.Text(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_revoked', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('user_agent', sa.String(500), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['auth_user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_refresh_token_token'), 'refresh_token', ['token'], unique=True)


def downgrade():
    op.drop_index(op.f('ix_refresh_token_token'), table_name='refresh_token')
    op.drop_table('refresh_token')
    op.drop_index(op.f('ix_auth_user_username'), table_name='auth_user')
    op.drop_index(op.f('ix_auth_user_email'), table_name='auth_user')
    op.drop_table('auth_user')
```

### Применение миграции

```bash
alembic upgrade head
```

## Настройка переменных окружения

Добавьте в `.env`:

```env
# JWT Authentication
JWT_SECRET_KEY=your-super-secret-key-min-32-chars-long-change-this
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=30

# Старые Clerk настройки можно оставить пустыми или удалить
CLERK_SECRET_KEY=
CLERK_JWKS_URL=
CLERK_ISSUER=
```

## API Endpoints

### Регистрация

```
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "username",
  "password": "Password123",
  "first_name": "John",
  "last_name": "Doe"
}
```

### Логин

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password123"
}

Response:
{
  "access_token": "eyJ...",
  "refresh_token": "abc...",
  "token_type": "bearer"
}
```

### Обновление токена

```
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refresh_token": "abc..."
}
```

### Получение информации о текущем пользователе

```
GET /api/v1/auth/me
Authorization: Bearer {access_token}
```

### Выход

```
POST /api/v1/auth/logout
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "refresh_token": "abc..."
}
```

### Выход со всех устройств

```
POST /api/v1/auth/logout-all
Authorization: Bearer {access_token}
```

## Использование в коде

### Защита эндпоинтов

```python
from src.core import auth
from src import models

@router.get("/protected")
async def protected_route(
    current_user: models.AuthUser = Depends(auth.get_current_active_user)
):
    return {"user_id": current_user.id, "email": current_user.email}
```

### Требование прав суперпользователя

```python
@router.post("/admin-only")
async def admin_route(
    current_user: models.AuthUser = Depends(auth.get_current_superuser)
):
    return {"message": "Admin access granted"}
```

## Создание первого суперпользователя

После применения миграций, создайте первого суперпользователя через скрипт:

```python
import asyncio
from sqlalchemy import select
from src.core import db, auth
from src import models

async def create_superuser():
    async with db.async_session_maker() as session:
        # Проверить, существует ли уже
        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.email == "admin@example.com")
        )
        if result.scalar_one_or_none():
            print("Superuser already exists")
            return

        # Создать
        user = models.AuthUser(
            email="admin@example.com",
            username="admin",
            hashed_password=auth.AuthService.get_password_hash("ChangeMe123"),
            is_active=True,
            is_superuser=True,
            is_verified=True,
        )
        session.add(user)
        await session.commit()
        print(f"Superuser created: {user.email}")

if __name__ == "__main__":
    asyncio.run(create_superuser())
```

## Безопасность

1. **JWT Secret Key**: Используйте длинный случайный ключ (минимум 32 символа)
2. **HTTPS**: В production обязательно используйте HTTPS
3. **Refresh Token Rotation**: Refresh токены автоматически обновляются при использовании
4. **Token Expiration**: Access токены действуют 30 минут, refresh - 30 дней
5. **Password Policy**: Пароль должен содержать заглавные, строчные буквы и цифры

## Преимущества перед Clerk

- ✅ Полный контроль над пользовательскими данными
- ✅ Отсутствие зависимости от внешнего сервиса
- ✅ Бесплатно
- ✅ Кастомизация логики аутентификации
- ✅ Работает offline
- ✅ Храним данные в нашей БД
