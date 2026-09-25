export function up(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      server_name TEXT    NOT NULL,
      metric_name TEXT    NOT NULL,
      value       REAL    NOT NULL,
      snapshot_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_server_metric
      ON metrics_snapshots(server_name, metric_name, snapshot_at);
  `);
}
export function down(db) {
    db.exec('DROP TABLE IF EXISTS metrics_snapshots;');
}
//# sourceMappingURL=003_metrics_timeseries.js.map