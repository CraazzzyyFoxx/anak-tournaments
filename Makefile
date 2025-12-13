.PHONY: help build up down restart logs ps clean build-prod up-prod down-prod logs-prod health migrate test

# Default target
help:
	@echo "Available commands:"
	@echo "  make build         - Build development images"
	@echo "  make up            - Start development services"
	@echo "  make down          - Stop development services"
	@echo "  make restart       - Restart development services"
	@echo "  make logs          - View development logs"
	@echo "  make ps            - List running containers"
	@echo "  make clean         - Remove containers, volumes, and images"
	@echo ""
	@echo "  make build-prod    - Build production images"
	@echo "  make up-prod       - Start production services"
	@echo "  make down-prod     - Stop production services"
	@echo "  make logs-prod     - View production logs"
	@echo ""
	@echo "  make health        - Check service health"
	@echo "  make migrate       - Run database migrations"
	@echo "  make test          - Run tests in backend container"

# Development commands
build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f

ps:
	docker compose ps

# Production commands
build-prod:
	docker compose -f docker-compose.production.yml build

up-prod:
	docker compose -f docker-compose.production.yml up -d

down-prod:
	docker compose -f docker-compose.production.yml down

logs-prod:
	docker compose -f docker-compose.production.yml logs -f

# Utility commands
health:
	@echo "Checking service health..."
	@docker inspect --format='Backend: {{.State.Health.Status}}' aqt-backend 2>/dev/null || echo "Backend: not running"
	@docker inspect --format='Auth: {{.State.Health.Status}}' aqt-auth 2>/dev/null || echo "Auth: not running"
	@docker inspect --format='Parser: {{.State.Health.Status}}' aqt-parser 2>/dev/null || echo "Parser: not running"
	@docker inspect --format='Frontend: {{.State.Health.Status}}' aqt-frontend 2>/dev/null || echo "Frontend: not running"
	@docker inspect --format='Discord: {{.State.Health.Status}}' aqt-discord 2>/dev/null || echo "Discord: not running"
	@docker inspect --format='Twitch: {{.State.Health.Status}}' aqt-twitch 2>/dev/null || echo "Twitch: not running"
	@docker inspect --format='Balancer: {{.State.Health.Status}}' aqt-balancer 2>/dev/null || echo "Balancer: not running"

migrate:
	docker compose exec backend alembic upgrade head

test:
	docker compose exec backend pytest

clean:
	docker compose down -v --rmi all
	docker system prune -f

# Service-specific commands
backend-logs:
	docker compose logs -f backend

auth-logs:
	docker compose logs -f auth

parser-logs:
	docker compose logs -f parser

frontend-logs:
	docker compose logs -f frontend

discord-logs:
	docker compose logs -f discord

twitch-logs:
	docker compose logs -f twitch

balancer-logs:
	docker compose logs -f balancer

# Restart individual services
backend-restart:
	docker compose restart backend

auth-restart:
	docker compose restart auth

parser-restart:
	docker compose restart parser

frontend-restart:
	docker compose restart frontend

# Rebuild individual services
backend-rebuild:
	docker compose up -d --build backend

auth-rebuild:
	docker compose up -d --build auth

parser-rebuild:
	docker compose up -d --build parser

frontend-rebuild:
	docker compose up -d --build frontend
