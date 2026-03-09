"use client";

import { useEffect } from "react";
import { useAuthProfileStore } from "@/stores/auth-profile.store";

export function useAuthProfile() {
  const status = useAuthProfileStore((s) => s.status);
  const user = useAuthProfileStore((s) => s.user);
  const error = useAuthProfileStore((s) => s.error);
  const fetchMe = useAuthProfileStore((s) => s.fetchMe);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  return {
    status,
    user,
    error,
    refetch: () => fetchMe({ force: true })
  };
}
