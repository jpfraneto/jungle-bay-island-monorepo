import { useNavigate } from "react-router-dom";
import styles from "../styles/not-found-page.module.css";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <div className={styles.title}>404</div>
        <p className={styles.subtitle}>This bungalow doesn&apos;t exist... yet</p>
        <div className={styles.palm}>🌴</div>
        <button type="button" className={styles.button} onClick={() => navigate("/")}>
          Back to Island
        </button>
      </div>
    </section>
  );
}
