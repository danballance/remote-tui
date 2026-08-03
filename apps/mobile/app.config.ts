/** Dynamic Expo configuration backed by Remote Deck's shared YAML settings. */

import { loadConfig, toMobileConfig } from "@remote-deck/config";
import type { ConfigContext, ExpoConfig } from "expo/config";

/** Adds only the public mobile projection to Expo's embedded manifest. */
export default function configureExpo({ config }: ConfigContext): ExpoConfig {
  if (config.name === undefined || config.slug === undefined) {
    throw new Error("The static Expo config must define name and slug.");
  }

  return {
    ...config,
    name: config.name,
    slug: config.slug,
    extra: {
      ...config.extra,
      remoteDeck: toMobileConfig(loadConfig()),
    },
  };
}
