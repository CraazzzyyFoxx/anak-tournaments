from fastapi import HTTPException, status


class WorkspaceAccessPolicy:
    def ensure_workspace_access(
        self,
        user,
        workspace_id: int | None,
        *,
        resource: str = "team",
        action: str = "import",
    ) -> None:
        if workspace_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="workspace_id is required",
            )
        if user.has_role("tournament_organizer"):
            return
        if user.has_workspace_permission(workspace_id, resource, action):
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied for workspace {workspace_id}: {resource}.{action} required",
        )
