export const MOBILE_DESTINATION_ORDER = ["chat", "sessions", "tools", "settings"] as const;

export type MobileDestination = (typeof MOBILE_DESTINATION_ORDER)[number];

export function mobileDestinationFromMainView(mainView: string): MobileDestination {
  if (mainView === "navigation") return "sessions";
  if (mainView === "chat") return "chat";
  return "tools";
}
