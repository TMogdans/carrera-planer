# Betrieb auf dem Raspberry Pi

Grundlage: [Spec M4](../.specify/specs/m4-deploy/spec.md). Der Planer läuft als Container
`ghcr.io/tmogdans/carrera-planer` (nur `linux/arm64`) neben der Rezepte-App auf dem Raspi, Port
**8080**. CI baut das Image bei jedem Push nach `main` und pusht es mit den Tags `latest` und
dem **vollen, 40-stelligen** Commit-SHA. Weil ein neuer Push nach `main` einen noch laufenden
CI-Lauf abbricht, gibt es nicht zu jedem `main`-Commit ein Image. Deploy, Sicherung und Rückweg
macht der Mensch von Hand per SSH.

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

**Vorher, einmalig (nach dem ersten CI-Push nach `main`):** Das Paket auf öffentlich stellen.
GitHub → Packages → `carrera-planer` → Package settings → Change visibility → Public. Neu
angelegte Pakete auf ghcr.io sind privat; bis zu diesem Handgriff scheitert `docker compose pull`
auf dem Raspi mit `denied` bzw. `unauthorized` (siehe Fehlerbilder).

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

Nach dem Umstellen auf öffentlich braucht `docker pull` keine Anmeldung und kein Token auf dem
Raspi.

## Prüfen nach dem Deploy

```sh
curl -s http://localhost:8080/api/status          # {"status":"ok"}
ls data                                            # carrera-planer.sqlite
docker compose exec carrera-planer cat /sys/fs/cgroup/memory.max
```

`memory.max` muss das Limit in Byte zeigen (402653184 = 384 MiB). Steht dort `max` oder fehlt die
Datei, ist die Speicher-cgroup im Kernel aus, und das Limit wirkt nicht.

## Welche Version läuft?

```sh
cd ~/carrera-planer
# Image-Name, Image-ID und Commit-SHA des laufenden Containers
docker inspect --format '{{.Config.Image}} {{.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker compose ps -q carrera-planer)"
```

Die Commit-SHA steht im Label `org.opencontainers.image.revision`; es setzt der CI-Push nach `main`
(Job `image`). Ein lokal gebautes Image hat das Label nicht, dann bleibt das dritte Feld leer.

`docker compose config --images` zeigt nur, welches Image Compose-Datei und `.env` **verlangen**,
nicht, was läuft. Scheitert `pull` oder `up -d` (z. B. `manifest unknown`), zeigt es trotzdem den
gewünschten Tag, während die alte Version weiterläuft und `healthy` ist. Ob ein Update oder Rückweg
gewirkt hat, zeigt deshalb nur die Revision des **laufenden** Containers (Prüfschritte in „Update“
und „Rückweg“).

**Vollen SHA einer Version finden, zu der es ein Image gibt:** GitHub → Packages →
`carrera-planer`; jede Version dort trägt als Tag ihren vollen SHA, die neueste zusätzlich
`latest`. Alternativ GitHub → Actions → Workflow `CI` auf `main`, ein Lauf mit erfolgreichem Job
`image`: dessen Commit ist der volle SHA (der Link zum Commit enthält ihn). Die Commit-Liste von
`main` hilft nicht: Sie zeigt nur 7 Zeichen, und nicht jeder Commit hat ein Image.

`.env` enthält höchstens **eine** Zeile `CARRERA_TAG=…`, und nur solange ein Rückweg gilt. Ohne
die Zeile läuft `latest`.

## Update

```sh
cd ~/carrera-planer
# vollen SHA der bisherigen Version notieren (40 Zeichen; für einen späteren Rückweg)
alt=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker compose ps -q carrera-planer)")
echo "$alt"
./backup.sh                 # immer vorher sichern
# einen früheren Rückweg aufheben: CARRERA_TAG entfernen, damit wieder latest gilt
grep -v '^CARRERA_TAG=' .env > .env.neu; mv .env.neu .env
docker compose pull
docker compose up -d
docker compose ps                # healthy
# Prüfschritt: Revision des LAUFENDEN Containers
neu=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker compose ps -q carrera-planer)")
[ "$neu" != "$alt" ] && echo "NEU: $alt -> $neu" || echo "UNVERÄNDERT: läuft weiter $alt"
```

Erwartet ist der volle SHA des neuesten `main`-Builds, also die Version mit Tag `latest` unter
GitHub → Packages → `carrera-planer`. `$neu` muss genau dieser SHA sein, mindestens aber anders als
`$alt`.

Passt es nicht:
- **`UNVERÄNDERT`** und unter Packages trägt `latest` denselben SHA wie `$alt`: Es gibt keine neuere
  Version, nichts zu tun.
