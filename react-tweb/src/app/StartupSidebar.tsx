/** Reserve the real sidebar geometry without exposing actions before conversation restoration. */
export function StartupSidebar() {
  return (
    <aside className="startup-sidebar" aria-label="Chat list" aria-busy="true">
      <div className="startup-header" aria-hidden="true">
        <span className="startup-menu" />
        <span className="startup-search" />
      </div>
      <span className="startup-status" role="status">
        Opening your conversations…
      </span>
    </aside>
  );
}
