import { splitHandle } from "@/lib/player";
import { cn } from "@/lib/utils";

/**
 * A player handle as one identity: the name, then its `#1234` discriminator in
 * `--aqt-fg-faint` (DESIGN §4).
 *
 * One truncating line, not a flex pair: with the discriminator as its own
 * `shrink-0` item a narrow row clipped the whole name away and was left
 * identified only by `#1111`; here the tag is what an ellipsis eats first.
 * `truncate` needs a block box, which a flex or grid parent already gives;
 * anywhere else pass `block` in `className`.
 *
 * `className` sets the name's size, weight and colour (the tag inherits the
 * size); `tagClassName` restyles the tag alone. `title` is opt-in: most rows
 * already carry the full handle (or an action) in a title around it.
 */
export function HandleLabel({
  handle,
  className,
  tagClassName,
  title
}: Readonly<{ handle: string; className?: string; tagClassName?: string; title?: string }>) {
  const { name, suffix } = splitHandle(handle);
  return (
    <span title={title} className={cn("min-w-0 truncate", className)}>
      <bdi>{name}</bdi>
      {suffix ? (
        <span className={cn("font-normal text-[color:var(--aqt-fg-faint)]", tagClassName)}>
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
