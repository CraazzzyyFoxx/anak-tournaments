import type { FilterDef } from "@/components/kit/useFilters";
import type { AdminSessionStatus } from "@/types/rbac.types";

import { STATUS_META } from "./model";

/** `t` is the `adminAccess.common` translator of the browser that renders the chips. */
export function sessionFilterDefs(t: (key: "status" | AdminSessionStatus) => string): FilterDef[] {
  return [
    {
      key: "status",
      label: t("status"),
      kind: "single",
      options: (Object.keys(STATUS_META) as AdminSessionStatus[]).map((status) => ({
        value: status,
        label: t(status)
      }))
    }
  ];
}
