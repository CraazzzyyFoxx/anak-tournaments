import { useEffect, useId } from "react";
import type { RegistrationForm } from "@/types/registration.types";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import CustomField from "./CustomField";
import FieldLabel from "./FieldLabel";
import FormField, { fieldControlClass } from "./FormField";
import { getBuiltInFieldValidationError } from "./validation";
import { BadgeInfo } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DetailsStepProps {
  values: Record<string, string>;
  onUpdate: (key: string, value: string) => void;
  onFieldValidationChange: (fieldKey: string, error: string | null) => void;
  form: RegistrationForm;
  mode?: "public" | "admin";
  adminNotes?: string;
  onAdminNotesChange?: (v: string) => void;
  status?: string;
  onStatusChange?: (v: string) => void;
  balancerStatus?: string;
  onBalancerStatusChange?: (v: string) => void;
  registrationStatusOptions?: {
    system: Array<{ value: string; name: string }>;
    custom: Array<{ value: string; name: string }>;
  };
  balancerStatusOptions?: {
    system: Array<{ value: string; name: string }>;
    custom: Array<{ value: string; name: string }>;
  };
}

export default function DetailsStep({
  values,
  onUpdate,
  onFieldValidationChange,
  form,
  mode = "public",
  adminNotes,
  onAdminNotesChange,
  status,
  onStatusChange,
  balancerStatus,
  onBalancerStatusChange,
  registrationStatusOptions,
  balancerStatusOptions,
}: Readonly<DetailsStepProps>) {
  const t = useTranslations();
  const streamPovId = useId();
  const statusId = useId();
  const balancerStatusId = useId();
  const fields = form.built_in_fields;
  const showNotes = fields?.notes?.enabled !== false;
  const showStreamPov = fields?.stream_pov?.enabled === true;
  const notesValidationError = showNotes ? getBuiltInFieldValidationError(
    "notes",
    values.notes ?? "",
    fields?.notes,
    t,
  ) : null;

  useEffect(() => {
    onFieldValidationChange("notes", notesValidationError);
  }, [notesValidationError, onFieldValidationChange]);

  return (
    <div className="grid gap-4">
      {showStreamPov && (
        <div className="space-y-2">
          <FieldLabel
            label={mode === "admin" ? "Stream POV" : t("registration.details.streamPov")}
            htmlFor={streamPovId}
            required={fields?.stream_pov?.required === true}
          />
          {/* Radix Switch renders a <button>; a wrapping <label> would not
              associate it, so the id/htmlFor pair carries the name. */}
          <div className="flex items-center gap-3">
            <Switch
              id={streamPovId}
              checked={values.stream_pov === "true"}
              onCheckedChange={(checked) => onUpdate("stream_pov", checked ? "true" : "false")}
            />
            <span className="text-sm text-[color:var(--aqt-fg-muted)]">
              {mode === "admin"
                ? "Participant can provide a point-of-view stream."
                : t("registration.details.streamPovLabel")}
            </span>
          </div>
        </div>
      )}

      {showNotes && (
        <FormField
          multiline
          label={mode === "admin" ? "Public Notes" : t("registration.details.notes")}
          required={fields?.notes?.required === true}
          placeholder={mode === "admin" ? "Visible notes for balancer-facing context" : t("registration.details.notesPlaceholder")}
          value={values.notes ?? ""}
          onChange={(v) => onUpdate("notes", v)}
          error={notesValidationError}
        />
      )}

      {/* Participant-facing data, so it belongs above the admin-only block and
          in BOTH modes. It used to be gated on `mode === "public"`, which left
          the admin editor unable to see or fix a single custom-field answer. */}
      {form.custom_fields.map((field) => (
        <CustomField
          key={field.key}
          definition={field}
          value={values[field.key] ?? ""}
          onChange={(v) => onUpdate(field.key, v)}
          onValidationChange={(error) => onFieldValidationChange(field.key, error)}
        />
      ))}

      {mode === "admin" && onAdminNotesChange && (
        <FormField
          multiline
          label="Admin Notes"
          icon={<BadgeInfo className="size-3.5 opacity-50" />}
          placeholder="Internal notes for admins only"
          value={adminNotes ?? ""}
          onChange={onAdminNotesChange}
        />
      )}

      {mode === "admin" && onStatusChange && registrationStatusOptions && (
        <div className="space-y-1.5">
          <FieldLabel
            label="Registration Status"
            htmlFor={statusId}
            icon={<BadgeInfo className="size-3.5 opacity-50" />}
          />
          <Select value={status ?? "pending"} onValueChange={onStatusChange}>
            <SelectTrigger
              id={statusId}
              className={cn(fieldControlClass, "h-9")}
            >
              <SelectValue placeholder="Select registration status" />
            </SelectTrigger>
            <SelectContent>
              {registrationStatusOptions.system.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.name} · System
                </SelectItem>
              ))}
              {registrationStatusOptions.custom.length > 0
                ? registrationStatusOptions.custom.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.name} · Custom
                    </SelectItem>
                  ))
                : null}
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === "admin" && onBalancerStatusChange && balancerStatusOptions && (
        <div className="space-y-1.5">
          <FieldLabel
            label="Balancer Status"
            htmlFor={balancerStatusId}
            icon={<BadgeInfo className="size-3.5 opacity-50" />}
          />
          <Select value={balancerStatus ?? "not_in_balancer"} onValueChange={onBalancerStatusChange}>
            <SelectTrigger
              id={balancerStatusId}
              className={cn(fieldControlClass, "h-9")}
            >
              <SelectValue placeholder="Select balancer status" />
            </SelectTrigger>
            <SelectContent>
              {balancerStatusOptions.system.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.name} · System
                </SelectItem>
              ))}
              {balancerStatusOptions.custom.length > 0
                ? balancerStatusOptions.custom.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.name} · Custom
                    </SelectItem>
                  ))
                : null}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

