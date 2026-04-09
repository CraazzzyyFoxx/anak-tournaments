export interface ApiErrorDetail {
  msg: string;
  code: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: ApiErrorDetail[];

  constructor(status: number, details: ApiErrorDetail[]) {
    const message = details.map((d) => d.msg).join("\n");
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Parse a non-ok Response into an ApiError.
 *
 * Expected backend shapes:
 *   { "detail": [{ "msg": "…", "code": "…" }] }   – array form
 *   { "detail": "some string" }                     – string form
 *   { "message": "some string" }                    – fallback
 */
export async function parseApiError(response: Response): Promise<ApiError> {
  let details: ApiErrorDetail[];

  try {
    const body = await response.json();
    const raw = body?.detail ?? body?.message;

    if (Array.isArray(raw)) {
      details = raw.map((item: { msg?: string; message?: string; code?: string }) => ({
        msg: item.msg ?? item.message ?? "Unknown error",
        code: item.code ?? "unknown",
      }));
    } else if (typeof raw === "string") {
      details = [{ msg: raw, code: "error" }];
    } else {
      details = [{ msg: "An error occurred", code: "unknown" }];
    }
  } catch {
    details = [{ msg: "An error occurred", code: "unknown" }];
  }

  return new ApiError(response.status, details);
}
