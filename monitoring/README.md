# Monitoring Deployment

This document explains how monitoring is deployed as part of the unified production stack for Anak Tournaments.

The monitoring services are orchestrated from `docker-compose.production.yml` and use configs stored in `monitoring/`.

- Prometheus for metrics collection
- Alertmanager for alert routing
- Grafana for dashboards
- Loki for log storage
- Promtail for log shipping
- Redis Exporter for Redis metrics
- RabbitMQ Exporter for RabbitMQ metrics

## Prerequisites

Before starting the monitoring stack, make sure all of the following are true:

1. Docker and Docker Compose are installed on the host.
2. The application stack is already running on the same machine.
3. The host log directories exist under `logs/`, because Promtail reads logs from there.

Application logs are mounted from `./logs` into Promtail as `/var/log/app` through `docker-compose.production.yml`.

## What the stack exposes

After deployment, the monitoring endpoints are available on the host:

- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`
- Loki: `http://localhost:3100`
- Redis Exporter: `http://localhost:9121/metrics`
- RabbitMQ Exporter: `http://localhost:9419/metrics`

## 1. Prepare the production stack

Monitoring now runs inside the same production Docker Compose stack as the application.

The production compose file sets the project name to `overwatch-tournaments`, so all resources are created under one stack.

## 2. Prepare environment variables

The monitoring stack can start with defaults, but production deployment should set explicit credentials.

Recommended variables:

```bash
export GRAFANA_ADMIN_USER=admin
export GRAFANA_ADMIN_PASSWORD='change-me'
export GRAFANA_ROOT_URL='http://localhost:3001'

export RABBITMQ_USER='your-rabbitmq-user'
export RABBITMQ_PASSWORD='your-rabbitmq-password'
```

For Discord alert delivery, create a local secret file that is not committed to git:

```bash
cp monitoring/secrets/discord_webhook_url.example monitoring/secrets/discord_webhook_url
```

Then replace the example value in `monitoring/secrets/discord_webhook_url` with the real Discord webhook URL.

These variables are used by `docker-compose.production.yml` for Grafana and RabbitMQ exporter configuration.

If RabbitMQ in the application stack uses the values from `RABBITMQ_DEFAULT_USER` and `RABBITMQ_DEFAULT_PASS`, set `RABBITMQ_USER` and `RABBITMQ_PASSWORD` to the same credentials before starting monitoring.

## 3. Check Prometheus scrape targets before first deploy

The application services expose Prometheus metrics via `/metrics`:

- `backend` on port `8000`
- `auth` on port `8001`
- `parser` on port `8002`
- `balancer` on port `8003`

Before production deployment, review `monitoring/prometheus/prometheus.yml` and verify that the scrape targets match the real Docker service names in your application compose file.

The current Prometheus config is aligned with the application compose files and scrapes:

- `backend:8000`
- `auth:8001`
- `parser:8002`
- `balancer:8003`

## 4. Start monitoring services

Validate the compose file:

```bash
docker compose -f docker-compose.production.yml config
```

Pull the images:

```bash
docker compose -f docker-compose.production.yml pull prometheus alertmanager grafana loki promtail redis-exporter rabbitmq-exporter
```

Start only the monitoring services inside the unified production stack:

```bash
docker compose -f docker-compose.production.yml up -d prometheus alertmanager grafana loki promtail redis-exporter rabbitmq-exporter
```

Check container status:

```bash
docker compose -f docker-compose.production.yml ps prometheus alertmanager grafana loki promtail redis-exporter rabbitmq-exporter
```

## 5. Verify the deployment

Check logs if any service is restarting or unhealthy:

```bash
docker compose -f docker-compose.production.yml logs -f prometheus alertmanager grafana loki promtail
```

Then verify each major component:

### Grafana

Open `http://localhost:3001` and log in with:

- user: value of `GRAFANA_ADMIN_USER`
- password: value of `GRAFANA_ADMIN_PASSWORD`

Grafana datasources are provisioned from `monitoring/grafana/provisioning/datasources/datasources.yml`.

Expected datasources:

