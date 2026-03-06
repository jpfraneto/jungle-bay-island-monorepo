import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import NotFoundPage from "./NotFoundPage";
import styles from "../styles/bungalow-page.module.css";

interface LegacyResolvedBungalowTarget {
  canonical_slug?: string | null;
}

export default function LegacyBungalowRedirectPage() {
  const { chain = "", ca = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function redirectToCanonicalPath() {
      if (!chain || !ca) {
        setError("Invalid bungalow route");
        return;
      }

      try {
        const response = await fetch(
          `/api/bungalow/resolve/${encodeURIComponent(chain)}/${encodeURIComponent(ca)}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const resolved = (await response.json()) as LegacyResolvedBungalowTarget;

        if (!cancelled) {
          navigate(`/bungalow/${resolved.canonical_slug ?? ca}`, {
            replace: true,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to resolve bungalow",
          );
        }
      }
    }

    void redirectToCanonicalPath();

    return () => {
      cancelled = true;
    };
  }, [ca, chain, navigate]);

  if (error?.includes("(404)")) {
    return <NotFoundPage />;
  }

  if (error) {
    return <div className={styles.page}>Failed to redirect bungalow: {error}</div>;
  }

  return <div className={styles.page}>Redirecting to bungalow…</div>;
}