- **`UNVERÄNDERT`** obwohl es eine neuere Version gibt, oder **`NEU`** mit einem anderen SHA als
  erwartet: `pull` oder `up -d` ist gescheitert, die alte Version läuft weiter. Ausgabe von
  `docker compose pull` und `docker compose up -d` lesen (z. B. `denied`, `manifest unknown`, kein
  Netz), Ursache beheben, Update wiederholen. Steht `CARRERA_TAG` noch in `.env`
  (`grep CARRERA_TAG .env`), hat das Entfernen nicht gewirkt.
- **`docker compose ps` zeigt `Restarting`**: Die neue Version läuft nicht stabil; siehe
  Fehlerbilder, notfalls Rückweg auf `$alt`.

Ohne das Entfernen von `CARRERA_TAG` zöge ein Update nach einem Rückweg still weiter die alte
Version, und `docker compose ps` zeigte trotzdem `healthy`.

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

Nötig ist der **volle, 40-stellige** SHA; ghcr.io kennt keine Kurzform, ein 7-stelliger SHA
scheitert immer mit `manifest unknown`. Den SHA der vorigen Version hat das Update notiert
(`$alt`, Abschnitt „Update“). Fehlt die Notiz: Abschnitt „Welche Version läuft?“, vollen SHA einer
Version finden, zu der es ein Image gibt.

```sh
cd ~/carrera-planer
ziel=<voller 40-stelliger Commit-SHA>
# genau eine Zeile CARRERA_TAG: eine vorhandene ersetzen, nicht anhängen
grep -v '^CARRERA_TAG=' .env > .env.neu; mv .env.neu .env
echo "CARRERA_TAG=$ziel" >> .env
docker compose up -d
docker compose ps                # healthy
# Prüfschritt: Revision des LAUFENDEN Containers
ist=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker compose ps -q carrera-planer)")
[ "$ist" = "$ziel" ] && echo "OK: läuft $ist" || echo "FALSCH: läuft $ist, Ziel $ziel"
```

Meldet der Prüfschritt `FALSCH`, läuft die bisherige Version weiter. Meist hat `up -d` mit
`manifest unknown` bzw. `not found` abgebrochen: Der SHA ist gekürzt, vertippt, oder zu diesem
Commit gibt es kein Image. Vollen SHA einer vorhandenen Version suchen (siehe oben) und den Rückweg
damit wiederholen. Will man doch auf der laufenden Version bleiben, die falsche Zeile wieder
entfernen (`grep -v '^CARRERA_TAG=' .env > .env.neu; mv .env.neu .env`), sonst scheitert jedes
spätere `docker compose up -d` an ihr.

Zurück auf die aktuelle Version geht es mit dem Abschnitt „Update“; er entfernt `CARRERA_TAG`
wieder.

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

- **Container startet immer wieder neu, Log nennt `/data/carrera-planer.sqlite` und „nicht
  beschreibbar“:** `docker compose up -d` endet trotzdem mit 0. Der Server bricht beim Start ab,
  `restart: unless-stopped` startet ihn erneut; `docker compose ps` zeigt `Restarting (1)`, und
  `docker compose logs` wiederholt die Meldung. Ursache: `data/` oder die Datenbankdateien gehören
  nicht UID 1000 bzw. sind schreibgeschützt. Prüfen mit `ls -ln data`. Gehören sie nicht UID 1000:
  `sudo chown -R 1000:1000 data`. Gehören sie UID 1000, sind aber ohne Schreibrecht (z. B. `0444`):
  `chmod u+w data data/carrera-planer.sqlite*`. Danach `docker compose restart`.
- **`docker compose pull` bzw. `up -d` meldet `denied` oder `unauthorized`:** Das Paket auf ghcr.io
  ist noch privat (Erst-Deploy, Schritt „Vorher, einmalig“) oder der Image-Name ist vertippt
  (`CARRERA_IMAGE` in `.env`?). Paket auf Public stellen, dann erneut `docker compose pull`.
- **Container startet immer wieder neu, Log nennt „CARRERA_ALLOWED_HOSTS: ungültiger Eintrag“:**
  Ein Eintrag in `.env` ist kein Name und keine Adresse, z. B. ein stehen gebliebener Platzhalter
  `<LAN-IP>`. Eintrag korrigieren, dann `docker compose up -d`.
- **421 `FremderHost` im Browser:** Der Name in der Adresszeile (samt Port) steht nicht in
  `CARRERA_ALLOWED_HOSTS`. In `.env` ergänzen, dann `docker compose up -d`.
- **`unhealthy` in `docker compose ps`:** `docker inspect --format '{{json .State.Health}}'
  "$(docker compose ps -q carrera-planer)"` zeigt die letzten Prüfungen. `unhealthy` startet den Container nicht neu; das tut
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
