"use client";

import React from "react";
import { useTranslations } from "next-intl";

import { PageStateCard } from "@/components/ui/page-state-card";
import { cn } from "@/lib/utils";

import styles from "../TournamentDetail.module.css";

type StateCopy = {
  title?: string;
  description?: string;
  className?: string;
};

type TournamentPageStateProps =
  | (StateCopy & {
      state: "initial-error";
      onRetry: () => void;
      children?: never;
      onReset?: never;
      isUpdating?: never;
    })
  | (StateCopy & {
      state: "refresh-error";
      onRetry: () => void;
      children: React.ReactNode;
      isUpdating?: boolean;
      onReset?: never;
    })
  | (StateCopy & {
      state: "empty";
      children?: never;
      onRetry?: never;
      onReset?: never;
      isUpdating?: never;
    })
  | (StateCopy & {
      state: "filtered-empty";
      onReset: () => void;
      children?: never;
      onRetry?: never;
      isUpdating?: never;
    });

/**
 * Tournament-flavoured wrapper over the site-wide `PageStateCard`.
 *
 * The three terminal states are the shared card verbatim, so the tournament
 * pages no longer carry their own empty/error design. `refresh-error` stays
 * bespoke on purpose: it is the only state that must render *below* stale
 * content rather than replace it, so it keeps the module-CSS strip layout.
 */
export function TournamentPageState(props: TournamentPageStateProps) {
  const t = useTranslations();

  if (props.state === "refresh-error") {
    const title = props.title ?? t("tournamentDetail.pageState.refreshError.title");
    const description =
      props.description ?? t("tournamentDetail.pageState.refreshError.description");

    return (
      <div className={cn(styles.refreshState, props.className)}>
        {props.children}
        <div className={styles.refreshMessage} role="status" aria-live="polite">
          <span>
            <strong>{title}</strong> — {description}
          </span>
          <button type="button" className={styles.stateAction} onClick={props.onRetry}>
            {t("tournamentDetail.pageState.retry")}
          </button>
        </div>
        {props.isUpdating ? (
          <span className={styles.updating}>{t("tournamentDetail.pageState.updating")}</span>
        ) : null}
      </div>
    );
  }

  if (props.state === "initial-error") {
    return (
      <PageStateCard
        state="error"
        title={props.title ?? t("tournamentDetail.pageState.initialError.title")}
        description={
          props.description ?? t("tournamentDetail.pageState.initialError.description")
        }
        actionLabel={t("tournamentDetail.pageState.retry")}
        onAction={props.onRetry}
        className={props.className}
      />
    );
  }

  if (props.state === "filtered-empty") {
    return (
      <PageStateCard
        state="filtered-empty"
        title={props.title ?? t("tournamentDetail.pageState.filteredEmpty.title")}
        description={
          props.description ?? t("tournamentDetail.pageState.filteredEmpty.description")
        }
        actionLabel={t("tournamentDetail.pageState.resetFilters")}
        onAction={props.onReset}
        className={props.className}
      />
    );
  }

  return (
    <PageStateCard
      state="empty"
      title={props.title ?? t("tournamentDetail.pageState.empty.title")}
      description={props.description ?? t("tournamentDetail.pageState.empty.description")}
      className={props.className}
    />
  );
}
