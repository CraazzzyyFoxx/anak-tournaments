"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { RuleBuilder, type RuleLeafFieldsProps } from "@/components/rule-builder";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { achievementQueryKeys } from "@/lib/achievements/query-keys";
import { DEFAULT_CONDITION_TYPE, useConditionText } from "@/lib/achievements/condition-text";

import { ConditionLeafFields } from "./ConditionLeafFields";
import { createSidebarGroups } from "./condition-flow.model";

interface ConditionFlowEditorProps {
  value: Record<string, unknown>;
  onChange?: (tree: Record<string, unknown>) => void;
  readOnly?: boolean;
}

/**
 * The achievement `condition_tree` editor: the shared rule builder wired to the
 * engine's registry.
 *
 * The node list comes from `achievements/rules/condition-types` rather than a
 * local copy, which drifted eight nodes behind the backend; `required`/
 * `optional` come from the same place the validator reads.
 */
export function ConditionFlowEditor({ value, onChange, readOnly }: Readonly<ConditionFlowEditorProps>) {
  const t = useTranslations("adminAchievements");
  const { leafLabel, leafLine } = useConditionText(value);
  const labels = useMemo(() => ({
    outlineTitle: t("condition.treeOutline"),
    outlineGroup: (path: string, op: string) =>
      t("condition.outlineGroup", { path, operator: op }),
    paletteSearchPlaceholder: t("condition.searchNodes"),
    paletteSearchLabel: t("condition.searchLabel"),
    paletteHint: t("condition.hint"),
    paletteEmpty: (query: string) => t("condition.empty", { query }),
    paletteAdd: (item: string) => t("condition.addToTree", { item }),
    groupName: (path: string) => t("condition.group", { path }),
    operatorLabel: (group: string) => t("condition.operatorFor", { group }),
    addLeaf: t("condition.addCondition"),
    addLeafLabel: (group: string) => t("condition.addInside", { group }),
    addGroup: t("condition.addGroup"),
    addGroupLabel: (group: string) => t("condition.addNested", { group }),
    deleteGroupLabel: (group: string) => t("condition.deleteGroup", { group }),
    deleteLeafLabel: (label: string, path: string) => t("condition.deleteCondition", { label, path }),
    leafTypeLabel: (path: string) => t("condition.typeFor", { path }),
    leafFieldLabel: (field: string, label: string, path: string) => t("condition.fieldFor", { field, label, path }),
    fullscreen: t("condition.fullscreen"),
    fullscreenLabel: t("condition.fullscreenLabel"),
    exitFullscreen: t("condition.exitFullscreen"),
    exitFullscreenLabel: t("condition.exitFullscreenLabel"),
  }), [t]);
  const palette = useMemo(() => createSidebarGroups(t as unknown as (key: string) => string), [t]);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // The registry only changes when the engine ships a new node, so it is cached
  // for the session rather than refetched per editor mount.
  const { data: conditionTypes } = useQuery({
    queryKey: achievementQueryKeys.conditionTypes(workspaceId),
    queryFn: () => adminService.getConditionTypes(workspaceId!),
    enabled: !!workspaceId,
    staleTime: Infinity
  });

  // Sub-condition-only predicates (`player_role`, `player_div`) are rejected at
  // the top level by the validator, so they are not offered here.
  const leafOptions = useMemo(
    () =>
      (conditionTypes ?? [])
        .filter((option) => !option.subcondition_only)
        .map((option) => ({ value: option.name, label: leafLabel(option.name) })),
    [conditionTypes, leafLabel]
  );

  const renderLeafFields = useCallback(
    ({ nodeId, leafType, params, setParam, controlName }: RuleLeafFieldsProps) => (
      <ConditionLeafFields
        nodeId={nodeId}
        conditionType={leafType}
        params={params}
        setParam={setParam}
        controlName={controlName}
      />
    ),
    []
  );

  return (
    <RuleBuilder
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      leafOptions={leafOptions}
      defaultLeafType={DEFAULT_CONDITION_TYPE}
      palette={palette}
      renderLeafFields={renderLeafFields}
      labelForLeaf={leafLabel}
      summarizeLeaf={leafLine}
      labels={labels}
    />
  );
}
