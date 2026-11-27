# carrera-planer

Streckenplaner für Carrera GO!!! (1:43) im Browser, gehostet auf dem Raspi im Heimnetz.

- **Bestandsmodus:** planen nur mit vorhandenen Teilen
- **Sandbox:** frei planen, danach Einkaufsliste gegen den Bestand

Stand: Konzeptphase. Recherche zu Geometrie und Bestand in [docs/recherche.md](docs/recherche.md).

## Betrieb

Läuft als Container auf dem Raspberry Pi im Heimnetz unter `http://rezepte.fritz.box:8080`
(auch per VPN). Image `ghcr.io/tmogdans/carrera-planer` (arm64), Compose-Datei und
Sicherungsskript unter [deploy/](deploy/). Erst-Deploy, Update, Sicherung und Rückweg:
[docs/raspi-deploy.md](docs/raspi-deploy.md).

Lokal: `docker build -t carrera-planer:test .`, dann die Container-Tests mit
`CARRERA_IMAGE=carrera-planer CARRERA_TAG=test pnpm exec vitest run --config vitest.container.config.ts`.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Kein offizielles Carrera-Produkt; Carrera und Mario Kart sind Marken ihrer Inhaber.
