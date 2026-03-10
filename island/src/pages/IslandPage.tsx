import { Suspense, lazy, useState } from "react";
import { useOutletContext } from "react-router-dom";
import BungalowConstructionModal from "../components/BungalowConstructionModal";
import type { LayoutOutletContext } from "../components/Layout";
import styles from "../styles/island-page.module.css";

const IslandMap3D = lazy(() => import("../components/IslandMap"));

export default function IslandPage() {
  const [isConstructionOpen, setIsConstructionOpen] = useState(false);
  const { bungalows, homeTeamLoading, homeTeamError } =
    useOutletContext<LayoutOutletContext>();

  return (
    <section className={styles.page}>
      <Suspense
        fallback={
          <div
            style={{
              height: "calc(100vh - 52px)",
              minHeight: "calc(100vh - 52px)",
              display: "grid",
              placeItems: "center",
              borderRadius: 24,
              background:
                "radial-gradient(circle at 50% 42%, rgba(72, 139, 255, 0.34), rgba(4, 12, 48, 0.96) 58%), linear-gradient(180deg, #041b74 0%, #050b22 100%)",
              color: "#d7e6d5",
            }}
          >
            Loading island...
          </div>
        }
      >
        <IslandMap3D
          bungalows={bungalows}
          isLoading={homeTeamLoading}
          error={homeTeamError}
          onOpenConstruction={() => setIsConstructionOpen(true)}
        />
      </Suspense>

      <BungalowConstructionModal
        open={isConstructionOpen}
        onClose={() => setIsConstructionOpen(false)}
      />
    </section>
  );
}
