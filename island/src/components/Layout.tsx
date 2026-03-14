import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopNav from "./TopNav";
import { useHomeTeam, type HomeTeamBungalow } from "../hooks/useHomeTeam";
import { fetchAuthedJson, fetchJson, type AppMeState } from "../utils/onchain";
import styles from "../styles/layout.module.css";

export interface LayoutOutletContext {
  bungalows: HomeTeamBungalow[];
  homeTeamLoading: boolean;
  homeTeamError: string | null;
  meState: AppMeState | null;
  meLoading: boolean;
  meError: string | null;
  refreshMeState: () => Promise<void>;
}

export default function Layout() {
  const { authenticated, getAccessToken } = usePrivy();
  const [sidebarState, setSidebarState] = useState({
    open: false,
    pathname: "",
  });
  const [meState, setMeState] = useState<AppMeState | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [meError, setMeError] = useState<string | null>(null);
  const location = useLocation();
  const { bungalows, isLoading, error } = useHomeTeam();

  const refreshMeState = async () => {
    setMeLoading(true);
    setMeError(null);
    try {
      const payload = authenticated
        ? await fetchAuthedJson<AppMeState>("/api/state/me", getAccessToken)
        : await fetchJson<AppMeState>("/api/state/me");
      setMeState(payload);
    } catch (fetchError) {
      setMeError(
        fetchError instanceof Error ? fetchError.message : "Failed to load viewer state",
      );
      setMeState(null);
    } finally {
      setMeLoading(false);
    }
  };

  useEffect(() => {
    void refreshMeState();
  }, [authenticated]);

  const isIslandRoute = location.pathname === "/island";
  const isLandingRoute = location.pathname === "/";
  const showSidebar = !isLandingRoute;
  const sidebarOpen =
    sidebarState.open && sidebarState.pathname === location.pathname;

  return (
    <div className={styles.layout}>
      <TopNav
        isIslandActive={isIslandRoute}
        meState={meState}
        showSidebarToggle={showSidebar}
        onToggleSidebar={() =>
          setSidebarState((current) => ({
            open:
              current.pathname === location.pathname ? !current.open : true,
            pathname: location.pathname,
          }))
        }
      />

      <div className={styles.body}>
        {showSidebar ? (
          <Sidebar
            bungalows={bungalows}
            isLoading={isLoading}
            isOpen={sidebarOpen}
            onClose={() =>
              setSidebarState({
                open: false,
                pathname: location.pathname,
              })
            }
          />
        ) : null}

        <main className={styles.main}>
          <Outlet
            context={{
              bungalows,
              homeTeamLoading: isLoading,
              homeTeamError: error,
              meState,
              meLoading,
              meError,
              refreshMeState,
            }}
          />
        </main>
      </div>
    </div>
  );
}