- Prometheus -> `http://prometheus:9090`
- Loki -> `http://loki:3100`

Provisioned dashboards are placed in the Grafana folder `Anak Tournaments`, and the default home dashboard points to `Application Logs`.

If Grafana was already started before this provisioning setup was introduced, existing dashboards may remain in `General` until they are re-imported or moved once. Fresh Grafana volumes pick up the folder and home dashboard automatically.

### Prometheus

Open `http://localhost:9090/targets` and verify that targets are `UP`.

At minimum, these should become healthy:

- `redis-exporter:9121`
- `rabbitmq-exporter:9419`

The application targets will only become healthy if the scrape hostnames match the real service names on the shared Docker network.

### Loki and Promtail

Open Grafana Explore and query Loki logs.

Promtail reads log files from `logs/**/*.log` through the mount defined in `monitoring/promtail/promtail.yml`. If no logs appear in Grafana, first verify that the application actually writes JSON logs into the repository `logs/` directory.

## 6. Stop or restart monitoring

Stop the monitoring stack:

```bash
docker compose -f docker-compose.production.yml stop prometheus alertmanager grafana loki promtail redis-exporter rabbitmq-exporter
```

Restart the monitoring stack:

```bash
docker compose -f docker-compose.production.yml restart prometheus alertmanager grafana loki promtail redis-exporter rabbitmq-exporter
```

Restart a single service after a config change:

```bash
docker compose -f docker-compose.production.yml restart prometheus
docker compose -f docker-compose.production.yml restart grafana
docker compose -f docker-compose.production.yml restart alertmanager
```

## Alerting setup note

Alertmanager reads the Discord webhook from `monitoring/secrets/discord_webhook_url` through the mounted path `/run/secrets/discord_webhook_url`.

This keeps the real webhook out of git while still allowing a static Alertmanager config file to be mounted safely.

## Troubleshooting

### Monitoring services fail to start

Cause: required application services are not running inside the unified production stack.

Fix:

1. Start the application first.
2. Run `docker compose -f docker-compose.production.yml ps`.
3. Ensure the required services are attached to `app-network` in the production compose file.

### Prometheus shows app targets as DOWN

Cause: the target hostnames in `monitoring/prometheus/prometheus.yml` do not match the actual Docker service names, or the application services are not attached to the shared network.

Fix:

1. Open `http://localhost:9090/targets`.
2. Identify which targets are failing.
3. Compare them with the service names in `docker-compose.yml` or `docker-compose.production.yml`.
4. Update `monitoring/prometheus/prometheus.yml` and restart Prometheus.

### RabbitMQ exporter is UP but returns no useful data

Cause: the exporter can reach the container but uses incorrect RabbitMQ credentials.

Fix:

1. Set `RABBITMQ_USER` and `RABBITMQ_PASSWORD` to the same values used by the application RabbitMQ instance.
2. Restart `rabbitmq-exporter`.

### Alertmanager starts but Discord alerts are not delivered

Cause: `monitoring/secrets/discord_webhook_url` is missing, empty, or contains an invalid webhook.

Fix:

1. Create `monitoring/secrets/discord_webhook_url` from `monitoring/secrets/discord_webhook_url.example`.
2. Put the real Discord webhook URL into the file.
3. Restart `alertmanager`.

### Loki is healthy but no logs appear in Grafana

Cause: Promtail does not see files in `logs/`, or the application writes logs somewhere else.

Fix:

1. Confirm that the repository contains fresh `.log` files under `logs/`.
2. Confirm that `promtail` is running.
3. Check `docker compose -f docker-compose.production.yml logs promtail`.

## Files involved in deployment

- `docker-compose.production.yml` - unified production stack definition
- `monitoring/prometheus/prometheus.yml` - Prometheus scrape jobs and alertmanager target
- `monitoring/prometheus/rules/` - alert rules
- `monitoring/alertmanager/alertmanager.yml` - alert routing
- `monitoring/secrets/discord_webhook_url.example` - example Discord webhook secret file
- `monitoring/promtail/promtail.yml` - log collection
- `monitoring/grafana/provisioning/` - Grafana datasources and dashboards
