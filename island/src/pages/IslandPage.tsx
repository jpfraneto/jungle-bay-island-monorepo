import { useOutletContext } from "react-router-dom";
import IslandMap from "../components/IslandMap";
import type { LayoutOutletContext } from "../components/Layout";

export default function IslandPage() {
  const { bungalows, homeTeamLoading, homeTeamError } = useOutletContext<LayoutOutletContext>();

  return (
    <IslandMap bungalows={bungalows} isLoading={homeTeamLoading} error={homeTeamError} />
  );
}
