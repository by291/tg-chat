/** Identify the connected account entry independently of the optional local demo route. */
export function isConnectedAccountEntry() {
  return (
    import.meta.env.VITE_APP_MODE === 'connected' &&
    typeof window !== 'undefined' &&
    window.location.pathname !== '/demo'
  );
}
