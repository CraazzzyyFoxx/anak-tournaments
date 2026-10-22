"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  MoreHorizontal,
  Send,
  Trash2,
  UserCog,
  UserPlus
} from "lucide-react";

import { MAX_LOBBIES, lobbyLetter } from "@/app/balancer/mix/pickup-chrome";
import { ConfirmDialog } from "@/components/kit/ConfirmDialog";
import { InlineEditText } from "@/components/kit/InlineEditText";
import { BanPresetSelect, useBanPresetName } from "@/components/pick-ban/BanPresetSelect";
import { MixFormationControl } from "@/components/mix/MixFormationControl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Eyebrow, eyebrowClass } from "@/components/ui/eyebrow";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  CustomGame,
  CustomGameDiscordPost,
  MixSelfSignup,
  MixTeamFormation
} from "@/services/custom-game.service";

/** Where an open signup seats a player. `closed` is the other half of the switch. */
const SIGNUP_DESTINATIONS = ["pool", "benched"] as const;

/** The trigger's dot: shut, open straight into the pool, or open onto the bench. */
const SIGNUP_DOT: Record<MixSelfSignup, string> = {
  closed: "bg-[color:var(--aqt-fg-faint)]",
  pool: "bg-[color:var(--aqt-teal)]",
  benched: "bg-[color:var(--aqt-amber)]"
};

/** The live signup post: the NEWEST `mix.signup` row, the one a re-post just created. */
export function signupPostOf(game: CustomGame): CustomGameDiscordPost | null {
  return (game.discord_posts ?? []).findLast((row) => row.kind === "mix.signup") ?? null;
}

/**
 * The mode a signup post goes out in. Posting the card IS opening signup
 * (`signup_post` writes the mode server-side), so a closed mix opens into the
 * pool -- and every label that triggers this says so.
 */
export function postModeOf(mode: MixSelfSignup): "pool" | "benched" {
  return mode === "benched" ? "benched" : "pool";
}

/** A post still standing in the channel, or about to: re-posting replaces it. */
function isLive(post: CustomGameDiscordPost | null) {
  return post?.status === "pending" || post?.status === "posted";
}

type PickupMixHeaderProps = {
  /** Host or co-host, and not-terminal -- gates every write action in this header. */
  canWrite: boolean;
  game: CustomGame | undefined;
  gameLoading: boolean;
  onOpenPool: () => void;
  /** The mix's game has roles to order (`MixOwner.showsRoles`); `false` hides "Players edit their own roles". */
  showsRoles: boolean;
  /** Omitted -- the name is read-only. Resolve/reject so the editor knows whether to close. */
  onRename?: (name: string) => Promise<unknown>;
  onOpenAccess: () => void;
  /** Workspace admin (or superuser) -- gates the irreversible hard delete,
   * a stronger grant than the host-or-co-host `canWrite` above. */
  canDelete?: boolean;
  deleting?: boolean;
  onDeleteMix?: () => void;
  /** Omitted -- the self-service row is not offered at all. */
  onSetSelfService?: (patch: { self_signup?: MixSelfSignup; self_role_edit?: boolean }) => void;
  savingSelfService?: boolean;
  /** Omitted -- the hero ban preset is shown read-only, as it is to every viewer. */
  onSetBanPreset?: (preset: string | null) => void;
  savingBanPreset?: boolean;
  /** Omitted -- the formation is shown read-only, as it is to every viewer. */
  onSetDraftSettings?: (settings: { team_formation: MixTeamFormation; draft_pick_seconds: number }) => void;
  savingDraftSettings?: boolean;
  /** Omitted -- the Discord menu offers no signup post. */
  onPostSignup?: (selfSignup: "pool" | "benched") => void;
  postingSignup?: boolean;
  /** Omitted -- the Discord menu lists no posts (and so no way to delete one). */
  onDeleteDiscordPost?: (postId: number) => void;
  deletingDiscordPost?: boolean;
  settingLobbyCount?: boolean;
  /** Omitted -- the lobby-count choice is not offered. */
  onLobbyCountChange?: (lobbyCount: number) => void;
};

