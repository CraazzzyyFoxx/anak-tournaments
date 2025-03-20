# Anak`s Tournaments Statistics

![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/CraazzzyyFoxx/1362ebafcd51d3f65dae7935b1d322eb/raw/pytest.json)
[![Issues](https://img.shields.io/github/issues/CraazzzyyFoxx/anak-tournaments)](https://github.com/CraazzzyyFoxx/anak-tournaments)
[![Documentation](https://img.shields.io/badge/documentation-yes-brightgreen.svg)](https://aqt.craazzzyyfoxx.me/api/redoc)
[![License: MIT](https://img.shields.io/github/license/CraazzzyyFoxx/anak-tournaments)](https://github.com/CraazzzyyFoxx/anak-tournaments/blob/master/LICENSE)

> AQT provides comprehensive statistics about Anakq's sub-tournaments.
> This includes the history of past tournaments, player statistics such as tournaments participated in, divisions, teams, heroes, and performance metrics.
> Built with FastAPI, Next.js, and using Traefik as a reverse proxy and Redis for caching and queuing.
> The project is optimized for fast and accurate data delivery, minimizing server load.

## Table of contents

* [✨ Live instance](#-live-instance)
* [🐋 Run for production](#-run-for-production)
* [💽 Run as developer](#-run-as-developer)
* [👨‍💻 Technical details](#-technical-details)
* [🙏 Credits](#-credits)
* [📝 License](#-license)

## ✨ [Live instance](https://aqt.craazzzyyfoxx.me/)

**Backend**
> The backend is built with FastAPI and provides the core API functionality, including data retrieval, caching, and processing.
> You can explore the backend API documentation using the following links:
>
>Redoc Documentation: https://aqt.craazzzyyfoxx.me/api/v1/redoc
>Swagger UI: https://aqt.craazzzyyfoxx.me/api/v1/docs

**Frontend**
> The frontend is built with Next.js and provides a user-friendly interface for interacting with the AQT API.
> It displays tournament history, player statistics, and other relevant data in an intuitive and visually appealing way.
>You can access the live frontend instance here:
>
> Frontend Live Instance: https://aqt.craazzzyyfoxx.me

### Pre-commit

The project is using [pre-commit](https://pre-commit.com/) framework to ensure code quality before making any commit on the repository. After installing the project dependencies, you can install the pre-commit by using the `pre-commit install` command.

The configuration can be found in the `.pre-commit-config.yaml` file. It consists in launching 2 processes on modified files before making any commit :

- `ruff` for linting and code formatting (with `ruff format`)
- `sourcery` for more code quality checks and a lot of simplifications

## 👨‍💻 Technical details

### Technology Stack and Features

- ⚡ [**FastAPI**](https://fastapi.tiangolo.com) for the Python backend API.
    - 🧰 [SqlAlchemy](https://www.sqlalchemy.org/) for the Python SQL database interactions (ORM).
    - 🔍 [Pydantic](https://docs.pydantic.dev), used by FastAPI, for the data validation and settings management.
    - 💾 [PostgreSQL](https://www.postgresql.org) as the SQL database.
- 🚀 [**Next.js**](https://nextjs.org/) for the frontend.
    - 💃 Using TypeScript, hooks, and other parts of a modern frontend stack.
    - 🎨 [Shadcn/UI](https://ui.shadcn.com/) for the frontend components.
    - 🧪 [Playwright](https://playwright.dev) for End-to-End testing.
- 🐋 [Docker Compose](https://www.docker.com) for development and production.
- ✅ Tests with [Pytest](https://pytest.org).
- 🏭 CI/CD based on GitHub Actions.

### Computed statistics values

In statistics, various conversions are applied for ease of use:

- **Duration values** are converted to **seconds** (integer)
- **Percent values** are represented as **float**

### Redis caching

AQT API integrates a Redis-based cache system, divided into three main components:

API Cache: This high-level cache associates URIs (cache keys) with Pickle data.

Function Cache: This cache stores the results of specific functions, such as the hero statistics. The cache key is generated based on the function name and its arguments. This cache is used to store computed values that are expensive to calculate.

* Heroes: 1 day
* Maps: 1 day
* Gamemodes: 1 day
* Tournaments: 1 day
* Players: 1 hour
* Teams: 1 day
* Statistics: 1 day
* Matches: 1 day
* Achievements: 1 day

## Backend Development

Backend docs: [backend/README.md](./backend/README.md).

## Frontend Development

Frontend docs: [frontend/README.md](./frontend/README.md).

## 🙏 Credits

All data provided by the API is owned by Anakq and their community.

- Overwatch API : [Overfast API](https://github.com/TeKrop/overfast-api)
- Anakq : [Anakq Twitch](https://www.twitch.tv/anakq)
- Special thanks for the idea and historical data [dashabreeze](https://aqt.vercel.app/players)

## 📝 License

Copyright © 2024-2025 [CraazzzyyFoxx](https://github.com/CraazzzyyFoxx).

This project is [MIT](https://github.com/CraazzzyyFoxx/anak-tournaments/blob/master/LICENSE) licensed.
