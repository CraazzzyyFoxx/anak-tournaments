import "@tanstack/react-query";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      /** Opt out of the global error toast for this query. */
      suppressErrorToast?: boolean;
      /** The surface renders a `division_grid_required` refusal as `MissingGridNotice`: no toast for that one. */
      rendersGridRefusal?: boolean;
    };
    mutationMeta: {
      /** Opt out of the global error toast for this mutation. */
      suppressErrorToast?: boolean;
    };
  }
}
