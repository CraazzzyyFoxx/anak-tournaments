# Discord OAuth и связывание игроков

## Обзор изменений

Добавлена функциональность:
1. **Discord OAuth авторизация** - вход через Discord
2. **Связывание Discord аккаунтов** - привязка Discord к существующему пользователю
3. **Связывание игровых профилей** - привязка игроков (User) к auth пользователям

## Новые модели

### AuthUserDiscord
Хранит связь между auth пользователем и Discord аккаунтом:
- `discord_id` - ID пользователя в Discord (уникальный)
- `discord_username`, `discord_discriminator` - имя пользователя
- `discord_avatar` - аватар
- `discord_email` - email из Discord
- `access_token`, `refresh_token` - OAuth токены (для будущих интеграций)
- `token_expires_at` - время истечения токена

### AuthUserPlayer
Связь между auth пользователем и игровым профилем:
- `auth_user_id` - ID пользователя в auth системе
- `player_id` - ID игрока (User) в системе
- `is_primary` - основной профиль (может быть только один)

### Изменения в AuthUser
- `hashed_password` теперь nullable (для OAuth пользователей)
- `avatar_url` - URL аватара пользователя
- Связи: `discord_accounts`, `player_links`

## API Endpoints

### Discord OAuth

#### GET `/auth/discord/url`
Получить URL для авторизации через Discord
```json
Response:
{
  "url": "https://discord.com/api/oauth2/authorize?...",
  "state": "random-state-token"
}
```

#### POST `/auth/discord/callback`
Обработка callback от Discord после авторизации
```json
Request:
{
  "code": "discord-auth-code",
  "state": "random-state-token"
}

Response:
{
  "access_token": "jwt-token",
  "refresh_token": "refresh-token",
  "token_type": "bearer"
}
```

#### POST `/auth/discord/link` 🔒
Привязать Discord к текущему пользователю (требуется авторизация)
```json
Request:
{
  "code": "discord-auth-code",
  "state": "random-state-token"
}

Response:
{
  "message": "Discord account linked successfully",
  "discord_username": "Username#1234"
}
```

#### DELETE `/auth/discord/unlink` 🔒
Отвязать Discord от текущего пользователя
- Требует наличия пароля (нельзя удалить единственный способ входа)

#### GET `/auth/discord/info` 🔒
Получить информацию о привязанном Discord аккаунте
```json
Response:
{
  "id": 123456789,
  "username": "Username",
  "discriminator": "1234",
  "avatar": "avatar-hash",
  "email": "user@example.com"
}
```

### Связывание игроков

#### POST `/auth/player/link` 🔒
Привязать игровой профиль к auth пользователю
```json
Request:
{
  "player_id": 42,
  "is_primary": true
}

Response:
{
  "message": "Player linked successfully",
  "player": {
    "player_id": 42,
    "player_name": "ProPlayer",
    "is_primary": true,
    "linked_at": "2025-12-08T10:00:00"
  }
}
```

#### DELETE `/auth/player/unlink/{player_id}` 🔒
Отвязать игровой профиль

#### GET `/auth/player/linked` 🔒
Получить список привязанных игроков
```json
Response:
[
  {
    "player_id": 42,
    "player_name": "ProPlayer",
    "is_primary": true,
    "linked_at": "2025-12-08T10:00:00"
  },
  {
    "player_id": 43,
    "player_name": "AltPlayer",
    "is_primary": false,
    "linked_at": "2025-12-08T11:00:00"
  }
]
```

#### PATCH `/auth/player/linked/{player_id}/primary` 🔒
Установить игрока как основной профиль

## Настройка Discord OAuth

### 1. Создайте Discord приложение

1. Перейдите на https://discord.com/developers/applications
2. Нажмите "New Application"
3. Дайте название приложению
4. Перейдите в раздел "OAuth2"

### 2. Настройте Redirect URI

В разделе OAuth2 → Redirects добавьте:
```
http://localhost:8001/auth/discord/callback
```

Для production:
```
https://yourdomain.com/auth/discord/callback
```

### 3. Получите credentials

Скопируйте:
- **Client ID**
- **Client Secret**

### 4. Настройте переменные окружения

В `.env` файле auth-service:
```bash
DISCORD_CLIENT_ID=your-client-id-here
DISCORD_CLIENT_SECRET=your-client-secret-here
DISCORD_REDIRECT_URI=http://localhost:8001/auth/discord/callback
```

### 5. Установите зависимости

```bash
pip install httpx
```

## Миграция базы данных

Создайте миграцию в main app:
```bash
cd backend/app
alembic revision --autogenerate -m "Add Discord OAuth and player linking"
alembic upgrade head
```

