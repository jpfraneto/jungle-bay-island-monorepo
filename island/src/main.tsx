import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { base, mainnet } from "viem/chains";
import App from "./App";
import "./styles/global.css";

const PRIVY_APP_ID = "cmgygjwkb00zvi90cvzl7dczv";
const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("island-root")!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#2ecc71",
          walletList: [
            "metamask",
            "rainbow",
            "phantom",
            "coinbase_wallet",
            "base_account",
            "uniswap",
            "okx_wallet",
          ],
          walletChainType: "ethereum-and-solana",
        },
        loginMethods: ["twitter", "email"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "off",
          },
          solana: {
            createOnLogin: "off",
          },
        },
        defaultChain: base,
        supportedChains: [base, mainnet],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </PrivyProvider>
  </React.StrictMode>,
);
