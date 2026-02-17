import { useEffect, useState } from 'react';
import { useProfile } from '../../contexts/ProfileContext';

const steps = [
  'Connecting to X account...',
  'Looking up Farcaster profile...',
  'Linking wallets...',
  'Creating your island profile...',
];

export function ProfileSetupModal() {
  const { isSettingUp } = useProfile();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!isSettingUp) {
      setStepIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 1200);

    return () => clearInterval(interval);
  }, [isSettingUp]);

  if (!isSettingUp) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-xl border border-jungle-700 bg-jungle-900 p-6 shadow-2xl">
        <div className="mb-4 flex justify-center">
          <span className="h-10 w-10 animate-spin rounded-full border-3 border-heat-observer border-r-transparent" />
        </div>
        <h2 className="mb-4 text-center font-display text-lg font-semibold text-zinc-100">
          Setting up your profile
        </h2>
        <ul className="space-y-2">
          {steps.map((step, i) => (
            <li
              key={step}
              className={`flex items-center gap-2 text-sm transition-opacity ${
                i <= stepIndex ? 'text-zinc-200 opacity-100' : 'text-zinc-500 opacity-40'
              }`}
            >
              {i < stepIndex ? (
                <span className="text-heat-observer">&#10003;</span>
              ) : i === stepIndex ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-heat-observer border-r-transparent" />
              ) : (
                <span className="h-3 w-3 rounded-full border border-zinc-600" />
              )}
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
