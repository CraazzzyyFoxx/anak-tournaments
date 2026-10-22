import { toast as sonnerToast, type ExternalToast } from "sonner";

import { describeApiError } from "@/lib/api/error";

/**
 * Unified, callable notification API on top of Sonner.
 *
 * Usable from anywhere (components, hooks, mutation callbacks, plain modules) —
 * unlike the old hook-based `useToast`. For backend errors prefer `notify.apiError`,
 * which parses the `{ detail: [{ msg, code }] }` envelope into a readable toast.
 */
export const notify = {
  success: (message: string, options?: ExternalToast) => sonnerToast.success(message, options),
  error: (message: string, options?: ExternalToast) =>
    sonnerToast.error(message, { duration: Infinity, ...options }),
  info: (message: string, options?: ExternalToast) => sonnerToast.info(message, options),
  warning: (message: string, options?: ExternalToast) => sonnerToast.warning(message, options),
  /** Neutral, untyped toast (no colored icon). */
  message: (message: string, options?: ExternalToast) => sonnerToast(message, options),
  loading: (message: string, options?: ExternalToast) => sonnerToast.loading(message, options),
  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,

  /**
   * Show an error toast for any thrown value (ApiError / Error / unknown).
   * Pass `title` to override the derived heading; the server's reason then moves to the
   * description instead of being dropped. Other options pass through to Sonner.
   */
  apiError: (error: unknown, options?: { title?: string } & ExternalToast) => {
    const described = describeApiError(error);
    const { title, ...rest } = options ?? {};
    const reason = title && title !== described.title ? described.title : undefined;
    return sonnerToast.error(title ?? described.title, {
      duration: Infinity,
      description: described.description ?? reason,
      ...rest
    });
  }
};
