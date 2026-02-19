import { useMemo, useState } from 'react';
import { useInstallWidget, useInstalledWidgets, useWidgetCatalog } from '../../hooks/useWidgets';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { formatApiError } from '../../lib/apiError';

interface WidgetInstallerProps {
  chain: string;
  ca: string;
  canInstall: boolean;
}

export function WidgetInstaller({ chain, ca, canInstall }: WidgetInstallerProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const catalog = useWidgetCatalog(chain, ca);
  const installed = useInstalledWidgets(chain, ca);
  const installMutation = useInstallWidget(chain, ca);

  const installedById = useMemo(
    () => new Set((installed.data?.items ?? []).map((item) => item.widget_id)),
    [installed.data?.items],
  );

  const onInstall = (widgetId: string) => {
    installMutation.mutate({
      widget_id: widgetId,
      repo_url: repoUrl.trim() || undefined,
    });
  };

  return (
    <section className="card space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-300">
          Widgets
        </h3>
        <p className="text-sm text-zinc-400">
          Install open-source widget packages to extend this bungalow.
        </p>
      </div>

      {canInstall && (
        <div className="space-y-2 rounded-lg border border-jungle-700/80 bg-jungle-900/50 p-3">
          <label className="text-xs text-zinc-500" htmlFor="repo-url">
            Open-source repo URL (optional)
          </label>
          <input
            id="repo-url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/your-org/bungalow-kit"
            className="w-full rounded-lg border border-jungle-700 bg-jungle-950/70 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-jungle-500 focus:outline-none"
          />
        </div>
      )}

      {catalog.isLoading && <LoadingSpinner label="Loading widget catalog..." />}

      {catalog.isError && (
        <p className="text-sm text-red-400">
          {formatApiError(catalog.error, 'Could not load widget catalog')}
        </p>
      )}

      {catalog.data && (
        <div className="grid gap-3 md:grid-cols-2">
          {catalog.data.map((widget) => {
            const alreadyInstalled = installedById.has(widget.id);
            return (
              <article
                key={widget.id}
                className="rounded-lg border border-jungle-700/80 bg-jungle-900/40 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-zinc-100">{widget.name}</h4>
                  <span className="rounded-full border border-jungle-700 px-2 py-0.5 text-[11px] text-zinc-400">
                    {widget.category}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">{widget.description}</p>
                <p className="font-mono text-[11px] text-zinc-500">{widget.package_name}@{widget.version}</p>
                <a
                  className="text-xs text-jungle-300 hover:text-jungle-200"
                  href={widget.repo_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open source repo
                </a>
                <div>
                  <button
                    type="button"
                    onClick={() => onInstall(widget.id)}
                    disabled={!canInstall || alreadyInstalled || installMutation.isPending}
                    className="rounded-lg bg-jungle-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-jungle-500 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {alreadyInstalled ? 'Installed' : 'Install widget'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!canInstall && (
        <p className="text-xs text-zinc-500">
          Only the bungalow owner can install widgets.
        </p>
      )}

      {installMutation.isError && (
        <p className="text-sm text-red-400">
          {formatApiError(installMutation.error, 'Widget installation failed')}
        </p>
      )}

      {installMutation.data && (
        <div className="rounded-lg border border-green-700/60 bg-green-950/30 p-3 text-xs text-green-300 space-y-1">
          <p>Widget installed. Add it to your repo with:</p>
          <p className="font-mono">{installMutation.data.install_command}</p>
        </div>
      )}

      {installed.data && installed.data.total > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Installed on this bungalow</p>
          <div className="space-y-1">
            {installed.data.items.map((item) => (
              <p key={item.id} className="text-xs text-zinc-400">
                <span className="font-mono text-zinc-300">{item.package_name}@{item.version}</span>
                {' '}installed by <span className="font-mono">{item.installed_by.slice(0, 8)}...{item.installed_by.slice(-4)}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
