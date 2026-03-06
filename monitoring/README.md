# Monitoring Deployment

This document explains how to deploy the monitoring stack for Anak Tournaments on the same host as the application.

The monitoring stack is defined in `monitoring/docker-compose.monitoring.yml` and includes:

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
3. The application created the shared Docker network `anak-tournaments_app-network`.
4. The host log directories exist under `logs/`, because Promtail reads logs from there.

Application logs are mounted from `../logs` into Promtail as `/var/log/app`.

## What the stack exposes

After deployment, the monitoring endpoints are available on the host:

- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`
- Loki: `http://localhost:3100`
- Redis Exporter: `http://localhost:9121/metrics`
- RabbitMQ Exporter: `http://localhost:9419/metrics`

## 1. Start the application stack first

The monitoring compose file connects to the external Docker network `anak-tournaments_app-network`, so the application stack must be running before monitoring starts.

For local development:

```bash
docker compose up -d --wait
```

For production:

```bash
docker compose -f docker-compose.production.yml up -d
```

Then confirm the shared network exists:

```bash
docker network ls
```

Look for `anak-tournaments_app-network`.

If your deployment uses a different Compose project name or a different repository directory name, Docker may create a different network name. In that case, update `monitoring/docker-compose.monitoring.yml` so the external network name matches the real application network.

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

These variables are used by:

- `monitoring/docker-compose.monitoring.yml` for Grafana admin credentials
- `monitoring/docker-compose.monitoring.yml` for RabbitMQ exporter access

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

## 4. Start the monitoring stack

Validate the compose file:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml config
```

Pull the images:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml pull
```

Start the stack:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

Check container status:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml ps
```

## 5. Verify the deployment

Check logs if any service is restarting or unhealthy:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml logs -f prometheus alertmanager grafana loki promtail
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
docker compose -f monitoring/docker-compose.monitoring.yml down
```

Restart the monitoring stack:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml restart
```

Restart a single service after a config change:

```bash
docker compose -f monitoring/docker-compose.monitoring.yml restart prometheus
docker compose -f monitoring/docker-compose.monitoring.yml restart grafana
docker compose -f monitoring/docker-compose.monitoring.yml restart alertmanager
```

## Alerting setup note

Alertmanager reads the Discord webhook from `monitoring/secrets/discord_webhook_url` through the mounted path `/run/secrets/discord_webhook_url`.

This keeps the real webhook out of git while still allowing a static Alertmanager config file to be mounted safely.

## Troubleshooting

### Monitoring stack fails with missing external network

Cause: the application stack is not running yet, or the network name is different.

Fix:

1. Start the application first.
2. Run `docker network ls`.
3. Update `monitoring/docker-compose.monitoring.yml` if the actual network name is not `anak-tournaments_app-network`.

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
3. Check `docker compose -f monitoring/docker-compose.monitoring.yml logs promtail`.

## Files involved in deployment

- `monitoring/docker-compose.monitoring.yml` - monitoring stack definition
- `monitoring/prometheus/prometheus.yml` - Prometheus scrape jobs and alertmanager target
- `monitoring/prometheus/rules/` - alert rules
- `monitoring/alertmanager/alertmanager.yml` - alert routing
- `monitoring/secrets/discord_webhook_url.example` - example Discord webhook secret file
- `monitoring/promtail/promtail.yml` - log collection
- `monitoring/grafana/provisioning/` - Grafana datasources and dashboards
