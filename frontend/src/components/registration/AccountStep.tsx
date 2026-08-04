import { useTranslations } from "next-intl";

import type { RegistrationForm, SubscriptionStatus } from "@/types/registration.types";
import type { SocialAccount } from "@/types/user.types";
import AccountCombobox from "./AccountCombobox";
import VerifiedAccountSelect from "./VerifiedAccountSelect";
import SmurfTagsInput from "./SmurfTagsInput";
import FormField from "./FormField";
import SubscriptionRow from "./SubscriptionRow";
import SubscriptionRuleNotice from "./SubscriptionRuleNotice";
import { ArrowRight, Link2, UserRound } from "lucide-react";

interface AccountStepProps {
  values: Record<string, string>;
  onUpdate: (key: string, value: string) => void;
  smurfTags: string[];
  onSmurfTagsChange: (tags: string[]) => void;
  onBuiltInValidationChange: (fieldKey: string, error: string | null) => void;
  form: RegistrationForm;
  battleTagSuggestions: string[];
  discordSuggestions: string[];
  twitchSuggestions: string[];
  boostySuggestions?: string[];
  mode?: "public" | "admin";
  displayName?: string;
  onDisplayNameChange?: (v: string) => void;
  /** Registrant's social accounts — drives the verified-account picker. */
  accounts?: readonly SocialAccount[];
  /** Per-field `require_verified` errors, computed by the parent. */
  verifiedErrors?: Record<string, string | null>;
  /** Public mode only: open profile settings so the user can link accounts. */
  onLinkAccounts?: () => void;
  /** Server-resolved subscription standing; drives the per-row chips. */
  subscription?: SubscriptionStatus | null;
  /** Redeem a challenge code; resolves once the server answers. */
  onRedeemCode?: (code: string) => Promise<void>;
}

