export const MOBILE_DESTINATION_ORDER = ["chat", "sessions", "tools", "settings"] as const;

export type MobileDestination = (typeof MOBILE_DESTINATION_ORDER)[number];

export interface MobileDestinationAvailability {
  hasSession: boolean;
  hasTools: boolean;
}

/** Keep the mobile shell independent from desktop workspace-view routing. */
export function mobileDestinationFallback(
  destination: MobileDestination,
  availability: MobileDestinationAvailability,
): MobileDestination {
  if (destination !== "tools" || availability.hasTools) return destination;
  return availability.hasSession ? "chat" : "sessions";
}

export function mobileDestinationFromMainView(mainView: string): MobileDestination {
  if (mainView === "navigation") return "sessions";
  if (mainView === "chat") return "chat";
  return "tools";
}
