import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/** Awaits every async (server) component in the tree, the way the RSC renderer does, leaving client ones to SSR. */
export async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!isValidElement(node)) return node;
  const { type, props } = node as ReactElement<{ children?: ReactNode }>;
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") {
    return resolveServer(await (type as (p: unknown) => Promise<ReactNode>)(props));
  }
  if (props.children === undefined) return node;
  // Static JSX children stay positional arguments, as they were written (an array argument would need keys).
  const children = await resolveServer(props.children);
  return cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]));
}
