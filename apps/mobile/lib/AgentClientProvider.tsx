import { createContext, useContext, type PropsWithChildren } from "react";

import { mobileConfig } from "@remote-deck/config/mobile";

import { HttpAgentClient, type AgentClient } from "./agent";

const AgentClientContext = createContext<AgentClient | undefined>(undefined);

export const productionAgentClient: AgentClient = new HttpAgentClient(
  mobileConfig.agentUrl,
);

interface AgentClientProviderProps extends PropsWithChildren {
  readonly client?: AgentClient;
}

/** Supplies the production HTTP client or an injected test implementation. */
export function AgentClientProvider({
  children,
  client = productionAgentClient,
}: AgentClientProviderProps) {
  return (
    <AgentClientContext.Provider value={client}>
      {children}
    </AgentClientContext.Provider>
  );
}

/** Returns the client owned by the nearest application provider. */
export function useAgentClient(): AgentClient {
  const client = useContext(AgentClientContext);
  if (client === undefined) {
    throw new Error("useAgentClient must be used within AgentClientProvider.");
  }
  return client;
}
