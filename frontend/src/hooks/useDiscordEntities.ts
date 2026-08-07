import { useQuery } from "@tanstack/react-query";
import workspaceService from "@/services/workspace.service";

export function useDiscordRoles(workspaceId: number | null | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ["workspace", workspaceId, "discord", "roles"],
    queryFn: () => workspaceService.getDiscordRoles(workspaceId!),
    enabled: Boolean(workspaceId && enabled),
    staleTime: 60 * 1000,
  });
}

export function useDiscordChannels(workspaceId: number | null | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ["workspace", workspaceId, "discord", "channels"],
    queryFn: () => workspaceService.getDiscordChannels(workspaceId!),
    enabled: Boolean(workspaceId && enabled),
    staleTime: 60 * 1000,
  });
}

export function useDiscordGuildInfo(workspaceId: number | null | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ["workspace", workspaceId, "discord", "guild"],
    queryFn: () => workspaceService.getDiscordGuildInfo(workspaceId!),
    enabled: Boolean(workspaceId && enabled),
    staleTime: 60 * 1000,
  });
}