export default function AccountStep({
  values,
  onUpdate,
  smurfTags,
  onSmurfTagsChange,
  onBuiltInValidationChange,
  form,
  battleTagSuggestions,
  discordSuggestions,
  twitchSuggestions,
  boostySuggestions = [],
  mode = "public",
  displayName,
  onDisplayNameChange,
  accounts = [],
  verifiedErrors = {},
  onLinkAccounts,
  subscription,
  onRedeemCode,
}: AccountStepProps) {
  const t = useTranslations();
  const fields = form.built_in_fields;
  const showBattleTag = fields?.battle_tag?.enabled !== false;
  const showSmurfTags = fields?.smurf_tags?.enabled !== false;
  const showDiscord = fields?.discord_nick?.enabled !== false;
  const showTwitch = fields?.twitch_nick?.enabled !== false;
  const showBoosty = fields?.boosty_nick?.enabled !== false;
  // ``require_verified`` only applies to public self-registration (it gates on
  // the registrant's own OAuth-verified accounts); admin editing is unconstrained.
  const requireVerified = (key: string) =>
    mode === "public" && fields?.[key]?.require_verified === true;

  return (
    <div className="grid gap-4">
      <SubscriptionRuleNotice subscription={subscription} />

      {mode === "public" && accounts.length === 0 && onLinkAccounts && (
        <button
          type="button"
          onClick={onLinkAccounts}
          className="flex w-full items-start gap-3 rounded-lg border border-[color:var(--aqt-border-2)] bg-[color:var(--aqt-overlay-2)] p-3 text-left transition-colors hover:bg-[color:var(--aqt-overlay-3)]"
        >
          <Link2 className="mt-0.5 size-4 shrink-0 text-[color:var(--aqt-fg-muted)]" />
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-[color:var(--aqt-fg)]">
              {t("registration.accounts.noAccountsHint")}
            </div>
            <div className="text-xs leading-5 text-[color:var(--aqt-fg-dim)]">
              {t("registration.accounts.noAccountsHintDesc")}
            </div>
            <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[color:var(--aqt-fg)]">
              {t("registration.accounts.noAccountsHintCta")}
              <ArrowRight className="size-3" />
            </div>
          </div>
        </button>
      )}

      {mode === "admin" && onDisplayNameChange && (
        <FormField
          label="Display Name"
          icon={<UserRound className="size-3.5 opacity-50" />}
          placeholder="Display name"
          value={displayName ?? ""}
          onChange={onDisplayNameChange}
        />
      )}


      {showBattleTag && (
        requireVerified("battle_tag") ? (
          <VerifiedAccountSelect
            label={t("registration.accounts.battleTag")}
            provider="battlenet"
            accounts={accounts}
            value={values.battle_tag ?? ""}
            onChange={(v) => onUpdate("battle_tag", v)}
            required
            error={verifiedErrors.battle_tag}
          />
        ) : (
          <AccountCombobox
            label={t("registration.accounts.battleTag")}
            placeholder="Player#1234"
            value={values.battle_tag ?? ""}
            onChange={(v) => onUpdate("battle_tag", v)}
            suggestions={battleTagSuggestions}
            icon="/battlenet.svg"
            required={fields?.battle_tag?.required === true}
            fieldKey="battle_tag"
            config={fields?.battle_tag}
            onValidationChange={(error) => onBuiltInValidationChange("battle_tag", error)}
          />
        )
      )}

      {showSmurfTags && (
        <SmurfTagsInput
          tags={smurfTags}
          onChange={onSmurfTagsChange}
          suggestions={battleTagSuggestions.filter((t) => t !== (values.battle_tag ?? ""))}
          icon="/battlenet.svg"
          required={fields?.smurf_tags?.required === true}
          config={fields?.smurf_tags}
          onValidationChange={(error) => onBuiltInValidationChange("smurf_tags", error)}
        />
      )}

      {showDiscord && (
        requireVerified("discord_nick") ? (
          <VerifiedAccountSelect
            label={t("registration.accounts.discord")}
            provider="discord"
            accounts={accounts}
            value={values.discord_nick ?? ""}
            onChange={(v) => onUpdate("discord_nick", v)}
            required
            error={verifiedErrors.discord_nick}
          />
        ) : (
          <AccountCombobox
            label={t("registration.accounts.discord")}
            placeholder={t("registration.accounts.discordPlaceholder")}
            value={values.discord_nick ?? ""}
            onChange={(v) => onUpdate("discord_nick", v)}
            suggestions={discordSuggestions}
            icon="/discord-white.svg"
            required={fields?.discord_nick?.required === true}
            fieldKey="discord_nick"
            config={fields?.discord_nick}
            onValidationChange={(error) => onBuiltInValidationChange("discord_nick", error)}
          />
        )
      )}

      {showTwitch && (
        <div className="grid gap-1.5">
          {requireVerified("twitch_nick") ? (
            <VerifiedAccountSelect
              label={t("registration.accounts.twitch")}
              provider="twitch"
              accounts={accounts}
              value={values.twitch_nick ?? ""}
              onChange={(v) => onUpdate("twitch_nick", v)}
              required
              error={verifiedErrors.twitch_nick}
            />
          ) : (
            <AccountCombobox
              label={t("registration.accounts.twitch")}
              placeholder={t("registration.accounts.twitchPlaceholder")}
              value={values.twitch_nick ?? ""}
              onChange={(v) => onUpdate("twitch_nick", v)}
              suggestions={twitchSuggestions}
              icon="/twitch.png"
              required={fields?.twitch_nick?.required === true}
              fieldKey="twitch_nick"
              config={fields?.twitch_nick}
              onValidationChange={(error) => onBuiltInValidationChange("twitch_nick", error)}
            />
          )}
          {/* Twitch has a real API, so no challenge code here — only the chip and,
              when the stored token predates the subscriptions scope, a reconnect. */}
          <SubscriptionRow
            provider="twitch"
            providerLabel="Twitch"
            subscription={subscription}
            onLinkAccounts={onLinkAccounts}
          />
        </div>
      )}

      {showBoosty && (
        <div className="grid gap-1.5">
          <AccountCombobox
            label={t("registration.accounts.boosty")}
            placeholder={t("registration.accounts.boostyPlaceholder")}
            value={values.boosty_nick ?? ""}
            onChange={(v) => onUpdate("boosty_nick", v)}
            suggestions={boostySuggestions}
            icon="/boosty.svg"
            required={fields?.boosty_nick?.required === true}
            fieldKey="boosty_nick"
            config={fields?.boosty_nick}
            onValidationChange={(error) => onBuiltInValidationChange("boosty_nick", error)}
          />
          {/* The nickname above is self-declared — Boosty has no OAuth and neither
              viable path reveals the handle. What is actually verified is the
              SUBSCRIPTION, shown here. */}
          <SubscriptionRow
            provider="boosty"
            providerLabel="Boosty"
            subscription={subscription}
            onLinkAccounts={onLinkAccounts}
            onRedeemCode={onRedeemCode}
          />
        </div>
      )}
    </div>
  );
}