Это создаст таблицы:
- `auth_user_discord` - связи с Discord
- `auth_user_player` - связи с игроками
- Обновит `auth_user` (nullable password, avatar_url)

## Использование

### Frontend Flow - Discord OAuth Login

```typescript
// 1. Получить OAuth URL
const response = await fetch('http://localhost:8001/auth/discord/url');
const { url, state } = await response.json();

// 2. Сохранить state в localStorage
localStorage.setItem('discord_oauth_state', state);

// 3. Перенаправить пользователя
window.location.href = url;

// 4. После редиректа обратно, обработать callback
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');
const state = urlParams.get('state');
const savedState = localStorage.getItem('discord_oauth_state');

if (state !== savedState) {
  throw new Error('Invalid state');
}

// 5. Обменять code на токены
const tokenResponse = await fetch('http://localhost:8001/auth/discord/callback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, state })
});

const { access_token, refresh_token } = await tokenResponse.json();
// Сохранить токены и авторизовать пользователя
```

### Frontend Flow - Link Discord to Existing Account

```typescript
// Пользователь уже авторизован

// 1. Получить OAuth URL
const response = await fetch('http://localhost:8001/auth/discord/url');
const { url, state } = await response.json();

localStorage.setItem('discord_link_state', state);
window.location.href = url;

// 2. После редиректа - связать аккаунт
const code = urlParams.get('code');
const state = urlParams.get('state');

const linkResponse = await fetch('http://localhost:8001/auth/discord/link', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}` // Текущий токен
  },
  body: JSON.stringify({ code, state })
});

const result = await linkResponse.json();
console.log(result.message); // "Discord account linked successfully"
```

### Frontend Flow - Link Player Profile

```typescript
// Пользователь выбирает игрока из списка

const linkPlayer = async (playerId: number, isPrimary: boolean = true) => {
  const response = await fetch('http://localhost:8001/auth/player/link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      player_id: playerId,
      is_primary: isPrimary
    })
  });
  
  const result = await response.json();
  console.log(`Linked player: ${result.player.player_name}`);
};

// Получить привязанных игроков
const getLinkedPlayers = async () => {
  const response = await fetch('http://localhost:8001/auth/player/linked', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  return await response.json();
};
```

## Безопасность

### State Parameter
OAuth state защищает от CSRF атак:
- Генерируется случайный токен
- Сохраняется на клиенте
- Проверяется при callback

### OAuth Users без пароля
- Пользователи через Discord могут не иметь пароля
- Нельзя удалить Discord если нет пароля
- Нужно сначала установить пароль через отдельный endpoint

### Уникальность Discord ID
- Discord ID уникален в системе
- Один Discord аккаунт = один auth пользователь
- Привязка к другому аккаунту заблокирована

### Уникальность Player
- Один игровой профиль может быть привязан только к одному auth пользователю
- Это предотвращает дублирование и мошенничество

## Use Cases

### 1. Новый пользователь через Discord
1. Пользователь нажимает "Login with Discord"
2. Авторизуется в Discord
3. Автоматически создается auth пользователь
4. Пользователь может привязать игровой профиль

### 2. Существующий пользователь добавляет Discord
1. Пользователь входит по email/password
2. Переходит в настройки
3. Нажимает "Link Discord"
4. Авторизуется в Discord
5. Discord привязывается к аккаунту

### 3. Привязка игрового профиля
1. Пользователь видит список своих игровых профилей
2. Выбирает профиль для привязки
3. Профиль связывается с auth аккаунтом
4. Может установить один профиль как основной

### 4. Смена основного профиля
1. У пользователя несколько игровых профилей
2. Может переключить основной профиль
3. Основной профиль используется по умолчанию

## Troubleshooting

### "Discord service unavailable"
- Проверьте интернет соединение
- Убедитесь что Discord API доступен
- Проверьте таймауты в коде (по умолчанию 10 секунд)

### "Invalid state"
- State был изменен или истек
- Проверьте localStorage
- Начните OAuth flow заново

### "Discord account already linked"
- Discord уже привязан к другому пользователю
- Отвяжите от старого аккаунта сначала

### "Player already linked"
- Игрок уже привязан к другому auth пользователю
- Нужно отвязать от старого аккаунта

### "Cannot unlink Discord - set a password first"
- OAuth пользователь пытается удалить единственный способ входа
- Установите пароль через отдельный endpoint сначала

## Roadmap

- [ ] Endpoint для установки пароля OAuth пользователям
- [ ] Refresh Discord OAuth tokens автоматически
- [ ] Discord bot интеграция для уведомлений
- [ ] Автоматическая привязка по Discord username/discriminator
- [ ] Twitch OAuth (аналогично Discord)
- [ ] Battle.net OAuth
- [ ] Steam OAuth
- [ ] Multi-factor authentication (2FA)
