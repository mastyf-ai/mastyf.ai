#!/bin/bash
# Run: DATABASE_URL=postgres://... ./backup.sh
set -e
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/mastyf-cloud-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$FILE"
echo "Backup: $FILE ($(du -h "$FILE" | cut -f1))"
