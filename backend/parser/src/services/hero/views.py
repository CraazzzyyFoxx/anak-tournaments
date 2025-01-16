from fastapi import APIRouter, Depends

from src.core import db, enums, pagination
from src import schemas

from . import flows

router = APIRouter(prefix="/hero", tags=[enums.RouteTag.HERO])
