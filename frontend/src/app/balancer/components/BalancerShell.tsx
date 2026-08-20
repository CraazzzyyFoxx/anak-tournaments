"use client";

import React from "react";

export function BalancerShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
