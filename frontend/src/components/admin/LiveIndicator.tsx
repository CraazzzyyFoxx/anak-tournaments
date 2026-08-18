/** Small pulsing "live" badge for a card header backed by a polling query. */
export function LiveIndicator() {
  return (
    <span className="flex items-center gap-1 text-xs font-normal text-success">
      <span
        aria-hidden
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-success motion-reduce:animate-none"
      />
      live
    </span>
  );
}
