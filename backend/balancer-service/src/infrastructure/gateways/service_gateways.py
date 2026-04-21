from __future__ import annotations

from src.services import team as team_flows
from src.services.admin import balancer as balancer_service
from src.services.admin import balancer_registration as registration_service
from src.services.admin import registration_status as status_service


class ServiceGatewayProxy:
    def __init__(self, service_module) -> None:
        self._service_module = service_module

    def __getattr__(self, name: str):
        return getattr(self._service_module, name)


class BalancerAdminGateway(ServiceGatewayProxy):
    def __init__(self) -> None:
        super().__init__(balancer_service)


class RegistrationAdminGateway(ServiceGatewayProxy):
    def __init__(self) -> None:
        super().__init__(registration_service)


class RegistrationStatusGateway(ServiceGatewayProxy):
    def __init__(self) -> None:
        super().__init__(status_service)


class TeamGateway(ServiceGatewayProxy):
    def __init__(self) -> None:
        super().__init__(team_flows)
