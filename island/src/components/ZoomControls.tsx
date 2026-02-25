import styles from "../styles/zoom-controls.module.css";

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export default function ZoomControls({ scale, onZoomIn, onZoomOut }: ZoomControlsProps) {
  return (
    <div className={styles.controls}>
      <button type="button" className={styles.button} onClick={onZoomIn}>
        +
      </button>
      <button type="button" className={styles.button} onClick={onZoomOut}>
        −
      </button>
      <span className={styles.scaleLabel}>{scale.toFixed(1)}x</span>
    </div>
  );
}
