# FastAPI Project - Backend

## Requirements

* [Docker](https://www.docker.com/).
* [uv](https://docs.astral.sh/uv/) for Python package and environment management.

## General Workflow

By default, the dependencies are managed with [uv](https://docs.astral.sh/uv/), go there and install it.

From `./backend/` you can install all the dependencies with:

```console
$ uv sync
```

Then you can activate the virtual environment with:

```console
$ source .venv/bin/activate
```

Make sure your editor is using the correct Python virtual environment, with the interpreter at `backend/.venv/bin/python`.

Modify or add SqlAlchemy models for data and SQL tables in `./backend/app/src/models.py`, API endpoints in `./backend/app/src/services/*/views.py`.


## Docker Compose (dev profiles)

`docker-compose.override.yml` is no longer used.

Development behavior now lives directly in `docker-compose.yml`:

- source folders are bind-mounted for live reload,
- backend services run with `uvicorn --reload`,
- local PostgreSQL is included by default,
- optional components use Compose profiles.

### Start core dev stack

```console
$ docker compose up -d --wait
```

### Start full dev stack (gateway + workers)

```console
$ docker compose --profile gateway --profile workers up -d --wait
```

### Enter a running backend container

```console
$ docker compose exec backend bash
```

### Restart one backend service after env/dependency changes

```console
$ docker compose up -d --build backend
```

## Backend tests

To test the backend run:

```console
$ bash ./scripts/test.sh
```

The tests run with Pytest, modify and add tests to `./backend/app/tests/`.

### Test Coverage

When the tests are run, a file `htmlcov/index.html` is generated, you can open it in your browser to see the coverage of the tests.

## Migrations

As during local development your app directory is mounted as a volume inside the container, you can also run the migrations with `alembic` commands inside the container and the migration code will be in your app directory (instead of being only inside the container). So you can add it to your git repository.

Make sure you create a "revision" of your models and that you "upgrade" your database with that revision every time you change them. As this is what will update the tables in your database. Otherwise, your application will have errors.

* Start an interactive session in the backend container:

```console
$ docker compose exec backend bash
```

* Alembic is already configured to import your SQLModel models from `./backend/app/models.py`.

* After changing a model (for example, adding a column), inside the container, create a revision, e.g.:

```console
$ alembic revision --autogenerate -m "Add column last_name to User model"
```

* Commit to the git repository the files generated in the alembic directory.

* After creating the revision, run the migration in the database (this is what will actually change the database):

```console
$ alembic upgrade head
```
