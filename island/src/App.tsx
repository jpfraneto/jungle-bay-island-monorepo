import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import AboutPage from "./pages/AboutPage";
import AddressProfilePage from "./pages/AddressProfilePage";
import BodegaPage from "./pages/BodegaPage";
import BodegaListingPage from "./pages/BodegaListingPage";
import BungalowPage from "./pages/BungalowPage";
import ChangelogPage from "./pages/ChangelogPage";
import CommissionDetailPage from "./pages/CommissionDetailPage";
import CommissionsPage from "./pages/CommissionsPage";
import HeatScorePage from "./pages/HeatScorePage";
import IslandPage from "./pages/IslandPage";
import LegacyBungalowRedirectPage from "./pages/LegacyBungalowRedirectPage";
import LandingPage from "./pages/LandingPage";
import MiningZonesPage from "./pages/MiningZonesPage";
import ProfilePage from "./pages/ProfilePage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/island" element={<IslandPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/changelog" element={<ChangelogPage />} />
        <Route path="/commissions" element={<CommissionsPage />} />
        <Route path="/commissions/:commission_id" element={<CommissionDetailPage />} />
        <Route path="/bodega" element={<BodegaPage />} />
        <Route path="/bodega/:tx_hash" element={<BodegaListingPage />} />
        <Route path="/bungalow/:identifier" element={<BungalowPage />} />
        <Route path="/heat-score" element={<HeatScorePage />} />
        <Route path="/mining-zones" element={<MiningZonesPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/address/:wallet_address" element={<AddressProfilePage />} />
        <Route path="/:chain/:ca" element={<LegacyBungalowRedirectPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
