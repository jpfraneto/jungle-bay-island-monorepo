import { Navigate, Route, Routes } from 'react-router-dom';
import { Header } from './components/layout/Header';
import { ProfileSetupModal } from './components/common/ProfileSetupModal';
import { ProfileProvider } from './contexts/ProfileContext';
import { BungalowPage } from './components/bungalow/BungalowPage';
import { LandingPage } from './pages/LandingPage';
import { ClaimPage } from './pages/ClaimPage';
import { ProfilePage } from './pages/ProfilePage';

function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-jungle-950 text-zinc-100">
      <Header />
      <main className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-4 sm:py-6 md:px-6">
        {children}
      </main>
    </div>
  );
}

export function App() {
  return (
    <ProfileProvider>
      <ProfileSetupModal />
      <Routes>
        <Route path="/" element={<PageLayout><LandingPage /></PageLayout>} />
        <Route path="/profile" element={<PageLayout><ProfilePage /></PageLayout>} />
        <Route path="/claim/:chain/:ca" element={<PageLayout><ClaimPage /></PageLayout>} />
        <Route path="/:chain/:ca" element={<PageLayout><BungalowPage /></PageLayout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProfileProvider>
  );
}
