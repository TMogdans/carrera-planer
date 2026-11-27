#!/bin/sh
# Sicherung der Datenbank (Spec M4, REQ-DATA-3). Im Verzeichnis der Compose-Datei aufrufen:
#
#   ./backup.sh
#
# Stoppt den Dienst (SIGTERM; SQLite schreibt die WAL beim Schließen zurück), kopiert alle
# data/carrera-planer.sqlite* nach backup/JJJJMMTT-HHMMSS/ (Zeitpunkt in UTC) und startet den
# Dienst wieder. Scheitert ein Schritt, endet das Skript mit Exit-Code ≠ 0 und startet den Dienst
# trotzdem wieder.
set -u

stamp=$(date -u +%Y%m%d-%H%M%S)
target="backup/$stamp"
status=0

if docker compose stop; then
  if mkdir -p backup && mkdir "$target" && cp -p data/carrera-planer.sqlite* "$target/"; then
    echo "Sicherung in $target"
  else
    echo "Sicherung nach $target gescheitert" >&2
    status=1
  fi
else
  # Ohne sauberen Stopp wäre die Kopie nicht konsistent: nicht kopieren
  echo "docker compose stop gescheitert, keine Sicherung" >&2
  status=1
fi

if ! docker compose start; then
  echo "docker compose start gescheitert: der Dienst läuft nicht" >&2
  status=1
fi

exit "$status"
