import { usePrivy } from "@privy-io/react-auth";
import { useNavigate } from "react-router-dom";
import { getAppBootstrap } from "../utils/appBootstrap";
import styles from "../styles/landing-page.module.css";

const MOBILE_STEPS = [
  "Log in with X.",
  "Create your onchain profile.",
  "Open or support bungalows, collect rewards, and commission art.",
];

const DESKTOP_STEPS = [
  "Log in with X to make your identity portable across wallets.",
  "Pick the wallet that signs onchain actions.",
  "Open bungalows, install artifacts, and manage commissions from one stateful dashboard.",
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { authenticated, login, user } = usePrivy();
  const bootstrap = getAppBootstrap();
  const isAuthenticated = authenticated || bootstrap.authenticated;
  const isMobile = bootstrap.client_variant === "mobile";

  const xUsername =
    typeof user?.twitter?.username === "string" && user.twitter.username.trim()
      ? `@${user.twitter.username.trim().replace(/^@+/, "")}`
      : bootstrap.session?.x_username
        ? `@${bootstrap.session.x_username.replace(/^@+/, "")}`
        : null;

  return (
    <section
      className={`${styles.page} ${isMobile ? styles.mobile : styles.desktop}`}
    >
      <div className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.kicker}>
            {isMobile ? "Mobile island shell" : "Desktop island shell"}
          </p>
          <h1>Jungle Bay Island</h1>
          <p className={styles.summary}>
            X starts the relationship, the four contracts hold the durable
            state, and the backend acts as the fast read and confirmation layer.
          </p>

          {isAuthenticated ? (
            <div className={styles.identityCard}>
              <span className={styles.identityLabel}>Signed in as</span>
              <strong>{xUsername ?? "your X account"}</strong>
              <p>
                Continue into the live system. Your next steps are profile,
                bungalow qualification, and commissions.
              </p>
            </div>
          ) : (
            <div className={styles.identityCard}>
              <span className={styles.identityLabel}>Start here</span>
              <strong>Login begins with X</strong>
              <p>
                That handle is the beginning of your relationship to the app.
                Wallets and contract actions come after.
              </p>
            </div>
          )}

          <div className={styles.actions}>
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => navigate("/profile")}
                >
                  Open profile
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => navigate("/commissions")}
                >
                  Open commissions
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={login}
                >
                  Login with X
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => navigate("/about")}
                >
                  Learn the model
                </button>
              </>
            )}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Clear path</span>
            <strong>{isMobile ? "Phone flow" : "Desktop flow"}</strong>
          </div>

          <ol className={styles.steps}>
            {(isMobile ? MOBILE_STEPS : DESKTOP_STEPS).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <div className={styles.quickGrid}>
            <button type="button" onClick={() => navigate("/profile")}>
              Profile
            </button>
            <button type="button" onClick={() => navigate("/commissions")}>
              Commissions
            </button>
            <button type="button" onClick={() => navigate("/bodega")}>
              Bodega
            </button>
            <button type="button" onClick={() => navigate("/island")}>
              Island map
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
