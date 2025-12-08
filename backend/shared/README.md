# Shared Library

Эта библиотека содержит общие модели базы данных и основные компоненты для использования в приложениях `app` и `parser`.

## Структура

```
shared/
├── __init__.py
├── core/
│   ├── __init__.py
│   ├── db.py      # Базовые классы для работы с БД (Base, TimeStampIntegerMixin, TimeStampUUIDMixin)
│   └── enums.py   # Общие перечисления (HeroClass, LogEventType, LogStatsName, EncounterStatus, MatchEvent, AbilityEvent)
└── models/
    ├── __init__.py
    ├── achievement.py
    ├── analytics.py
    ├── encounter.py
    ├── gamemode.py
    ├── hero.py
    ├── map.py
    ├── match.py
    ├── standings.py
    ├── team.py
    ├── tournament.py
    └── user.py
```

## Использование

### В приложении app

Модели автоматически импортируются через `app/src/models/__init__.py`:

```python
from src import models

# Использование моделей
user = models.User(name="example")
tournament = models.Tournament(name="Tournament #1")
```

Базовые классы и перечисления импортируются через `app/src/core`:

```python
from src.core import db, enums

# db.Base, db.TimeStampIntegerMixin уже импортированы из shared
# enums.HeroClass, enums.LogEventType и другие уже импортированы из shared
```

### В приложении parser

Аналогично app, модели автоматически импортируются через `parser/src/models/__init__.py`:

```python
from src import models

# Использование моделей
match = models.Match(...)
encounter = models.Encounter(...)
```

## Важно

- **НЕ изменяйте** файлы в `app/src/models/` и `parser/src/models/` напрямую - они являются прокси для `shared/models/`
- Все изменения моделей БД должны вноситься в `shared/models/`
- Общие перечисления должны находиться в `shared/core/enums.py`
- Специфичные для приложения перечисления (например, `RouteTag`) остаются в соответствующих `app/src/core/enums.py` или `parser/src/core/enums.py`

## Преимущества

1. **Единственный источник истины** - модели определены в одном месте
2. **Консистентность** - app и parser используют одни и те же определения моделей
3. **Упрощение поддержки** - изменения в моделях вносятся только в shared
4. **Переиспользование кода** - общая логика доступна обоим приложениям
