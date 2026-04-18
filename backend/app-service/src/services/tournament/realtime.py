from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class TournamentRealtimeManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, tournament_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[tournament_id].add(websocket)

    def disconnect(self, tournament_id: int, websocket: WebSocket) -> None:
        sockets = self._connections.get(tournament_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(tournament_id, None)

    async def broadcast_recalculated(self, tournament_id: int) -> None:
        await self.broadcast(
            tournament_id,
            {
                "type": "tournament:recalculated",
                "data": {"tournament_id": tournament_id},
            },
        )

    async def broadcast(self, tournament_id: int, payload: dict[str, Any]) -> None:
        sockets = list(self._connections.get(tournament_id, set()))
        for websocket in sockets:
            try:
                await websocket.send_json(payload)
            except Exception:
                self.disconnect(tournament_id, websocket)


tournament_realtime_manager = TournamentRealtimeManager()
