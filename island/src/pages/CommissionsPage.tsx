import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import CommissionCreateModal from "../components/CommissionCreateModal";
import { useBungalowDirectory } from "../hooks/useBungalowDirectory";
import { formatAddress, formatJbmAmount } from "../utils/formatters";
import {
  formatCommissionDate,
  getCommissionBungalowLabel,
  getCommissionPath,
  getCommissionStatusLabel,
  getCommissionStatusTone,
  normalizeCommissionListResponse,
  type CommissionListResponse,
} from "../utils/commissions";
import styles from "../styles/commissions-page.module.css";

type CommissionScope = "open" | "all" | "mine" | "applied" | "assigned";

const SCOPE_LABELS: Record<CommissionScope, string> = {
  open: "Open",
  all: "All",
  mine: "Mine",
  applied: "Applied",
  assigned: "Assigned",
};

const AUTH_REQUIRED_SCOPES = new Set<CommissionScope>([
  "mine",
  "applied",
  "assigned",
]);

function getEmptyListResponse(scope: CommissionScope): CommissionListResponse {
  return {
    items: [],
    total: 0,
    scope,
    viewer: {
      authenticated: false,
      profile_id: null,
      wallets: [],
    },
  };
}

export default function CommissionsPage() {
  const navigate = useNavigate();
  const { authenticated, getAccessToken, login } = usePrivy();
  const {
    bungalows,
    isLoading: isDirectoryLoading,
  } = useBungalowDirectory({
    enabled: true,
    fetchAll: true,
    limit: 200,
  });

  const [scope, setScope] = useState<CommissionScope>("open");
  const [data, setData] = useState<CommissionListResponse>(
    getEmptyListResponse("open"),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const loadCommissions = useCallback(async () => {
    if (AUTH_REQUIRED_SCOPES.has(scope) && !authenticated) {
      setData(getEmptyListResponse(scope));
      setIsLoading(false);
      setError("Connect your account to see your personal commission flows.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (authenticated) {
        const token = await getAccessToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }

      const response = await fetch(`/api/commissions?scope=${scope}&limit=48`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      setData(normalizeCommissionListResponse(payload));
    } catch (loadError) {
      setData(getEmptyListResponse(scope));
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load commissions",
      );
    } finally {
      setIsLoading(false);
    }
  }, [authenticated, getAccessToken, scope]);

  useEffect(() => {
    void loadCommissions();
  }, [loadCommissions, refreshToken]);

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Commission Board</p>
          <h1>Creative work routed through bungalow culture.</h1>
          <p className={styles.summary}>
            Requesters lock JBM in onchain escrow, artists apply, and one
            approved artist can claim the piece and get paid when the work lands.
          </p>
        </div>

        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              if (!authenticated) {
                login();
                return;
              }
              setIsCreateOpen(true);
            }}
          >
            Create commission
          </button>
          <div className={styles.heroStat}>
            <strong>{data.total}</strong>
            <span>{SCOPE_LABELS[scope].toLowerCase()} commissions</span>
          </div>
        </div>
      </header>

      <div className={styles.scopeBar}>
        {(Object.keys(SCOPE_LABELS) as CommissionScope[]).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`${styles.scopeButton} ${
              scope === entry ? styles.scopeButtonActive : ""
            }`}
            onClick={() => {
              if (AUTH_REQUIRED_SCOPES.has(entry) && !authenticated) {
                login();
                return;
              }
              setScope(entry);
            }}
          >
            {SCOPE_LABELS[entry]}
          </button>
        ))}
      </div>

      {error ? (
        <div className={styles.statusCard}>
          <strong>Could not load the board.</strong>
          <span>{error}</span>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                void loadCommissions();
              }}
            >
              Retry
            </button>
            {!authenticated ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => login()}
              >
                Connect account
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className={styles.grid}>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`commission-skeleton-${index}`} className={styles.skeletonCard} />
          ))}
        </div>
      ) : null}

      {!isLoading && data.items.length === 0 && !error ? (
        <div className={styles.statusCard}>
          <strong>No commissions in this lane yet.</strong>
          <span>
            {scope === "open"
              ? "Open the first commission and set the tone for the island."
              : "Switch lanes or create a new brief to get activity moving."}
          </span>
        </div>
      ) : null}

      {!isLoading && data.items.length > 0 ? (
        <div className={styles.grid}>
          {data.items.map((item) => (
            <article
              key={item.brief_id}
              className={styles.card}
              onClick={() => navigate(getCommissionPath(item.commission_id))}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(getCommissionPath(item.commission_id));
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className={styles.cardTop}>
                <span
                  className={styles.statusPill}
                  data-tone={getCommissionStatusTone(item.status)}
                >
                  {getCommissionStatusLabel(item.status)}
                </span>
                <span className={styles.metaText}>
                  due {formatCommissionDate(item.delivery_deadline)}
                </span>
              </div>

              <h2>{item.rate_label}</h2>
              <p className={styles.prompt}>{item.prompt}</p>

              <dl className={styles.metaGrid}>
                <div>
                  <dt>Bungalow</dt>
                  <dd>{getCommissionBungalowLabel(item)}</dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>{formatJbmAmount(item.budget_jbm)}</dd>
                </div>
                <div>
                  <dt>Requester</dt>
                  <dd>
                    {item.requester_handle
                      ? `@${item.requester_handle}`
                      : formatAddress(item.requester_wallet)}
                  </dd>
                </div>
                <div>
                  <dt>Applications</dt>
                  <dd>
                    {item.applications_count}
                    {item.pending_applications > 0
                      ? ` (${item.pending_applications} pending)`
                      : ""}
                  </dd>
                </div>
              </dl>

              <footer className={styles.cardFooter}>
                {item.viewer_application ? (
                  <span className={styles.viewerBadge}>
                    You applied · {item.viewer_application.status}
                  </span>
                ) : null}
                {item.approved_artist_handle ? (
                  <span className={styles.viewerBadge}>
                    Approved artist · @{item.approved_artist_handle}
                  </span>
                ) : null}
                <span className={styles.openLink}>Open commission</span>
              </footer>
            </article>
          ))}
        </div>
      ) : null}

      <CommissionCreateModal
        open={isCreateOpen}
        bungalowOptions={bungalows}
        isDirectoryLoading={isDirectoryLoading}
        onClose={() => setIsCreateOpen(false)}
        onCreated={() => {
          setScope("mine");
          setRefreshToken((current) => current + 1);
        }}
      />
    </section>
  );
}
