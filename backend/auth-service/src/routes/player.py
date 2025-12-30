"""
Player linking routes
"""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.core import db
from src.core.logging import logger
from src import schemas, models
from src.services import auth_service

router = APIRouter(prefix="/auth/player", tags=["Player Linking"])


@router.post("/link", response_model=schemas.PlayerLinkResponse, status_code=status.HTTP_201_CREATED)
async def link_player(
    link_data: schemas.PlayerLinkRequest,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Link game player to current auth user
    """
    logger.info(f"Linking player {link_data.player_id} to user {current_user.username}")
    
    player_link = await models.DiscordOAuthService.link_player(
        session, current_user, link_data.player_id, link_data.is_primary
    )
    
    # Get player info
    from shared.models.user import User
    result = await session.execute(
        select(User).where(User.id == link_data.player_id)
    )
    player = result.scalar_one()
    
    linked_player = schemas.LinkedPlayer(
        player_id=player.id,
        player_name=player.name,
        is_primary=player_link.is_primary,
        linked_at=player_link.created_at.isoformat()
    )
    
    return schemas.PlayerLinkResponse(
        message="Player linked successfully",
        player=linked_player
    )


@router.delete("/unlink/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_player(
    player_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Unlink game player from current auth user
    """
    logger.info(f"Unlinking player {player_id} from user {current_user.username}")
    await models.DiscordOAuthService.unlink_player(session, current_user, player_id)


@router.get("/linked", response_model=list[schemas.LinkedPlayer])
async def get_linked_players(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Get all linked players for current auth user
    """
    from shared.models.user import User
    
    player_links = await models.DiscordOAuthService.get_linked_players(session, current_user)
    
    result = []
    for link in player_links:
        player_result = await session.execute(
            select(User).where(User.id == link.player_id)
        )
        player = player_result.scalar_one()
        
        result.append(schemas.LinkedPlayer(
            player_id=player.id,
            player_name=player.name,
            is_primary=link.is_primary,
            linked_at=link.created_at.isoformat()
        ))
    
    return result


@router.patch("/linked/{player_id}/primary", status_code=status.HTTP_200_OK)
async def set_primary_player(
    player_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Set a linked player as primary
    """
    logger.info(f"Setting player {player_id} as primary for user {current_user.username}")
    
    # Unset all primary flags
    result = await session.execute(
        select(models.AuthUserPlayer).where(
            models.AuthUserPlayer.auth_user_id == current_user.id,
            models.AuthUserPlayer.is_primary == True
        )
    )
    for link in result.scalars():
        link.is_primary = False
    
    # Set new primary
    result = await session.execute(
        select(models.AuthUserPlayer).where(
            models.AuthUserPlayer.auth_user_id == current_user.id,
            models.AuthUserPlayer.player_id == player_id
        )
    )
    link = result.scalar_one()
    link.is_primary = True
    
    await session.commit()
    
    return {"message": "Primary player updated successfully"}
