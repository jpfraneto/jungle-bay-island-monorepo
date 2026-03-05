import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopNav from "./TopNav";
import { useHomeTeam, type HomeTeamBungalow } from "../hooks/useHomeTeam";
import styles from "../styles/layout.module.css";

export interface LayoutOutletContext {
  bungalows: HomeTeamBungalow[];
  homeTeamLoading: boolean;
  homeTeamError: string | null;
}

export default function Layout() {
  const [sidebarState, setSidebarState] = useState({
    open: false,
    pathname: "",
  });
  const location = useLocation();
  const { bungalows, isLoading, error } = useHomeTeam();

  const isIslandRoute = location.pathname === "/";
  const showSidebar = true;
  const sidebarOpen =
    sidebarState.open && sidebarState.pathname === location.pathname;

  return (
    <div className={styles.layout}>
      <TopNav
        isIslandActive={isIslandRoute}
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
            }}
          />
        </main>
      </div>
    </div>
  );
}
