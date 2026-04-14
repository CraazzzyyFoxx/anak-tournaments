from fastapi import APIRouter

from src.routes.admin.balancer import router as balancer_router
from src.routes.admin.registration import router as registration_router
from src.routes.admin.registration_status import router as registration_status_router

admin_router = APIRouter(prefix="/admin")
admin_router.include_router(balancer_router)
admin_router.include_router(registration_router)
admin_router.include_router(registration_status_router)
