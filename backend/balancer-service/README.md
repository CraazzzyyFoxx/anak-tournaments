# Balancer Service

Team balancing service using genetic algorithm for optimal team distribution.

## Features

- **Genetic Algorithm**: Uses evolutionary optimization to balance teams
- **Multi-criteria Optimization**: Balances MMR, role preferences, and team variance
- **Captain Assignment**: Optional captain selection based on highest ratings
- **Flexible Configuration**: Customizable weights and algorithm parameters

## API Endpoints

### POST `/api/v1/balancer/balance`

Balance tournament teams based on player data.

**Request Body:**
```json
{
  "data": {
    "players": {
      "player-uuid": {
        "identity": {
          "name": "PlayerName"
        },
        "stats": {
          "classes": {
            "dps": {
              "isActive": true,
              "rank": 2500,
              "priority": 1
            },
            "support": {
              "isActive": true,
              "rank": 2300,
              "priority": 2
            }
          }
        }
      }
    }
  },
  "config": {
    "POPULATION_SIZE": 200,
    "GENERATIONS": 750,
    "USE_CAPTAINS": true
  }
}
```

**Response:**
```json
{
  "teams": [
    {
      "id": 1,
      "avgMMR": 2450.5,
      "variance": 120.3,
      "totalDiscomfort": 200,
      "maxDiscomfort": 100,
      "roster": {
        "DPS": [
          {
            "uuid": "player-uuid",
            "name": "PlayerName",
            "rating": 2500,
            "discomfort": 0,
            "isCaptain": true,
            "preferences": ["DPS", "Support"],
            "allRatings": {
              "DPS": 2500,
              "Support": 2300
            }
          }
        ]
      }
    }
  ],
  "statistics": {
    "averageMMR": 2450.5,
    "mmrStdDev": 85.2,
    "totalTeams": 6,
    "playersPerTeam": 5
  }
}
```

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
  "MASK": {"DPS": 3, "Support": 2},
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

# Production
uvicorn main:app --host 0.0.0.0 --port 8005
```

## Health Check

GET `/health` - Returns service health status
