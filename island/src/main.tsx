import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { base, mainnet } from "viem/chains";
import App from "./App";
import PrivySessionSync from "./components/PrivySessionSync";
import "./styles/global.css";
import {
  getPrivyWalletChainType,
  getPrivyWalletList,
} from "./utils/privyWalletOptions";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID?.trim();

if (!PRIVY_APP_ID) {
  throw new Error("Missing VITE_PRIVY_APP_ID in island/.env");
}

const queryClient = new QueryClient();
const walletList = getPrivyWalletList();
const walletChainType = getPrivyWalletChainType();

ReactDOM.createRoot(document.getElementById("island-root")!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#2ecc71",
          walletList,
          walletChainType,
        },
        loginMethods: ["twitter"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
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
        <PrivySessionSync />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </PrivyProvider>
  </React.StrictMode>,
);
