// The step model the page drives; apart from `BalancerOperationDialog` so the
// dialog itself can be a lazy chunk.
export type BalancerOperationStepStatus = "pending" | "running" | "succeeded" | "failed";

export type BalancerOperationStep = {
  id: string;
  label: string;
  description?: string;
  status: BalancerOperationStepStatus;
};

export type BalancerOperationStepDefinition = Omit<BalancerOperationStep, "status">;

export function createOperationSteps(
  definitions: BalancerOperationStepDefinition[]
): BalancerOperationStep[] {
  return definitions.map((step) => ({ ...step, status: "pending" }));
}

export function updateOperationStepStatus(
  steps: BalancerOperationStep[],
  stepId: string,
  status: BalancerOperationStepStatus
): BalancerOperationStep[] {
  return steps.map((step) => (step.id === stepId ? { ...step, status } : step));
}
