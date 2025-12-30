# Docker Deployment Guide

## Overview

This project uses a microservices architecture with Docker Compose for orchestration. All services are containerized and can be deployed independently or as a complete stack.

## Architecture

### Services

| Service | Port       | Description |
|---------|------------|-------------|
| **backend** | 8000       | Main API service - tournaments, teams, matches |
| **auth** | 8001       | Authentication & authorization service |
| **parser** | 8002       | Tournament data parsing service |
| **discord** | -          | Discord bot service (no exposed port) |
| **twitch** | 8004       | Twitch integration service |
| **balancer** | 8003       | Team balancing service |
| **frontend** | 3000       | Next.js frontend application |
| **redis** | 6379       | In-memory cache and session store |
| **rabbitmq** | 5672/15672 | Message broker (production only) |
| **traefik** | 80         | Reverse proxy (development) |
| **kong** | 80 (via `APP_PORT`) | API Gateway (main entrypoint) |

### Service Dependencies

```
frontend -> backend, auth
backend -> redis, (rabbitmq)
auth -> redis, (rabbitmq)
parser -> redis, auth, (rabbitmq)
discord -> redis, parser, (rabbitmq)
twitch -> redis, auth, (rabbitmq)
balancer -> redis, backend, (rabbitmq)
```

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB RAM available for Docker
- Ports 80, 3000, 5432, 6379 available

## Environment Setup

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Configure required environment variables:**

   ### Core Settings
   ```env
   ENVIRONMENT=development
   PROJECT_URL=http://localhost
   APP_PORT=80
   ```

  ### Kong (optional API Gateway)
  Kong is the main entrypoint in this stack (it binds to `${APP_PORT}`).
  ```env
  # Optional: expose Kong Admin API on host (dev only recommended)
  KONG_ADMIN_PORT=8005
  KONG_LOG_LEVEL=notice
  ```

   ### Database
   ```env
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=your_secure_password
   POSTGRES_DB=aqt_db
   POSTGRES_HOST=host.docker.internal
   POSTGRES_PORT=5432
   ```

   ### Redis
   ```env
   REDIS_URL=redis://redis:6379
   ```

   ### RabbitMQ (Production)
   ```env
   RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
   RABBITMQ_DEFAULT_USER=admin
   RABBITMQ_DEFAULT_PASS=secure_password
   ```

   ### Authentication
   ```env
   ACCESS_TOKEN_SECRET=your_access_token_secret
   REFRESH_TOKEN_SECRET=your_refresh_token_secret
   ACCESS_TOKEN_EXPIRE_MINUTES=30
   REFRESH_TOKEN_EXPIRE_DAYS=7
   ACCESS_TOKEN_SERVICE=your_service_token
   ```

   ### Clerk (if using)
   ```env
   CLERK_SECRET_KEY=your_clerk_secret
   CLERK_JWKS_URL=https://your-domain.clerk.accounts.dev/.well-known/jwks.json
   CLERK_ISSUER=https://your-domain.clerk.accounts.dev
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   ```

   ### External APIs
   ```env
   CHALLONGE_API_KEY=your_challonge_key
   CHALLONGE_USERNAME=your_username
   TWITCH_CLIENT_ID=your_twitch_client_id
   TWITCH_CLIENT_SECRET=your_twitch_client_secret
   DISCORD_TOKEN=your_discord_bot_token
   DISCORD_CHANNEL_ID=your_channel_id
   DISCORD_GUILD_ID=your_guild_id
   ```

   ### S3 Storage
   ```env
   S3_ACCESS_KEY=your_access_key
   S3_SECRET_KEY=your_secret_key
   S3_ENDPOINT_URL=https://s3.amazonaws.com
   S3_BUCKET_NAME=your_bucket
   ```

## Development Deployment

### Quick Start

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down
```

### Start Specific Services

```bash
# Only backend stack
docker compose up -d backend redis

# Only frontend
docker compose up -d frontend backend redis

# With auth
docker compose up -d backend auth redis frontend
```

### Development Features

- **Hot Reload**: Code changes are synced automatically using Docker watch mode
- **Traefik**: Automatic routing and service discovery
- **Health Checks**: All services have health checks configured
- **Service Dependencies**: Services start in the correct order

### Accessing Services

- **Frontend**: http://localhost
- **Backend API**: http://localhost/api
- **Auth API**: http://localhost/auth
- **Parser API**: http://localhost/parser
- **Twitch API**: http://localhost/twitch
- **Balancer API**: http://localhost/balancer
- **Traefik Dashboard**: http://localhost (with `--api.insecure=true`)

### Accessing Kong (optional)

- **Kong Proxy**: `http://localhost` (or `http://localhost:${APP_PORT}`)
  - Example: `http://localhost/api/v1/docs`
- **Kong Admin API (dev)**: `http://localhost:${KONG_ADMIN_PORT:-8005}`

Kong routes are configured declaratively in [kong/kong.yml](kong/kong.yml).

## Production Deployment

### Build and Deploy

```bash
# Build all images
docker compose -f docker-compose.production.yml build

# Start production stack
docker compose -f docker-compose.production.yml up -d

# View logs
docker compose -f docker-compose.production.yml logs -f

# Stop stack
docker compose -f docker-compose.production.yml down
```

