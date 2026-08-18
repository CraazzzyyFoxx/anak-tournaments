// Best-effort UA sniffing shared by every session list that renders a
// human-readable device label (admin session table, account settings
// session list). Deliberately minimal: only the browsers/platforms these
// UIs actually need to distinguish, not a general-purpose UA parser.
export function detectBrowser(userAgent: string): string | null {
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return "Safari";
  return null;
}

export function detectPlatform(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return null;
}
