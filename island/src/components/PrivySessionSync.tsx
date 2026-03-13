import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";

const SESSION_FLAG = "jbi_privy_session_synced";

export default function PrivySessionSync() {
  const { authenticated, getAccessToken, user } = usePrivy();
  const lastSyncedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!authenticated || !user?.id) {
      if (sessionStorage.getItem(SESSION_FLAG)) {
        void fetch("/api/app/session", {
          method: "DELETE",
          credentials: "include",
        }).catch(() => undefined);
        sessionStorage.removeItem(SESSION_FLAG);
        lastSyncedUserId.current = null;
      }
      return;
    }

    if (lastSyncedUserId.current === user.id) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;

        const response = await fetch("/api/app/session/sync", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
        });
        if (!response.ok || cancelled) return;

        sessionStorage.setItem(SESSION_FLAG, "1");
        lastSyncedUserId.current = user.id;
      } catch {
        // Best effort only.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken, user?.id]);

  return null;
}
