import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { base, mainnet } from "wagmi/chains";
import App from "./App";
import "./styles/global.css";

const PRIVY_APP_ID = "cmgygjwkb00zvi90cvzl7dczv";
const queryClient = new QueryClient();

const wagmiConfig = createConfig({
  chains: [base, mainnet],
  connectors: [injected()],
  transports: {
    [base.id]: http("https://mainnet.base.org"),
    [mainnet.id]: http("https://eth.llamarpc.com"),
  },
});

ReactDOM.createRoot(document.getElementById("island-root")!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#2ecc71",
        },
        loginMethods: ["wallet"],
        defaultChain: base,
        supportedChains: [base, mainnet],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  </React.StrictMode>,
);
