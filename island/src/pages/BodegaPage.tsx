import styles from "../styles/bodega-page.module.css";

export default function BodegaPage() {
  return (
    <section className={styles.page}>
      <div className={styles.card}>
        <h1>Bodega</h1>
        <p>The marketplace is coming online soon.</p>
      </div>
    </section>
  );
}
