# Balancer Service

Team balancing service using genetic algorithm for optimal team distribution.

## Features

- **Genetic Algorithm**: Uses evolutionary optimization to balance teams
- **Multi-criteria Optimization**: Balances MMR, role preferences, and team variance
- **Captain Assignment**: Optional captain selection based on highest ratings
- **Flexible Configuration**: Customizable weights and algorithm parameters

## API Endpoints

## Authorization

All balancer endpoints (except `/health`) require an access token and are restricted to users with one of these roles:

- `admin`
- `tournament_organizer`

### POST `/api/balancer/jobs`

Create async balancing job and return `job_id` immediately.

**Request (multipart/form-data):**
- `file` (required): JSON file with player data
- `config` (optional): JSON string with balancing overrides

```bash
curl -X POST "http://localhost:8005/api/balancer/jobs" \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@players.json" \
  -F 'config={"MASK":{"Tank":1,"Damage":2,"Support":2},"POPULATION_SIZE":200,"GENERATIONS":750,"USE_CAPTAINS":true}'
```

### POST `/api/balancer/balance`

Backward-compatible alias for `POST /api/balancer/jobs`. Returns async `job_id`.

### GET `/api/balancer/jobs/{job_id}`

Get job status (`queued`, `running`, `succeeded`, `failed`) with current stage and progress.

### GET `/api/balancer/jobs/{job_id}/result`

Get final balancing result when job is complete.

### GET `/api/balancer/jobs/{job_id}/stream`

SSE stream with live status updates and worker logs.

### GET `/api/balancer/config`

Returns runtime defaults, allowed limits, and available presets for frontend forms.

## Configuration

All balancing parameters can be customized by passing a `config` object in your API request. The service supports:

- **Role Configuration**: Custom role masks and mappings
- **Genetic Algorithm**: Population size, generations, elitism, mutation parameters
- **Cost Weights**: MMR difference, discomfort, variance, and max discomfort weights
- **Strategy**: Captain assignment and display settings

**For a complete guide to all configuration parameters**, see [CONFIG_GUIDE.md](CONFIG_GUIDE.md).

### Quick Configuration Examples

**Default Configuration:**
```json
{
  "MASK": {"Tank": 1, "Damage": 2, "Support": 2},
  "POPULATION_SIZE": 200,
  "GENERATIONS": 750,
  "ELITISM_RATE": 0.2,
  "MUTATION_RATE": 0.4,
  "MUTATION_STRENGTH": 3,
  "MMR_DIFF_WEIGHT": 3.0,
  "DISCOMFORT_WEIGHT": 0.25,
  "INTRA_TEAM_VAR_WEIGHT": 0.8,
  "MAX_DISCOMFORT_WEIGHT": 1.0,
  "USE_CAPTAINS": true
}
```

**Competitive Tournament (prioritize fair matches):**
```json
{
  "POPULATION_SIZE": 300,
  "GENERATIONS": 1000,
  "MMR_DIFF_WEIGHT": 5.0,
  "USE_CAPTAINS": true
}
```

**Quick Balancing (faster, lower quality):**
```json
{
  "POPULATION_SIZE": 50,
  "GENERATIONS": 200,
  "USE_CAPTAINS": false
}
```

## Running

```bash
# Development
uvicorn main:app --reload --port 8005

# Worker (async jobs)
faststream run serve:app

# Production
uvicorn main:app --host 0.0.0.0 --port 8005
```

## Health Check

GET `/health` - Returns service health status
