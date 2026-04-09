"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Trash2, UserPlus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { rbacService } from "@/services/rbac.service";
import workspaceService from "@/services/workspace.service";
import { Workspace, WorkspaceMember } from "@/types/workspace.types";
import { useWorkspaceStore } from "@/stores/workspace.store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export default function WorkspaceMembersPage() {
  const { toast } = useToast();
  const { isSuperuser, isWorkspaceAdmin } = usePermissions();
  const queryClient = useQueryClient();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const getCurrentWorkspace = useWorkspaceStore((s) => s.getCurrentWorkspace);
  const workspace = getCurrentWorkspace();

  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [addMemberRole, setAddMemberRole] = useState("member");
  const [userComboOpen, setUserComboOpen] = useState(false);

  const canManage = isSuperuser || (currentWorkspaceId !== null && isWorkspaceAdmin(currentWorkspaceId));

  const { data: members, refetch: refetchMembers } = useQuery({
    queryKey: ["workspace-members", currentWorkspaceId],
    queryFn: () => (currentWorkspaceId ? workspaceService.getMembers(currentWorkspaceId) : Promise.resolve([])),
    enabled: !!currentWorkspaceId,
  });

  const { data: allUsers } = useQuery({
    queryKey: ["rbac-users"],
    queryFn: () => rbacService.listUsers(),
    enabled: canManage,
  });

  const addMemberMutation = useMutation({
    mutationFn: () =>
      workspaceService.addMember(currentWorkspaceId!, Number(addMemberUserId), addMemberRole),
    onSuccess: () => {
      refetchMembers();
      setAddMemberUserId("");
      toast({ title: "Member added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (authUserId: number) => workspaceService.removeMember(currentWorkspaceId!, authUserId),
    onSuccess: () => {
      refetchMembers();
      toast({ title: "Member removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ authUserId, role }: { authUserId: number; role: string }) =>
      workspaceService.updateMemberRole(currentWorkspaceId!, authUserId, role),
    onSuccess: () => {
      refetchMembers();
      toast({ title: "Role updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentWorkspaceId) {
    return (
      <div className="flex flex-col gap-6">
        <AdminPageHeader title="Workspace Members" description="Select a workspace to manage members." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Workspace Members"
        description={`Manage who has access to ${workspace?.name ?? "this workspace"} and their roles.`}
      />

      {canManage && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add Member</CardTitle>
            <CardDescription>Grant a user access to this workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={userComboOpen}
                    className="w-56 justify-between"
                  >
                    <span className="truncate">
                      {addMemberUserId
                        ? allUsers?.find((u) => u.id === Number(addMemberUserId))?.username
                        : "Select user..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0">
                  <Command>
                    <CommandInput placeholder="Search user..." />
                    <CommandList>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        {(allUsers ?? [])
                          .filter((u) => !members?.some((m: WorkspaceMember) => m.auth_user_id === u.id))
                          .map((u) => (
                            <CommandItem
                              key={u.id}
                              value={u.username}
                              onSelect={() => {
                                setAddMemberUserId(String(u.id));
                                setUserComboOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  addMemberUserId === String(u.id) ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {u.username}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Select value={addMemberRole} onValueChange={setAddMemberRole}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={() => addMemberMutation.mutate()}
                disabled={!addMemberUserId || addMemberMutation.isPending}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Members ({members?.length ?? 0})
              </CardTitle>
              <CardDescription>Users with access to this workspace</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="grid grid-cols-[1fr_140px_40px] gap-2 items-center px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
              <span>User</span>
              <span>Role</span>
              <span />
            </div>

            {members?.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No members yet. Add a user above to get started.
              </div>
            )}

            {members?.map((m: WorkspaceMember) => (
              <div
                key={m.id}
                className="grid grid-cols-[1fr_140px_40px] gap-2 items-center px-4 py-2 border-b last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <span className="text-sm font-medium">
                  {allUsers?.find((u) => u.id === m.auth_user_id)?.username ?? `User #${m.auth_user_id}`}
                </span>

                {canManage ? (
                  <Select
                    value={m.role}
                    onValueChange={(role) =>
                      updateRoleMutation.mutate({ authUserId: m.auth_user_id, role })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Owner</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="text-xs w-fit">
                    {m.role}
                  </Badge>
                )}

                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive h-8 w-8"
                    onClick={() => removeMemberMutation.mutate(m.auth_user_id)}
                    disabled={removeMemberMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
