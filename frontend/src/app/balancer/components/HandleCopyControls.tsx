"use client";

import { Copy, Files } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { formatAdditionalHandleCount, formatHandlesForClipboard } from "@/components/balancer/balancer-page-helpers";

type HandleCopyButtonProps = {
  handle: string;
  label?: string;
  className?: string;
};

type AdditionalHandleStripProps = {
  additionalHandles: string[];
  className?: string;
};

type HandleMenuItemsProps = {
  /** The row's primary handle first, its extra accounts after. */
  handles: string[];
};

function useHandleClipboard() {
  return async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success(`${label} copied`);
    } catch {
      notify.error(`Unable to copy the ${label}. Your browser blocked clipboard access — select the text and copy it manually.`);
    }
  };
}

export function HandleCopyButton({
  handle,
  label = "Handle",
  className
}: Readonly<HandleCopyButtonProps>) {
  const copyHandle = useHandleClipboard();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "h-7 w-7 rounded-lg border border-[color:var(--aqt-border)] bg-[color:var(--aqt-bg-2)] text-[color:var(--aqt-fg-dim)] hover:bg-[color:var(--aqt-overlay-3)] hover:text-cyan-100",
        className
      )}
      title={`Copy ${label}`}
      onClick={() => copyHandle(handle, label)}
    >
      <Copy className="h-3.5 w-3.5" />
      <span className="sr-only">Copy {label}</span>
    </Button>
  );
}

/** A row's extra accounts behind one collapsed chip: copy one or all of them. */
export function AdditionalHandleStrip({ additionalHandles, className }: Readonly<AdditionalHandleStripProps>) {
  const copyHandle = useHandleClipboard();

  if (additionalHandles.length === 0) {
    return null;
  }

  return (
    // `data-card-action`: the clickable pool and roster rows skip this subtree,
    // so opening the alt menu never opens the player sheet behind it.
    <div data-card-action className={cn("flex shrink-0 items-center gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="subtle"
            size="xs"
            className="rounded-full border-cyan-300/15 bg-cyan-500/8 text-cyan-100/62 hover:border-cyan-300/30 hover:bg-cyan-500/14 hover:text-cyan-50"
            title="Show alt handles"
          >
            {formatAdditionalHandleCount(additionalHandles.length)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Alt handles</DropdownMenuLabel>
          {additionalHandles.length > 1 ? (
            <>
              <DropdownMenuItem
                onClick={() => copyHandle(formatHandlesForClipboard(additionalHandles), "Alt handles")}
              >
                <Files className="h-4 w-4" />
                Copy all alts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {additionalHandles.map((handle) => (
            <DropdownMenuItem key={handle} onClick={() => copyHandle(handle, "Alt handle")}>
              <Copy className="h-4 w-4" />
              <span className="truncate">{handle}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function HandleContextMenuItems({ handles }: Readonly<HandleMenuItemsProps>) {
  const copyHandle = useHandleClipboard();
  const [primaryHandle, ...additionalHandles] = handles;

  if (!primaryHandle) {
    return null;
  }

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuLabel>Handles</ContextMenuLabel>
      <ContextMenuItem onClick={() => copyHandle(primaryHandle, "Handle")}>
        <Copy className="h-4 w-4" />
        Copy main handle
      </ContextMenuItem>
      {handles.length > 1 ? (
        <ContextMenuItem
          onClick={() => copyHandle(formatHandlesForClipboard(handles), "All handles")}
        >
          <Files className="h-4 w-4" />
          Copy all handles
        </ContextMenuItem>
      ) : null}
      {additionalHandles.length > 0 ? <ContextMenuSeparator /> : null}
      {additionalHandles.map((handle) => (
        <ContextMenuItem key={handle} onClick={() => copyHandle(handle, "Alt handle")}>
          <Copy className="h-4 w-4" />
          {handle}
        </ContextMenuItem>
      ))}
    </>
  );
}
