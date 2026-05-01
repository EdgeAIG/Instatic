import styles from './AppLoadingScreen.module.css'

export function AppLoadingScreen() {
  return (
    <div
      className={styles.screen}
      role="status"
      aria-busy="true"
      aria-label="Loading Page Builder"
    >
      <CenteredLoader />
    </div>
  )
}

function CenteredLoader() {
  return (
    <div className={styles.centerLoader} aria-hidden="true">
      <Spinner />
      <span className={styles.loaderTrack} />
    </div>
  )
}

function Spinner() {
  return (
    <span
      className={styles.spinner}
      data-loader-spinner="true"
      aria-hidden="true"
    />
  )
}
