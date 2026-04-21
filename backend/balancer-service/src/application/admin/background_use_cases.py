from __future__ import annotations


class SyncDueRegistrationSheets:
    def __init__(self, *, registration_service) -> None:
        self._registration_service = registration_service

    async def execute(self, *, session_factory):
        return await self._registration_service.sync_due_google_sheet_feeds(session_factory)
