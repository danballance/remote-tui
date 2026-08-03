import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AgentClientProvider } from "../lib/AgentClientProvider";

export default function RootLayout() {
  return (
    <AgentClientProvider>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </AgentClientProvider>
  );
}
