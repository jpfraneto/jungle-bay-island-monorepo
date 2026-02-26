import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import AboutPage from "./pages/AboutPage";
import AddressProfilePage from "./pages/AddressProfilePage";
import BodegaPage from "./pages/BodegaPage";
import BungalowPage from "./pages/BungalowPage";
import HeatScorePage from "./pages/HeatScorePage";
import IslandPage from "./pages/IslandPage";
import ProfilePage from "./pages/ProfilePage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<IslandPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/bodega" element={<BodegaPage />} />
        <Route path="/heat-score" element={<HeatScorePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/address/:wallet_address" element={<AddressProfilePage />} />
        <Route path="/:chain/:ca" element={<BungalowPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
