# Betrieb auf dem Raspberry Pi

Grundlage: [Spec M4](../.specify/specs/m4-deploy/spec.md). Der Planer läuft als Container
`ghcr.io/tmogdans/carrera-planer` (nur `linux/arm64`) neben der Rezepte-App auf dem Raspi, Port
**8080**. CI baut das Image bei jedem Push nach `main` und pusht es mit den Tags `latest` und
`<Commit-SHA>`. Deploy, Sicherung und Rückweg macht der Mensch von Hand per SSH.

Platzhalter: `<LAN-IP>` ist die feste IPv4-Adresse des Raspi im Heimnetz, `<raspi>` der SSH-Alias.

## Kanonische Adresse

**`http://rezepte.fritz.box:8080`**, im Heimnetz und über das WireGuard-VPN der Fritzbox gleich.

Notwege, nur wenn der Fritzbox-Name nicht auflöst (z. B. in einem fremden VPN):
`http://rezepte.local:8080` (mDNS, nur im Heimnetz, nicht durch WireGuard) und
`http://<LAN-IP>:8080`.

**Achtung bis Teil B:** Die Oberfläche speichert Layouts und Bestand im `localStorage` des
Browsers, und der ist je Adresse getrennt. Wer über einen Notweg plant, sieht dort andere Daten als
unter der kanonischen Adresse. Deshalb immer `rezepte.fritz.box:8080` benutzen.

Jeder Name, unter dem der Planer erreichbar sein soll, muss in `CARRERA_ALLOWED_HOSTS` stehen;
sonst antwortet der Server mit 421 (`FremderHost`). Ohne Port gilt Port 8080. Wird der äußere Port
in der Compose-Datei geändert, braucht jeder Eintrag genau diesen Port (z. B.
`rezepte.fritz.box:9090`).

## Erst-Deploy

```sh
ssh <raspi>
mkdir -p ~/carrera-planer && cd ~/carrera-planer
# Datenverzeichnis als Raspi-Benutzer (UID 1000) anlegen, NICHT von Docker anlegen lassen:
# ein von Docker angelegtes Verzeichnis gehört root, und der Server startet dann nicht
mkdir data
# docker-compose.yml und backup.sh aus dem Repo (deploy/) hierher kopieren, z. B. vom Laptop:
#   scp deploy/docker-compose.yml deploy/backup.sh <raspi>:carrera-planer/
chmod +x backup.sh
printf 'CARRERA_ALLOWED_HOSTS=rezepte.fritz.box,rezepte.local,<LAN-IP>\n' > .env
docker compose pull
docker compose up -d
docker compose ps        # nach höchstens 30 s: healthy
```

Fehlt `CARRERA_ALLOWED_HOSTS` in `.env` oder ist sie leer, verweigert `docker compose up -d` den
Start mit einer Meldung.

Das Paket auf ghcr.io ist öffentlich; `docker pull` braucht keine Anmeldung und kein Token auf
dem Raspi.

## Prüfen nach dem Deploy

```sh
curl -s http://localhost:8080/api/status          # {"status":"ok"}
ls data                                            # carrera-planer.sqlite
docker exec <container> cat /sys/fs/cgroup/memory.max
```

`memory.max` muss das Limit in Byte zeigen (402653184 = 384 MiB). Steht dort `max` oder fehlt die
Datei, ist die Speicher-cgroup im Kernel aus, und das Limit wirkt nicht.

## Update

```sh
cd ~/carrera-planer
./backup.sh                 # immer vorher sichern
docker compose pull
docker compose up -d
docker compose ps           # healthy
```

## Sicherung

```sh
cd ~/carrera-planer
./backup.sh
```

Das Skript stoppt den Dienst (SIGTERM; SQLite schreibt dabei die WAL zurück), kopiert alle
`data/carrera-planer.sqlite*` nach `backup/JJJJMMTT-HHMMSS/` (Zeit in UTC) und startet den Dienst
wieder. Ausfall: wenige Sekunden. Scheitert ein Schritt, endet es mit Exit-Code ≠ 0 und startet den
Dienst trotzdem wieder.

Grenzen: Die Sicherung liegt auf derselben SD-Karte (schützt nicht vor deren Tod) und läuft nicht
automatisch; beides ist ein Folge-Issue vor Teil B.

## Rückweg auf eine frühere Version

```sh
cd ~/carrera-planer
echo 'CARRERA_TAG=<voriger Commit-SHA>' >> .env
docker compose up -d
```

Hat die neuere Version die Datenbank migriert, startet die ältere darauf nicht (sie meldet eine
unbekannte Migration). Dann zuerst die Sicherung von vor dem Update zurückspielen:

```sh
docker compose stop
rm -f data/carrera-planer.sqlite*
cp -p backup/<Ordner>/carrera-planer.sqlite* data/
docker compose up -d
```

Ohne `sudo` kopieren, damit die Dateien dem Raspi-Benutzer (UID 1000) gehören. Gehören sie root,
startet der Server nicht und meldet „nicht beschreibbar“ (siehe unten).

## Fehlerbilder

- **Container endet sofort, Log nennt `/data/carrera-planer.sqlite` und „nicht beschreibbar“:**
  `data/` oder die Datenbankdateien gehören nicht UID 1000 bzw. sind schreibgeschützt.
  `sudo chown -R 1000:1000 data` und erneut `docker compose up -d`.
- **421 `FremderHost` im Browser:** Der Name in der Adresszeile (samt Port) steht nicht in
  `CARRERA_ALLOWED_HOSTS`. In `.env` ergänzen, dann `docker compose up -d`.
- **`unhealthy` in `docker compose ps`:** `docker inspect --format '{{json .State.Health}}'
  <container>` zeigt die letzten Prüfungen. `unhealthy` startet den Container nicht neu; das tut
  `restart: unless-stopped` nur, wenn der Prozess endet.
- **Uhr nach dem Booten:** Bis NTP greift, geht die Uhr des Raspi nach; in dieser Zeit angelegte
  Layouts tragen eine zu frühe `updatedAt`. Kosmetisch, ohne Wirkung auf Versionen.

## Messung am Zielgerät

Gegen einen **zweiten, temporären** Container auf Port 8081 mit leerem Datenverzeichnis, je Profil
ein frischer Container (VmHWM ist ein Höchststand seit Prozessstart):

```sh
# auf dem Raspi
mkdir -p /tmp/carrera-messung && chmod 777 /tmp/carrera-messung
docker run -d --name carrera-messung -p 8081:8080 -v /tmp/carrera-messung:/data \
  -e CARRERA_ALLOWED_HOSTS=<LAN-IP>:8081 --memory 384m ghcr.io/tmogdans/carrera-planer:latest

# auf dem Entwicklungsrechner (Node 22, im Repo)
node deploy/measure.mjs http://<LAN-IP>:8081 typisch --container carrera-messung --ssh <raspi>

# danach auf dem Raspi
docker rm -f carrera-messung && rm -rf /tmp/carrera-messung
```

Ausgabe ist ein JSON-Objekt mit `maxMs`/`medianMs` je Vorgang und `vmHwmMiB`/`memoryPeakMiB`. Die
Schwellen für das Profil „typisch“ und die Regel für das endgültige Speicherlimit stehen in der
Spec (Abschnitt „Messung am Zielgerät“).
