import React from "react";
import { cn } from "@/lib/utils";

export function TypographyH1({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1 className={cn("scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl", className)}>
      {children}
    </h1>
  );
}

export function TypographyH2({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn("scroll-m-20 pb-2 text-3xl font-semibold tracking-tight first:mt-0", className)}
    >
      {children}
    </h2>
  );
}

export function TypographyH3({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn("scroll-m-20 text-2xl font-semibold tracking-tight", className)}>
      {children}
    </h3>
  );
}

export function TypographyH4({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h4 className={cn("scroll-m-20 text-xl font-semibold tracking-tight", className)}>
      {children}
    </h4>
  );
}

export function TypographyP({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn("leading-7 [&:not(:first-child)]:mt-6", className)}>{children}</p>;
}
