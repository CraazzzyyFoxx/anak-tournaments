// The step model the page drives; apart from `BalancerOperationDialog` so the
// dialog itself can be a lazy chunk. The dialog names each step from
// `balancerTool.page.operation.steps.<id>`.
export type BalancerOperationStepStatus = "pending" | "running" | "succeeded" | "failed";

export type BalancerOperationStepId = "validate" | "save" | "export" | "refresh" | "read" | "load";

export type BalancerOperationStep = {
  id: BalancerOperationStepId;
  status: BalancerOperationStepStatus;
};

export function createOperationSteps(
  ids: readonly BalancerOperationStepId[]
): BalancerOperationStep[] {
  return ids.map((id) => ({ id, status: "pending" }));
}

export function updateOperationStepStatus(
  steps: BalancerOperationStep[],
  stepId: string,
  status: BalancerOperationStepStatus
): BalancerOperationStep[] {
  return steps.map((step) => (step.id === stepId ? { ...step, status } : step));
}
