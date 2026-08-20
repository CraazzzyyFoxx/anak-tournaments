import type { ReactNode } from "react";

import { BalancerLayoutClient } from "@/app/balancer/BalancerLayoutClient";

type BalancerLayoutProps = {
  children: ReactNode;
};

export default function BalancerLayout({ children }: Readonly<BalancerLayoutProps>) {
  return <BalancerLayoutClient>{children}</BalancerLayoutClient>;
}