### Production Features

- **Multiple Workers**: Services run with multiple Uvicorn workers
- **RabbitMQ**: Message queue for inter-service communication
- **Resource Limits**: CPU and memory limits configured
- **Nginx**: High-performance reverse proxy
- **Restart Policies**: All services restart automatically
- **Health Checks**: Comprehensive health monitoring

### Resource Allocation

| Service | CPU Limit | Memory Limit | CPU Reserved | Memory Reserved |
|---------|-----------|--------------|--------------|-----------------|
| backend | 2 cores | 2GB | 0.5 cores | 512MB |
| auth | 1 core | 1GB | 0.25 cores | 256MB |
| parser | 1.5 cores | 1.5GB | 0.5 cores | 512MB |
| discord | 1 core | 1GB | 0.25 cores | 256MB |
| twitch | 1 core | 1GB | 0.25 cores | 256MB |
| balancer | 1 core | 1GB | 0.25 cores | 256MB |
| frontend | 1.5 cores | 1.5GB | 0.5 cores | 512MB |

## Monitoring & Maintenance

### View Service Status

```bash
# Check running services
docker compose ps

# Check service health
docker inspect --format='{{.State.Health.Status}}' aqt-backend
```

### Service Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend

# Last 100 lines
docker compose logs --tail=100 backend
```

### Restart Services

```bash
# Restart all services
docker compose restart

# Restart specific service
docker compose restart backend

# Rebuild and restart
docker compose up -d --build backend
```

### Clean Up

```bash
# Stop and remove containers
docker compose down

# Remove volumes (CAUTION: deletes data)
docker compose down -v

# Remove images
docker compose down --rmi all

# Full cleanup
docker system prune -a --volumes
```

## Database Migrations

```bash
# Run migrations in backend container
docker compose exec backend alembic upgrade head

# Create new migration
docker compose exec backend alembic revision --autogenerate -m "description"

# Rollback migration
docker compose exec backend alembic downgrade -1
```

## Troubleshooting

### Service Won't Start

1. Check logs: `docker compose logs service-name`
2. Verify environment variables in `.env`
3. Ensure required ports are available
4. Check service dependencies are healthy

### Health Check Failures

```bash
# Check health status
docker inspect --format='{{json .State.Health}}' container-name

# View health check logs
docker inspect container-name | jq '.[0].State.Health.Log'
```

### Network Issues

```bash
# Recreate networks
docker compose down
docker network prune
docker compose up -d

# Check network connectivity
docker compose exec backend ping redis
```

### Performance Issues

1. Check resource usage: `docker stats`
2. Increase resource limits in production compose file
3. Scale services: `docker compose up -d --scale backend=3`

### Database Connection Issues

1. Verify `POSTGRES_HOST` is correct (use `host.docker.internal` for local DB)
2. Check if database is accessible from container
3. Verify credentials in `.env`

## Scaling Services

### Horizontal Scaling

```bash
# Scale backend service to 3 instances
docker compose -f docker-compose.production.yml up -d --scale backend=3

# Scale multiple services
docker compose -f docker-compose.production.yml up -d \
  --scale backend=3 \
  --scale auth=2 \
  --scale parser=2
```

**Note**: Only scale stateless services (backend, auth, parser, twitch, balancer)

## CI/CD Integration

### Build Images

```bash
# Build specific service
docker compose build backend

# Build all services
docker compose build

# Build with no cache
docker compose build --no-cache
```

### Push to Registry

```bash
# Login to registry
docker login registry.craazzzyyfoxx.me

# Push images
docker compose -f docker-compose.production.yml push

# Push specific service
docker compose -f docker-compose.production.yml push backend
```

## Security Best Practices

1. **Environment Variables**: Never commit `.env` files
2. **Secrets Management**: Use Docker secrets in production
3. **Network Isolation**: Services only expose necessary ports
4. **Regular Updates**: Keep base images updated
5. **Health Checks**: Monitor service health
6. **Resource Limits**: Prevent resource exhaustion
7. **Read-only Filesystems**: Where possible, use read-only containers

## Performance Optimization

1. **Multi-stage Builds**: Dockerfile uses multi-stage builds
2. **Layer Caching**: Dependencies installed in separate layer
3. **Build Context**: `.dockerignore` excludes unnecessary files
4. **Compiled Bytecode**: Python bytecode compilation enabled
5. **Workers**: Production uses multiple Uvicorn workers
6. **Connection Pooling**: Redis and PostgreSQL connection pools

## Backup & Recovery

### Backup Volumes

```bash
# Backup redis data
docker run --rm \
  --volumes-from aqt-redis \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/redis-backup.tar.gz /data

# Backup logs
docker run --rm \
  -v $(pwd)/logs:/logs \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/logs-backup.tar.gz /logs
```

### Restore Volumes

```bash
# Restore redis data
docker run --rm \
  --volumes-from aqt-redis \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/redis-backup.tar.gz
```

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
- [FastAPI in Docker](https://fastapi.tiangolo.com/deployment/docker/)
