"use client";

import { createElement, useId, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Pipette, Plus, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import StatusMetaBadge from "@/components/status/StatusMetaBadge";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { EYEBROW_CLASS, TONE_CLASS } from "@/components/admin/tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import { getStatusIcon, STATUS_ICON_OPTIONS } from "@/lib/status-icons";
import { cn } from "@/lib/utils";
import balancerAdminService from "@/services/balancer-admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type {
  BalancerCustomStatus,
  BalancerCustomStatusCreateInput,
  BalancerCustomStatusUpdateInput
} from "@/types/balancer-admin.types";
import type { StatusScope } from "@/types/registration.types";

type StatusFormState = {
  scope: StatusScope;
  icon_slug: string;
  icon_color: string;
  name: string;
  description: string;
  excludes_from_balancer: boolean;
  excludes_from_ready: boolean;
};

const EMPTY_FORM: StatusFormState = {
  scope: "registration",
  icon_slug: "",
  icon_color: "",
  name: "",
  description: "",
  excludes_from_balancer: false,
  excludes_from_ready: false
};

// Swatch palette offered to the admin who is choosing a status's `icon_color`,
// which is persisted per status row. These hexes are the picker's *content*, not
// this page's chrome, so they are exempt from the design-token rule — a themed
// var here would change what gets written to the database when the theme changes.
const STATUS_COLOR_PRESETS = [
  "#94a3b8",
  "#64748b",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#38bdf8",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899"
];

function normalizeHexColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  return normalized.startsWith("#") ? normalized : `#${normalized}`;
}

