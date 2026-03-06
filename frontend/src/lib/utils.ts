import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateRange(startDate: Date, endDate: Date): string {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  };

  // Same month: "Jan 15 - 20, 2026"
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startStr} - ${end.getDate()}, ${end.getFullYear()}`;
  }

  // Different months: "Jan 15 - Feb 20, 2026"
  const startStr = start.toLocaleDateString('en-US', options);
  const endStr = end.toLocaleDateString('en-US', options);
  return `${startStr} - ${endStr}, ${end.getFullYear()}`;
}

export function getStatusColor(isFinished: boolean) {
  return isFinished
    ? "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100"
    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100";
}