/**
 * The mix this screen is open on: the way back to the list, its name and id,
 * and what a host does with it, by how often they do it.
 *
 * Visible: who may sign up, what Discord shows, and Add players -- the one
 * solid action. Behind `⋯`: what is set once per mix (how many lobbies, up to
 * `MAX_LOBBIES`, and co-hosts) and the irreversible delete. The shared
 * reshuffle across every lobby is a lineup action, so it sits with Balance
 * teams under the matchup, not up here.
 *
 * Which mix this is comes from the route, not from state this header owns --
 * switching to another one, or starting a new one, happens on the list at
 * `/balancer/mix`.
 */
export function PickupMixHeader({
  canWrite,
  game,
  gameLoading,
  onOpenPool,
  showsRoles,
  onOpenAccess,
  canDelete = false,
  deleting = false,
  onDeleteMix,
  onRename,
  onSetSelfService,
  savingSelfService = false,
  onSetBanPreset,
  savingBanPreset = false,
  onSetDraftSettings,
  savingDraftSettings = false,
  onPostSignup,
  postingSignup = false,
  onDeleteDiscordPost,
  deletingDiscordPost = false,
  settingLobbyCount = false,
  onLobbyCountChange
}: Readonly<PickupMixHeaderProps>) {
  const tm = useTranslations("mixes");
  const tl = useTranslations("mixes.lobbies");
  const th = useTranslations("mixes.header");
  const tb = useTranslations("pickBan.mixBans");
  const banPresetName = useBanPresetName();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dropLobbyOpen, setDropLobbyOpen] = useState(false);
  const lobbyCount = game?.lobby_count ?? 1;
  // What the slider shows while it is being dragged. The request only goes out
  // on release, so this follows the thumb and the mix's own count follows the
  // server. Reset during render when the mix's count changes under it (a
  // co-host's write landing, or this host's own confirm), React's own pattern.
  const [draftLobbyCount, setDraftLobbyCount] = useState(lobbyCount);
  const [syncedLobbyCount, setSyncedLobbyCount] = useState(lobbyCount);
  if (syncedLobbyCount !== lobbyCount) {
    setSyncedLobbyCount(lobbyCount);
    setDraftLobbyCount(lobbyCount);
  }
  // Dropping a lobby throws its balance away and clears the pins onto it, so it
  // is the direction that asks; opening one costs nothing. The names come from
  // the tab label, so the dialog calls them what the tabs do ("Lobby C").
  const droppedLobbies = Array.from(
    { length: Math.max(0, lobbyCount - draftLobbyCount) },
    (_, i) => tl("tab", { letter: lobbyLetter(draftLobbyCount + i) })
  ).join(", ");
  const offerDelete = canDelete && onDeleteMix != null;

  return (
    <Card variant="flat" className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Link
        href="/balancer/mix"
        className="flex shrink-0 items-center gap-1.5 text-caption text-[color:var(--aqt-fg-dim)] transition-colors hover:text-[color:var(--aqt-fg-muted)]"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {tm("title")}
      </Link>

      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-[color:var(--aqt-border)]" />

      <div className="flex min-w-[12rem] flex-1 items-center gap-2.5">
        {canWrite && game != null && onRename ? (
          <InlineEditText
            value={game.name}
            label={th("nameLabel")}
            onSave={onRename}
            className="min-w-0"
            textClassName="font-display text-xl font-bold tracking-[-0.01em] text-[color:var(--aqt-fg)]"
            inputClassName="h-8 max-w-sm"
          />
        ) : (
          <h1 className="min-w-0 truncate font-display text-xl font-bold tracking-[-0.01em] text-[color:var(--aqt-fg)]">
            {game?.name ?? (gameLoading ? "\u2026" : th("noMix"))}
          </h1>
        )}
        {game ? (
          <span className="shrink-0 text-caption font-semibold text-[color:var(--aqt-fg-dim)]">
            {`#${game.id}`}
          </span>
        ) : null}
      </div>

      {/* One block: when the row runs out of width it wraps as a whole, under
          the name, instead of orphaning the last button on a line of its own. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {game == null ? null : canWrite && onSetBanPreset ? (
          <BanPresetSelect
            discipline={game.discipline}
            label={tb("label")}
            value={game.hero_ban_preset}
            disabled={savingBanPreset}
            onChange={onSetBanPreset}
          />
        ) : (
          // Everyone reads which hero bans the next Start opens; only a host changes them.
          <span className="flex shrink-0 items-center gap-1.5 text-caption text-[color:var(--aqt-fg-dim)]">
            {tb("label")}
            <span className="font-semibold text-[color:var(--aqt-fg)]">{banPresetName(game.hero_ban_preset)}</span>
          </span>
        )}

        {game == null ? null : canWrite && onSetDraftSettings ? (
          <MixFormationControl
            idPrefix="mix-header"
            value={{ team_formation: game.team_formation, draft_pick_seconds: game.draft_pick_seconds }}
            disabled={savingDraftSettings}
            onChange={onSetDraftSettings}
          />
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-caption text-[color:var(--aqt-fg-dim)]">
            {th("formation")}
            <span className="font-semibold text-[color:var(--aqt-fg)]">
              {game.team_formation === "draft" ? th("formationDraft") : th("formationBalance")}
            </span>
          </span>
        )}

        {canWrite && game != null && onSetSelfService ? (
          <SignupSettings
            game={game}
            showsRoles={showsRoles}
            saving={savingSelfService}
            onSetSelfService={onSetSelfService}
          />
        ) : null}

        {canWrite && game != null && (onPostSignup || onDeleteDiscordPost) ? (
          <DiscordMenu
            game={game}
            posting={postingSignup}
            onPostSignup={onPostSignup}
            deleting={deletingDiscordPost}
            onDelete={onDeleteDiscordPost}
          />
        ) : null}

        {canWrite ? (
          <Button
            type="button"
            className="shrink-0"
            disabled={game == null}
            onClick={onOpenPool}
          >
            <UserPlus className="mr-1.5 size-3.5" aria-hidden="true" />
            {tm("start.addPlayers")}
          </Button>
        ) : null}

        {canWrite || offerDelete ? (
          <DropdownMenu>
            <IconTooltip control label={th("more")} className="shrink-0">
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={game == null}
                  aria-label={th("more")}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </IconTooltip>
            <DropdownMenuContent align="end" className="w-56">
              {canWrite && onLobbyCountChange ? (
                <>
                  <DropdownMenuLabel className={eyebrowClass()}>
                    {tl("countLabel")}
                  </DropdownMenuLabel>
                  {/* The slider lives inside a menu that owns the arrow keys
                      and closes on a click: both stay with the control. */}
                  <div
                    className="flex items-center gap-3 px-2 pb-2 pt-1"
                    onKeyDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerMove={(event) => event.stopPropagation()}
                  >
                    <Slider
                      aria-label={tl("countLabel")}
                      min={1}
                      max={MAX_LOBBIES}
                      step={1}
                      value={[draftLobbyCount]}
                      disabled={settingLobbyCount}
                      onValueChange={([next]) => setDraftLobbyCount(next)}
                      onValueCommit={([next]) => {
                        setDraftLobbyCount(next);
                        if (next === lobbyCount) return;
                        if (next < lobbyCount) setDropLobbyOpen(true);
                        else onLobbyCountChange(next);
                      }}
                    />
                    <span className="w-4 shrink-0 text-right text-caption font-semibold tabular-nums text-[color:var(--aqt-fg)]">
                      {draftLobbyCount}
                    </span>
                  </div>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {canWrite ? (
                <DropdownMenuItem onSelect={onOpenAccess}>
                  <UserCog aria-hidden="true" />
                  {th("access")}
                </DropdownMenuItem>
              ) : null}
              {offerDelete ? (
                <>
                  {canWrite ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    disabled={deleting}
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    {th("delete")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {canWrite && onLobbyCountChange ? (
        <ConfirmDialog
          open={dropLobbyOpen}
          onOpenChange={(open) => {
            setDropLobbyOpen(open);
            // Cancelled: the slider goes back to the count the mix still runs.
            if (!open) setDraftLobbyCount(lobbyCount);
          }}
          intent={{
            title: tl("dropTitle", { letters: droppedLobbies }),
            description: tl("dropDescription", { letters: droppedLobbies }),
            confirmLabel: tl("dropConfirm", { letters: droppedLobbies }),
            tone: "danger"
          }}
          pending={settingLobbyCount}
          onConfirm={() => {
            setDropLobbyOpen(false);
            onLobbyCountChange(draftLobbyCount);
          }}
        />
      ) : null}

      {offerDelete ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          intent={{
            title: th("deleteTitle"),
            description: th("deleteDescription", { name: game?.name ?? th("thisMix") }),
            confirmLabel: th("deleteConfirm"),
            tone: "danger"
          }}
          pending={deleting}
          onConfirm={() => {
            setDeleteOpen(false);
            onDeleteMix?.();
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * Who may sign up, and nothing else: Discord lives in its own menu.
 *
 * The column has three values but the host thinks in two steps -- is signup
 * open at all, and if so, where does a new player land -- so the popover asks
 * exactly that, and the trigger reads as a state ("Open · to the pool"), not
 * as a destination that looked like a button. Every control writes on change:
 * there is nothing to save or cancel.
 */
function SignupSettings({
  game,
  showsRoles,
  saving,
  onSetSelfService
}: Readonly<{
  game: CustomGame;
  showsRoles: boolean;
  saving: boolean;
  onSetSelfService: (patch: { self_signup?: MixSelfSignup; self_role_edit?: boolean }) => void;
}>) {
  const t = useTranslations("mixes.self");
  const mode = game.self_signup;
  const open = mode !== "closed";
  const stateLabel = t(`signupState.${mode}`);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={t("signupTrigger", { mode: stateLabel })}
          className="shrink-0 gap-2"
        >
          <Eyebrow>{t("signupLabel")}</Eyebrow>
          <span
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", SIGNUP_DOT[mode])}
          />
          {stateLabel}
          <ChevronDown className="size-3.5 text-[color:var(--aqt-fg-dim)]" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] space-y-3 p-3">
        <ToggleGroup
          type="single"
          variant="pill"
          aria-label={t("signupLabel")}
          value={open ? "open" : "closed"}
          onValueChange={(value) => {
            if ((value === "open") === open) return;
            onSetSelfService({ self_signup: value === "open" ? "pool" : "closed" });
          }}
          className="flex w-full"
        >
          <ToggleGroupItem value="closed" disabled={saving} className="flex-1 whitespace-nowrap px-2">
            {t("signupState.closed")}
          </ToggleGroupItem>
          <ToggleGroupItem value="open" disabled={saving} className="flex-1 whitespace-nowrap px-2">
            {t("signupOpen")}
          </ToggleGroupItem>
        </ToggleGroup>

        {open ? (
          <div className="space-y-2">
            <Eyebrow>{t("signupWhere")}</Eyebrow>
            <ToggleGroup
              type="single"
              variant="pill"
              aria-label={t("signupWhere")}
              value={mode}
              onValueChange={(value) => onSetSelfService({ self_signup: value as MixSelfSignup })}
              className="flex w-full"
            >
              {SIGNUP_DESTINATIONS.map((value) => (
                <ToggleGroupItem key={value} value={value} disabled={saving} className="flex-1 whitespace-nowrap px-2">
                  {t(`signup.${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}
        <p className="text-label text-[color:var(--aqt-fg-dim)]">{t(`signupHint.${mode}`)}</p>

        {showsRoles ? (
          <div className="flex items-center gap-2 border-t border-[color:var(--aqt-border)] pt-3">
            <Switch
              checked={game.self_role_edit}
              disabled={saving}
              aria-label={t("roleEdit")}
              onCheckedChange={(checked) => onSetSelfService({ self_role_edit: checked })}
            />
            <span className="text-caption text-[color:var(--aqt-fg-muted)]">{t("roleEdit")}</span>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const POST_STATUS_TONE: Record<CustomGameDiscordPost["status"], string> = {
  pending: "text-[color:var(--aqt-fg-dim)]",
  deleting: "text-[color:var(--aqt-fg-dim)]",
  posted: "text-[color:var(--aqt-teal)]",
  failed: "text-[color:var(--aqt-rose)]",
  lost: "text-[color:var(--aqt-rose)]"
};

/**
 * Everything this mix has in Discord, behind one trigger that shows where the
 * signup post stands -- the bot answers asynchronously, so the press alone
 * tells the host nothing.
 *
 * Inside: what the signup post is, its status, and one button whose label is
 * what it will actually do (post, re-post, or open signup and post), then
 * every post the mix made with a link and a delete. Delete asks first -- the
 * message disappears for everyone -- and its confirm lives outside the
 * popover, which closes as the dialog takes focus.
 *
 * Without a mix channel the menu still opens and says why the post is not
 * offered: a missing button reads as a bug, a stated reason as an answer.
 */
function DiscordMenu({
  game,
  posting,
  onPostSignup,
  deleting,
  onDelete
}: Readonly<{
  game: CustomGame;
  posting: boolean;
  onPostSignup?: (selfSignup: "pool" | "benched") => void;
  deleting: boolean;
  onDelete?: (postId: number) => void;
}>) {
  const t = useTranslations("mixes.self");
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<CustomGameDiscordPost | null>(null);
  const posts = game.discord_posts ?? [];
  const signupPost = signupPostOf(game);
  const status = signupPost?.status ?? null;
  const failed = status === "failed" || status === "lost";
  const statusLabel = t(status ? `post.${status}` : "post.none");
  const hasChannel = game.settings.workspace_discord_channel_id != null;
  const closed = game.self_signup === "closed";
  const postLabel = closed
    ? t("discord.openAndPost")
    : isLive(signupPost)
      ? t("discord.repost")
      : t("discord.post");
  const postHint = closed
    ? t("discord.openHint")
    : isLive(signupPost)
      ? t("discord.repostHint")
      : null;

  // What a post is, from its slot: the signup card, or one lineup card -- the
  // lobby letter only when the mix runs more than one lobby, since with one it
  // says nothing. The slot is `lineup:<lobby_index>:<game number>`.
  const labelOf = (post: CustomGameDiscordPost) => {
    if (post.slot === "signup") return t("posts.signup");
    const [prefix, lobby, match] = post.slot.split(":");
    if (prefix !== "lineup") return post.slot;
    return game.lobby_count > 1
      ? t("posts.lineupLobby", { lobby: lobbyLetter(Number(lobby)), match })
      : t("posts.lineup", { match });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={t("discord.trigger", { status: statusLabel })}
            className={cn(
              "shrink-0 gap-2",
              failed && "border-[color:color-mix(in_srgb,var(--aqt-rose)_40%,transparent)]"
            )}
          >
            <Eyebrow>{t("discord.label")}</Eyebrow>
            {status === "pending" || status === "deleting" ? (
              <Spinner className="size-3.5" />
            ) : null}
            {status === "posted" ? (
              <CheckCircle2 className="size-3.5 text-[color:var(--aqt-teal)]" aria-hidden="true" />
            ) : null}
            {failed ? (
              <AlertTriangle className="size-3.5 text-[color:var(--aqt-rose)]" aria-hidden="true" />
            ) : null}
            <span className={status ? POST_STATUS_TONE[status] : "text-[color:var(--aqt-fg-dim)]"}>
              {statusLabel}
            </span>
            <ChevronDown className="size-3.5 text-[color:var(--aqt-fg-dim)]" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[22rem] space-y-3 p-3">
          {onPostSignup ? (
            <div className="space-y-2">
              <Eyebrow>{t("posts.signup")}</Eyebrow>
              <p className="text-label text-[color:var(--aqt-fg-dim)]">{t("discord.hint")}</p>
              <SignupPostStatus post={signupPost} />
              {hasChannel ? (
                <>
                  <Button
                    type="button"
                    // Re-posting a card that is up is a repair, not the next step.
                    variant={!closed && isLive(signupPost) ? "outline" : "default"}
                    className="w-full"
                    disabled={posting}
                    onClick={() => onPostSignup(postModeOf(game.self_signup))}
                  >
                    {posting ? (
                      <Spinner className="mr-1.5 size-3.5" />
                    ) : (
                      <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                    )}
                    {postLabel}
                  </Button>
                  {postHint ? (
                    <p className="text-label text-[color:var(--aqt-fg-muted)]">{postHint}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-caption text-[color:var(--aqt-amber)]">{t("noChannel")}</p>
              )}
            </div>
          ) : null}

          {onDelete && posts.length > 0 ? (
            <div
              className={cn(
                "space-y-1",
                onPostSignup && "border-t border-[color:var(--aqt-border)] pt-3"
              )}
            >
              <Eyebrow>{t("discord.allPosts")}</Eyebrow>
              <ul
                aria-label={t("discord.allPosts")}
                className="max-h-60 space-y-0.5 overflow-y-auto"
              >
                {posts.map((post) => {
                  const label = labelOf(post);
                  return (
                    <li key={post.id} className="flex items-center gap-2 rounded-md py-1">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-caption text-[color:var(--aqt-fg)]">
                          {label}
                        </div>
                        <div
                          className={cn("truncate text-label", POST_STATUS_TONE[post.status])}
                          title={post.status === "failed" ? (post.error ?? undefined) : undefined}
                        >
                          {t(`post.${post.status}`)}
                        </div>
                      </div>
                      {post.url ? (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex shrink-0 items-center gap-1 text-caption text-[color:var(--aqt-teal)] hover:underline"
                        >
                          {t("posts.open")}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                      <IconTooltip
                        control
                        label={t("posts.delete", { label })}
                        className="shrink-0"
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-[color:var(--aqt-fg-muted)] hover:text-rose-200"
                          disabled={post.status === "deleting"}
                          aria-label={t("posts.delete", { label })}
                          onClick={() => {
                            setOpen(false);
                            setConfirming(post);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </IconTooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {onDelete ? (
        <ConfirmDialog
          open={confirming != null}
          onOpenChange={(next) => {
            if (!next) setConfirming(null);
          }}
          intent={{
            title: t("posts.deleteTitle"),
            description: t("posts.deleteDescription", {
              label: confirming ? labelOf(confirming) : ""
            }),
            confirmLabel: t("posts.deleteConfirm"),
            tone: "danger"
          }}
          pending={deleting}
          onConfirm={() => {
            if (confirming) onDelete(confirming.id);
            setConfirming(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Where the live signup post stands, above the button that (re)posts it:
 * `pending` until the bot writes the row, then a link to the message, or the
 * reason Discord refused -- almost always the bot's permissions in the mix
 * channel, which the host fixes and then simply posts again. `lost` is the
 * command that expired in the queue before the bot ever saw it.
 *
 * The `role="status"` region is mounted with the popover and stays mounted
 * while there is nothing to say: screen readers only announce changes to a
 * live region that already existed.
 */
function SignupPostStatus({ post }: Readonly<{ post: CustomGameDiscordPost | null }>) {
  const t = useTranslations("mixes.self");
  const status = post?.status ?? null;
  const error = post?.error?.trim().replace(/\.$/, "");
  const failedReason = error ? `${error}. ${t("post.failedHint")}` : t("post.failedHint");
  const posted = (
    <>
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      {t("post.posted")}
    </>
  );

  return (
    <div role="status" className="text-caption">
      {status === "pending" || status === "deleting" ? (
        <span className="flex items-center gap-1.5 text-[color:var(--aqt-fg-dim)]">
          <Spinner className="size-3.5" />
          {t(`post.${status}`)}
        </span>
      ) : null}
      {status === "posted" && post?.url ? (
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit items-center gap-1.5 text-[color:var(--aqt-teal)] hover:underline"
        >
          {posted}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      ) : null}
      {status === "posted" && !post?.url ? (
        <span className="flex items-center gap-1.5 text-[color:var(--aqt-teal)]">{posted}</span>
      ) : null}
      {status === "failed" || status === "lost" ? (
        <div className="space-y-0.5">
          <span className="flex items-center gap-1.5 text-[color:var(--aqt-rose)]">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            {t(`post.${status}`)}
          </span>
          <p className="text-label text-[color:var(--aqt-fg-muted)]">
            {status === "failed" ? failedReason : t("post.lostHint")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
