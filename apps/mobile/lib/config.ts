/** Runtime access to the mobile-safe configuration embedded by Expo. */

import { parseMobileConfig, type MobileConfig } from "@remote-deck/config/mobile";
import Constants from "expo-constants";

let cachedConfig: MobileConfig | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the namespaced public value without trusting manifest contents. */
export function readMobileConfig(extra: unknown): MobileConfig {
  if (!isRecord(extra) || !("remoteDeck" in extra)) {
    throw new Error("Expo config extra.remoteDeck is missing.");
  }

  try {
    return parseMobileConfig(extra.remoteDeck);
  } catch (error) {
    throw new Error(
      `Expo config extra.remoteDeck is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

/** Reads and caches the immutable config embedded for this application build. */
export function getMobileConfig(): MobileConfig {
  cachedConfig ??= readMobileConfig(Constants.expoConfig?.extra);
  return cachedConfig;
}