/** Column header shared by the system and custom status tables below. */
function BalancerStatusTableHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Status</TableHead>
        <TableHead>Slug</TableHead>
        <TableHead>Description</TableHead>
        <TableHead className="w-30 text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function StatusColorPicker({
  value,
  onChange
}: Readonly<{
  value: string;
  onChange: (next: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const hexId = useId();
  // `<input type="color">` and the swatch preview both need a literal hex; the
  // DOM API cannot take a CSS variable. Data-shaped, not chrome — exempt.
  const normalizedValue = normalizeHexColor(value) || "#94a3b8";

  return (
    <div className="space-y-2">
      <Label htmlFor={triggerId}>Icon color</Label>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <Button
            id={triggerId}
            variant="outline"
            className="w-full justify-between"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className="size-5 shrink-0 rounded-md border border-border shadow-sm"
                style={{ backgroundColor: normalizedValue }}
                aria-hidden
              />
              <span className="truncate font-mono text-xs uppercase">
                {normalizeHexColor(value) || "Default"}
              </span>
            </span>
            <Pipette className="ml-2 size-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] space-y-4"
        >
          <div className="space-y-2">
            <p className={EYEBROW_CLASS} id={`${triggerId}-presets`}>
              Presets
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${triggerId}-presets`}>
              {STATUS_COLOR_PRESETS.map((color) => {
                const selected = normalizeHexColor(value).toLowerCase() === color.toLowerCase();
                return (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      "h-8 w-8 shrink-0 rounded-md border border-border transition hover:border-[color:var(--aqt-border-3)]",
                      selected && "ring-2 ring-ring ring-offset-2 ring-offset-background"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => onChange(color)}
                    aria-pressed={selected}
                    aria-label={`Use preset color ${color}`}
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className={EYEBROW_CLASS}>Custom</p>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-12 items-center justify-center rounded-md border border-input bg-background shadow-sm">
                <input
                  type="color"
                  className="size-6 cursor-pointer rounded-md border border-border bg-transparent p-0"
                  aria-label="Pick a custom icon color"
                  value={normalizedValue}
                  onChange={(event) => onChange(event.target.value)}
                />
              </span>
              <Label htmlFor={hexId} className="sr-only">
                Icon color hex code
              </Label>
              {/* Placeholder shows the expected hex literal — it is example
                  input for a hex-typed field, not a colour this UI paints with. */}
              <Input
                id={hexId}
                value={value}
                onChange={(event) => onChange(normalizeHexColor(event.target.value))}
                placeholder="#38bdf8"
                className="font-mono uppercase"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function StatusForm({
  value,
  onChange,
  disableScope = false,
  isBuiltin = false
}: Readonly<{
  value: StatusFormState;
  onChange: (next: StatusFormState) => void;
  disableScope?: boolean;
  /** True when editing a builtin-status override: pool-inclusion is fixed by the system, not admin-editable. */
  isBuiltin?: boolean;
}>) {
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  // Two dialogs mount this form, so the field ids have to be per-instance.
  const fieldId = useId();
  const previewMeta = useMemo(
    () => ({
      value: value.name || "preview",
      scope: value.scope,
      is_builtin: false,
      kind: "custom" as const,
      is_override: false,
      can_edit: true,
      can_delete: true,
      can_reset: false,
      icon_slug: value.icon_slug || "BadgeHelp",
      icon_color: value.icon_color || null,
      name: value.name || "Preview",
      description: value.description || null,
      excludes_from_balancer: value.excludes_from_balancer,
      excludes_from_ready: value.excludes_from_ready
    }),
    [value]
  );
  const selectedIconSlug = value.icon_slug || "BadgeHelp";
  // `icon_color` is workspace data, not a semantic tone, so it stays an inline
  // style. The slug beside it carries the meaning; the icon is decoration.
  const selectedIcon = createElement(getStatusIcon(selectedIconSlug), {
    className: "size-4",
    "aria-hidden": true,
    style: value.icon_color ? { color: value.icon_color } : undefined
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-scope`}>Scope</Label>
          <Select
            value={value.scope}
            onValueChange={(nextScope) => onChange({ ...value, scope: nextScope as StatusScope })}
          >
            <SelectTrigger id={`${fieldId}-scope`} disabled={disableScope}>
              <SelectValue placeholder="Select scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="registration">Registration</SelectItem>
              <SelectItem value="balancer">Balancer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name`}>Name</Label>
          <Input
            id={`${fieldId}-name`}
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            placeholder="Awaiting captain"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-icon`}>Icon</Label>
          <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen} modal={false}>
            <PopoverTrigger asChild>
              <Button
                id={`${fieldId}-icon`}
                variant="outline"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={iconPickerOpen}
                className="w-full justify-between"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {selectedIcon}
                  <span className="truncate">{selectedIconSlug}</span>
                </span>
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] p-0"
              align="start"
            >
              <Command>
                <CommandInput placeholder="Search icons…" />
                <CommandList className="max-h-64">
                  <CommandEmpty>No icon matches that name. Try a shorter word.</CommandEmpty>
                  <CommandGroup>
                    {STATUS_ICON_OPTIONS.map(({ slug, Icon }) => (
                      <CommandItem
                        key={slug}
                        value={slug}
                        onSelect={(nextSlug) => {
                          onChange({ ...value, icon_slug: nextSlug });
                          setIconPickerOpen(false);
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon
                            className="size-4"
                            aria-hidden
                            style={value.icon_color ? { color: value.icon_color } : undefined}
                          />
                          <span className="truncate">{slug}</span>
                        </span>
                        <Check
                          aria-hidden
                          className={cn(
                            "ml-auto size-4",
                            value.icon_slug === slug ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <StatusColorPicker
          value={value.icon_color}
          onChange={(nextColor) => onChange({ ...value, icon_color: nextColor })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-description`}>Description</Label>
        <Textarea
          id={`${fieldId}-description`}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          placeholder="Used when a player is waiting for a captain confirmation."
        />
      </div>
      {value.scope === "balancer" && !isBuiltin ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div className="space-y-0.5">
            <Label htmlFor={`${fieldId}-excludes`}>Excludes from balancer pool</Label>
            <p className="text-xs text-muted-foreground">
              A registration holding this status is treated as removed from the balancer pool,
              the same way the builtin &quot;Excluded&quot; status works.
            </p>
          </div>
          <Switch
            id={`${fieldId}-excludes`}
            checked={value.excludes_from_balancer}
            onCheckedChange={(checked) => onChange({ ...value, excludes_from_balancer: checked })}
          />
        </div>
      ) : null}
      {value.scope === "balancer" && !isBuiltin ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div className="space-y-0.5">
            <Label htmlFor={`${fieldId}-blocks-ready`}>Blocks Ready</Label>
            <p className="text-xs text-muted-foreground">
              A registration holding this status never counts as ready for the balancer, even
              once every role has a rank -- the same way the builtin &quot;Ready&quot; status is
              always excluded from this.
            </p>
          </div>
          <Switch
            id={`${fieldId}-blocks-ready`}
            checked={value.excludes_from_ready}
            onCheckedChange={(checked) => onChange({ ...value, excludes_from_ready: checked })}
          />
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-sm font-medium">Preview</p>
        <div className="rounded-lg border p-3">
          <StatusMetaBadge meta={previewMeta} fallbackValue="preview" />
        </div>
      </div>
    </div>
  );
}

export default function AdminBalancerPage() {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { canAccessPermission } = usePermissions();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<BalancerCustomStatus | null>(null);
  const [deletingStatus, setDeletingStatus] = useState<BalancerCustomStatus | null>(null);
  const [form, setForm] = useState<StatusFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  // D12: page is readable with team.read; mutations follow the server matrix (team.update).
  const canManageStatuses = canAccessPermission("team.update", workspaceId);

  const statusesQuery = useQuery({
    queryKey: ["balancer-admin", "status-catalog", workspaceId],
    queryFn: () => balancerAdminService.listStatusCatalog(workspaceId as number),
    enabled: workspaceId !== null
  });

  const invalidateStatuses = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["balancer-admin", "status-catalog", workspaceId]
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: BalancerCustomStatusCreateInput) =>
      balancerAdminService.createCustomStatus(workspaceId as number, data),
    onSuccess: async () => {
      await invalidateStatuses();
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      notify.success("Custom status created");
    },
    onError: (error) => {
      notify.apiError(error, { title: "Could not create the status" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ statusId, data }: { statusId: number; data: BalancerCustomStatusUpdateInput }) =>
      balancerAdminService.updateCustomStatus(workspaceId as number, statusId, data),
    onSuccess: async () => {
      await invalidateStatuses();
      setEditingStatus(null);
      setForm(EMPTY_FORM);
      notify.success("Custom status updated");
    },
    onError: (error) => {
      notify.apiError(error, { title: "Could not save the status" });
    }
  });

  const updateBuiltinMutation = useMutation({
    mutationFn: ({
      scope,
      slug,
      data
    }: {
      scope: StatusScope;
      slug: string;
      data: BalancerCustomStatusUpdateInput;
    }) =>
      balancerAdminService.upsertBuiltinStatusOverride(workspaceId as number, scope, slug, data),
    onSuccess: async () => {
      await invalidateStatuses();
      setEditingStatus(null);
      setForm(EMPTY_FORM);
      notify.success("System status updated");
    },
    onError: (error) => {
      notify.apiError(error, { title: "Could not save the system status override" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (statusId: number) =>
      balancerAdminService.deleteCustomStatus(workspaceId as number, statusId),
    onSuccess: async () => {
      await invalidateStatuses();
      setDeletingStatus(null);
      notify.success("Custom status deleted");
    },
    onError: (error) => {
      notify.apiError(error, { title: "Could not delete the status" });
    }
  });

  const resetBuiltinMutation = useMutation({
    mutationFn: ({ scope, slug }: { scope: StatusScope; slug: string }) =>
      balancerAdminService.resetBuiltinStatusOverride(workspaceId as number, scope, slug),
    onSuccess: async () => {
      await invalidateStatuses();
      setDeletingStatus(null);
      notify.success("System status reset");
    },
    onError: (error) => {
      notify.apiError(error, { title: "Could not reset the system status" });
    }
  });

  const grouped = useMemo(() => {
    const rows = statusesQuery.data ?? [];
    return {
      registration: {
        system: rows.filter((row) => row.scope === "registration" && row.kind === "builtin"),
        custom: rows.filter((row) => row.scope === "registration" && row.kind === "custom")
      },
      balancer: {
        system: rows.filter((row) => row.scope === "balancer" && row.kind === "builtin"),
        custom: rows.filter((row) => row.scope === "balancer" && row.kind === "custom")
      }
    };
  }, [statusesQuery.data]);

  const openCreate = (scope: StatusScope) => {
    setForm({ ...EMPTY_FORM, scope });
    setCreateOpen(true);
  };

  const openEdit = (statusRow: BalancerCustomStatus) => {
    setEditingStatus(statusRow);
    setForm({
      scope: statusRow.scope,
      icon_slug: statusRow.icon_slug ?? "",
      icon_color: statusRow.icon_color ?? "",
      name: statusRow.name,
      description: statusRow.description ?? "",
      excludes_from_balancer: statusRow.excludes_from_balancer,
      excludes_from_ready: statusRow.excludes_from_ready
    });
  };

  const submitCreate = () => {
    if (!form.name.trim()) {
      setFormError("Give the status a name before creating it.");
      return;
    }
    setFormError(null);
    createMutation.mutate({
      scope: form.scope,
      icon_slug: form.icon_slug || null,
      icon_color: form.icon_color || null,
      name: form.name,
      description: form.description || null,
      excludes_from_balancer: form.scope === "balancer" ? form.excludes_from_balancer : false,
      excludes_from_ready: form.scope === "balancer" ? form.excludes_from_ready : false
    });
  };

  const submitEdit = () => {
    if (!editingStatus) return;
    if (!form.name.trim()) {
      setFormError("Give the status a name before saving it.");
      return;
    }
    setFormError(null);
    if (editingStatus.kind === "builtin") {
      updateBuiltinMutation.mutate({
        scope: editingStatus.scope,
        slug: editingStatus.slug,
        data: {
          icon_slug: form.icon_slug || null,
          icon_color: form.icon_color || null,
          name: form.name,
          description: form.description || null
        }
      });
      return;
    }
    updateMutation.mutate({
      statusId: editingStatus.id,
      data: {
        icon_slug: form.icon_slug || null,
        icon_color: form.icon_color || null,
        name: form.name,
        description: form.description || null,
        excludes_from_balancer: editingStatus.scope === "balancer" ? form.excludes_from_balancer : false,
        excludes_from_ready: editingStatus.scope === "balancer" ? form.excludes_from_ready : false
      }
    });
  };

  if (workspaceId === null) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Balancer"
          description="Select a workspace to manage custom balancer statuses."
        />
        <p className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
          Pick a workspace in the sidebar to manage its registration and balancer statuses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Balancer"
        description="Manage workspace-specific custom statuses for registration and balancer flows."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        {(["registration", "balancer"] as const).map((scope) => (
          <Card key={scope}>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle asChild>
                  <h2>{scope === "registration" ? "Registration statuses" : "Balancer statuses"}</h2>
                </CardTitle>
                <CardDescription>
                  Built-in statuses stay system-controlled. Custom statuses add extra labels for
                  this workspace.
                </CardDescription>
              </div>
              {canManageStatuses ? (
                <Button size="sm" onClick={() => openCreate(scope)}>
                  <Plus className="mr-2 size-4" aria-hidden />
                  Add status
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {statusesQuery.isLoading ? (
                <Skeleton className="h-64 w-full rounded-md" />
              ) : (
                <>
                  <div className="space-y-2">
                    <h3 className={EYEBROW_CLASS}>System</h3>
                    <div className="rounded-md border">
                      <Table>
                        <BalancerStatusTableHead />
                        <TableBody>
                          {grouped[scope].system.map((statusRow) => (
                            <TableRow key={`${statusRow.scope}-${statusRow.slug}`}>
                              <TableCell>
                                <StatusMetaBadge
                                  meta={{
                                    value: statusRow.slug,
                                    scope: statusRow.scope,
                                    is_builtin: true,
                                    kind: "builtin",
                                    is_override: statusRow.is_override,
                                    can_edit: true,
                                    can_delete: false,
                                    can_reset: statusRow.can_reset,
                                    icon_slug: statusRow.icon_slug,
                                    icon_color: statusRow.icon_color,
                                    name: statusRow.name,
                                    description: statusRow.description,
                                    excludes_from_balancer: statusRow.excludes_from_balancer,
                                    excludes_from_ready: statusRow.excludes_from_ready
                                  }}
                                  fallbackValue={statusRow.slug}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">{statusRow.slug}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {statusRow.description ?? "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  {canManageStatuses ? (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => openEdit(statusRow)}
                                      aria-label={`Edit the ${statusRow.name} system status`}
                                    >
                                      <Pencil className="size-4" aria-hidden />
                                    </Button>
                                  ) : null}
                                  {canManageStatuses && statusRow.can_reset ? (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setDeletingStatus(statusRow)}
                                      aria-label={`Reset the ${statusRow.name} system status to its default appearance`}
                                    >
                                      <Trash2 className="size-4" aria-hidden />
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className={EYEBROW_CLASS}>Custom</h3>
                    <div className="rounded-md border">
                      <Table>
                        <BalancerStatusTableHead />
                        <TableBody>
                          {grouped[scope].custom.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-sm text-muted-foreground">
                                {canManageStatuses
                                  ? "No custom statuses yet. Use “Add status” to create one for this workspace."
                                  : "No custom statuses yet."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            grouped[scope].custom.map((statusRow) => (
                              <TableRow key={statusRow.id}>
                                <TableCell>
                                  <StatusMetaBadge
                                    meta={{
                                      value: statusRow.slug,
                                      scope: statusRow.scope,
                                      is_builtin: false,
                                      kind: "custom",
                                      is_override: false,
                                      can_edit: true,
                                      can_delete: true,
                                      can_reset: false,
                                      icon_slug: statusRow.icon_slug,
                                      icon_color: statusRow.icon_color,
                                      name: statusRow.name,
                                      description: statusRow.description,
                                      excludes_from_balancer: statusRow.excludes_from_balancer,
                                      excludes_from_ready: statusRow.excludes_from_ready
                                    }}
                                    fallbackValue={statusRow.slug}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-xs">{statusRow.slug}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  <div className="flex items-center gap-2">
                                    <span>{statusRow.description ?? "—"}</span>
                                    {statusRow.excludes_from_balancer ? (
                                      <span
                                        className={cn(
                                          "whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                          TONE_CLASS.warning
                                        )}
                                      >
                                        Excludes pool
                                      </span>
                                    ) : null}
                                    {statusRow.excludes_from_ready ? (
                                      <span
                                        className={cn(
                                          "whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                          TONE_CLASS.warning
                                        )}
                                      >
                                        Blocks ready
                                      </span>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    {canManageStatuses ? (
                                      <>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={() => openEdit(statusRow)}
                                          aria-label={`Edit the ${statusRow.name} custom status`}
                                        >
                                          <Pencil className="size-4" aria-hidden />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={() => setDeletingStatus(statusRow)}
                                          aria-label={`Delete the ${statusRow.name} custom status`}
                                        >
                                          <Trash2 className="size-4" aria-hidden />
                                        </Button>
                                      </>
                                    ) : null}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>


      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setFormError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create custom status</DialogTitle>
            <DialogDescription>
              The slug is generated automatically from the name and stays stable after edits.
            </DialogDescription>
          </DialogHeader>
          <StatusForm value={form} onChange={setForm} />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={createMutation.isPending || !canManageStatuses}
            >
              {createMutation.isPending ? "Creating…" : "Create status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingStatus !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingStatus(null);
            setForm(EMPTY_FORM);
            setFormError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingStatus?.kind === "builtin" ? "Edit system status" : "Edit custom status"}
            </DialogTitle>
            <DialogDescription>
              {editingStatus?.kind === "builtin"
                ? "Save a workspace override for this system status without changing its slug or workflow."
                : "Update visual metadata without changing the stored slug."}
            </DialogDescription>
          </DialogHeader>
          <StatusForm
            value={form}
            onChange={setForm}
            disableScope
            isBuiltin={editingStatus?.kind === "builtin"}
          />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStatus(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitEdit}
              disabled={
                updateMutation.isPending || updateBuiltinMutation.isPending || !canManageStatuses
              }
            >
              {updateMutation.isPending || updateBuiltinMutation.isPending
                ? "Saving…"
                : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deletingStatus !== null}
        onOpenChange={(open) => !open && setDeletingStatus(null)}
        onConfirm={() => {
          if (!deletingStatus) return;
          if (deletingStatus.kind === "builtin") {
            resetBuiltinMutation.mutate({
              scope: deletingStatus.scope,
              slug: deletingStatus.slug
            });
            return;
          }
          deleteMutation.mutate(deletingStatus.id);
        }}
        isDeleting={deleteMutation.isPending || resetBuiltinMutation.isPending}
        title={deletingStatus?.kind === "builtin" ? "Reset system status" : "Delete custom status"}
        description={
          deletingStatus?.kind === "builtin"
            ? `“${deletingStatus?.name}” goes back to its default built-in name, icon and color. The workspace override is discarded.`
            : `“${deletingStatus?.name}” is removed from the catalog. Registrations already using it keep the raw slug, and the server refuses the delete if the status is still in use.`
        }
        confirmLabel={deletingStatus?.kind === "builtin" ? "Reset status" : "Delete status"}
        confirmingLabel={deletingStatus?.kind === "builtin" ? "Resetting…" : "Deleting…"}
        confirmVariant={deletingStatus?.kind === "builtin" ? "default" : "destructive"}
      />
    </div>
  );
}
