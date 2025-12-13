import json
from typing import Optional
from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from src.core.logging import logger
from src.schemas import BalanceRequest, BalanceResponse, ConfigOverrides
from src.service import balance_teams, export_teams_to_json_file


router = APIRouter(prefix="/api/v1/balancer", tags=["Balancer"])


@router.post("/balance", response_model=BalanceResponse, status_code=status.HTTP_200_OK)
async def balance_tournament_teams(
    file: UploadFile = File(None, description="File containing player data/commands"),
):
    try:
        logger.info("Received team balancing request")
        
        # Parse player data from file or form field
        
        if file:
            logger.info(f"Processing uploaded file: {file.filename}")
            content = await file.read()
            try:
                player_data = json.loads(content.decode('utf-8'))
                logger.info("Successfully parsed data from uploaded file")
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON in uploaded file: {str(e)}")
        else:
            raise ValueError("Either 'file' or 'data' parameter must be provided")

        config_overrides = None

        # Run balancing algorithm
        result = balance_teams(player_data, config_overrides)
        export_teams_to_json_file(result, "teams.json")

        logger.success(f"Successfully balanced {result['statistics']['totalTeams']} teams")
        return result
        
    except ValueError as e:
        logger.error(f"Validation error during balancing: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Unexpected error during balancing: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )
