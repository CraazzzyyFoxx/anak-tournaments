"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { rbacService } from "@/services/rbac.service";
import workspaceService from "@/services/workspace.service";
import type { WorkspaceSystemRole } from "@/types/workspace.types";
import { workspaceQueryKeys } from "@/lib/workspace/query-keys";
import { useTranslations } from "next-intl";

import { SYSTEM_ROLES } from "./model";

export function AddMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  systemRoleId,
  onAdded
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: number;
  systemRoleId: (name: WorkspaceSystemRole) => number | undefined;
  onAdded: () => void;
}>) {
  const t = useTranslations("adminAccess.common");
  const tw = useTranslations("adminAccess.workspace");
  const tm = useTranslations("adminAccess.member");
  const userFieldId = useId();
  const roleFieldId = useId();
  const [userId, setUserId] = useState<string>("");
  // One system role, same as the row's role select; custom roles are added from the row.
  const [role, setRole] = useState<WorkspaceSystemRole>("player");
  const [userComboOpen, setUserComboOpen] = useState(false);

  const { data: allUsers } = useQuery({
    queryKey: workspaceQueryKeys.rbacUsersAll(workspaceId),
    queryFn: () => rbacService.listUsersAll({ workspace_id: workspaceId }),
    enabled: open
  });

  const addMemberMutation = useMutation({
    mutationFn: (roleId: number) => workspaceService.addMember(workspaceId, Number(userId), roleId),
    onSuccess: () => {
      setUserId("");
      setRole("player");
      notify.success(tw("memberAdded"));
      onAdded();
    },
    onError: (error) => notify.apiError(error)
  });

  const selectedUsername = allUsers?.find((u) => u.id === Number(userId))?.username;

  // Validated on submit rather than by disabling the button, so the reason the
  // form will not go through is spoken instead of silently greyed out.
  const submit = () => {
    if (!userId) {
      notify.error(tw("pickUser"));
      return;
    }
    const roleId = systemRoleId(role);
    if (roleId == null) {
      notify.error(tw("roleNotConfigured"));
      return;
    }
    addMemberMutation.mutate(roleId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addMember")}</DialogTitle>
          <DialogDescription>{tm("addDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={userFieldId}>{t("user")}</Label>
            <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  id={userFieldId}
                  variant="outline"
                  role="combobox"
                  aria-haspopup="listbox"
                  aria-expanded={userComboOpen}
                  className="justify-between"
                >
                  <span className="truncate">{selectedUsername ?? tm("selectUser")}</span>
                  <ChevronsUpDown aria-hidden className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder={t("searchUser")} />
                  <CommandList>
                    <CommandEmpty>{t("noUser")}</CommandEmpty>
                    <CommandGroup>
                      {(allUsers ?? []).map((u) => (
                        <CommandItem
                          key={u.id}
                          value={u.username}
                          onSelect={() => {
                            setUserId(String(u.id));
                            setUserComboOpen(false);
                          }}
                        >
                          <Check
                            aria-hidden
                            className={cn(
                              "mr-2 size-4",
                              userId === String(u.id) ? "opacity-100" : "opacity-0"
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={roleFieldId}>{t("role")}</Label>
            <Select value={role} onValueChange={(value) => setRole(value as WorkspaceSystemRole)}>
              <SelectTrigger id={roleFieldId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYSTEM_ROLES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {tm(`${name}Role`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={addMemberMutation.isPending}>
            {addMemberMutation.isPending ? tm("adding") : t("addMember")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
