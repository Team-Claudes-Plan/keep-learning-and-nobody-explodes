# Keep Learning and Nobody Explodes – Projektnotizen

> Grundlage für die Präsentation: Spielidee, Spielablauf und technische Umsetzung.
> Das Dokument beschreibt den Stand des Repositorys (Branch `main`). Wo Idee und Code voneinander abweichen, steht das ausdrücklich in [Abschnitt 9](#9-stand-der-umsetzung-und-abweichungen-von-der-idee).

---

## 1. Kurzfassung (Elevator Pitch)

**Keep Learning and Nobody Explodes** ist ein kooperatives Lernspiel für Schüler und Studenten. Es ist an das Partyspiel *Keep Talking and Nobody Explodes* angelehnt: Eine Person sieht die Bombe, die andere hält das Handbuch – nur gemeinsam lässt sich die Bombe entschärfen.

Statt fiktiver Rätsel kommen die Fragen aus dem **eigenen Lernmaterial**. Man lädt Skripte, Folien oder Notizen hoch, eine KI erzeugt daraus Fragen, und das Spiel baut daraus eine kleine Welt:

```
Insel      = eine Lern-Etappe          (z. B. „Semester 1“)
 └─ Haus   = ein Thema                 (z. B. „Datenstrukturen“)
     └─ Stockwerk = ein Skill / Lernstand-Level
         └─ Bombe = Fragen, die zu zweit entschärft werden
```

Der Lerneffekt entsteht durch das **Erklären**: Der Experte muss das Wissen in eigenen Worten und über abstrakte Symbole an den Entschärfer weitergeben. Wer nicht versteht, was er erklärt, lässt die Bombe explodieren.

---

## 2. Die Spielidee

### 2.1 Vorbild

In *Keep Talking and Nobody Explodes* sieht ein Spieler die Bombe, ohne das Handbuch zu haben; die anderen haben das Handbuch, aber sehen die Bombe nicht. Die Kommunikation ist das eigentliche Spiel.

Wir übernehmen dieses Prinzip der **Informations-Asymmetrie** und ersetzen den Handbuch-Inhalt durch **Lernstoff**.

### 2.2 Die Spielwelt: Inseln, Häuser, Stockwerke

| Ebene | Bedeutung | Beispiel (Studium) |
|---|---|---|
| **Insel** | Eine Lern-Etappe. Nutzer legen sie selbst an und laden Dokumente hoch. | Semester 1, Semester 2, … Semester *n* |
| **Haus** | Ein Thema, das die KI aus den hochgeladenen Dokumenten erkennt. Die Gebäude sind nach Themen gestaltet. | „Mathematik“, „Algorithmen“, „Rechnernetze“ |
| **Stockwerk** | Eine Lernstufe innerhalb des Themas. Das Erdgeschoss entspricht dem niedrigsten Lernstand (Anfänger), höhere Stockwerke dem fortgeschrittenen Wissen. | „Multiplikation“ → „Division“ → „Bruchrechnung“ |
| **Bombe** | Pro Stockwerk gibt es eine Bombe, die im Koop-Modus entschärft wird. | – |

Ein Haus wächst mit dem Lernfortschritt: Stockwerke werden erst „gebaut“, wenn der Lernstand erreicht ist (siehe [Abschnitt 6](#6-lernfortschritt-und-freischaltung)).

### 2.3 Der Spielablauf

1. Ein Spieler wählt auf der Insel ein Haus und ein Stockwerk und startet eine Session.
2. Der Partner bekommt eine **Einladung** und nimmt sie an. Beide landen im Spiel.
3. Die Bombe besteht aus mehreren **Modulen** (Kabel, Schalter, Zahlenschloss, Terminal, …). Jedes Modul entspricht genau einer Frage.
4. In jeder Runde gibt es zwei Rollen:
   - **Entschärfer (Defuser):** sieht die Bombe und bedient das Modul. Er sieht aber nur Symbole, Zahlen oder Bedienelemente – nicht die Frage selbst bzw. nicht die Bedeutung der Antworten.
   - **Experte (Expert):** liest im Handbuch die Frage und erfährt, was die Symbole bedeuten. Er sieht die Bombe nicht.
5. Beide müssen sprechen: Der Entschärfer beschreibt, was er sieht („ein Kreis mit zwei Strichen …“), der Experte sagt, was zu tun ist.
6. **Nach jeder Runde wechseln die Rollen.**
7. Falsche Antwort = **Strike**. Bei 3 Strikes oder Ablauf der Zeit explodiert die Bombe. Sind alle Module gelöst, ist sie entschärft.

### 2.4 Warum das beim Lernen hilft

- **Erklären als Lernmethode:** Der Experte muss den Stoff verstehen, um die richtigen Anweisungen zu geben.
- **Aktives Abrufen:** Der Entschärfer muss entscheiden und antworten, statt nur zu lesen.
- **Rollenwechsel:** Jeder ist abwechselnd Erklärer und Antwortender.
- **Eigenes Material:** Die Fragen kommen aus dem eigenen Kurs, nicht aus einem generischen Katalog.
- **Soziale Komponente:** Lernen zu zweit, mit Zeitdruck und Spaßfaktor.

---

## 3. Architekturüberblick

```
 ┌──────────────┐  Upload (HTTP)   ┌──────────────┐  S3-API   ┌──────────────┐
 │   Frontend   │ ───────────────▶ │   Backend    │ ────────▶ │   RustFS     │
 │ React + R3F  │                  │ Rust / Axum  │           │ (S3-Storage) │
 │              │ ◀── REST/WS ───▶ │              │ ◀──────── │              │
 └──────────────┘                  │              │  Webhook  └──────────────┘
                                   │  OCR-Worker  │
                                   │  (Apalis)    │
                                   └──────┬───────┘
                                          │ gRPC (ManifestTrials)
                                          ▼
                                   ┌──────────────┐   Chat-Completion   ┌─────────┐
                                   │   Akasha     │ ──────────────────▶ │   LLM   │
                                   │ KI-Pipeline  │ ◀────────────────── │ (OpenAI │
                                   └──────┬───────┘                     │  API)   │
                                          │ schreibt Themen, Skills,    └─────────┘
                                          ▼ Tasks, Anleitungen
                                   ┌──────────────┐
                                   │  PostgreSQL  │  ← auch Job-Queue (Apalis)
                                   └──────────────┘
```

### Komponenten

| Verzeichnis | Rolle | Technik |
|---|---|---|
| `frontend/` | Spiel-UI: Inseln, Häuser, Räume, 3D-Bombe, Handbuch | React 19, TypeScript, Vite, three.js, React Three Fiber, drei, React Router, Bun |
| `backend/` | HTTP-/WebSocket-API, Upload, OCR, Spiel-Sessions | Rust (Edition 2024), Axum, Tokio, sqlx, Apalis |
| `akasha/` | KI-Pipeline: Text → Fragen → Skills | Rust, tonic (gRPC), `async-openai`, Apalis |
| `common/proto` + `common/grpc` | gRPC-Schnittstelle Backend → Akasha | protobuf, tonic-prost |
| `common/config` | gemeinsames Env-Konfigurationsmakro | envy |
| `schema/` | JSON-Schemas für Fragen, Antworten und das Session-Protokoll | JSON Schema |
| `flake.nix` | Komplette Dev-Umgebung (`nix run .#dev`) | Nix, process-compose |

Die Rust-Teile bilden einen Cargo-Workspace (`backend`, `akasha`, `common/*`); das Frontend ist ein eigenständiges Bun-Paket.

---

## 4. Vom Dokument zum Spielinhalt (Ingestion-Pipeline)

Das ist der „KI-Teil“: aus hochgeladenen Dokumenten werden Häuser, Stockwerke und Aufgaben.

### 4.1 Ablauf Schritt für Schritt

1. **Insel anlegen:** `PUT /api/islands/create` (`{ name, partner_id? }`).
2. **Upload:** `POST /upload?island_id=<uuid>` (multipart). Die Datei landet im S3-Speicher unter  
   `uploads/<insel-id>/<uuid>/<dateiname>`. Der Schlüssel trägt die Insel-ID – er ist das Einzige, was der Webhook später kennt.
3. **Webhook:** RustFS meldet das neue Objekt an `/events/rustfs` (authentifiziert per Token). Das Backend liest die Insel aus dem Schlüssel, legt eine Zeile in `documents` an (`ocr_status = queued`) und stellt einen **OCR-Job** in die Postgres-gestützte Queue (Apalis). Doppelte Zustellungen werden per Idempotency-Key abgefangen.
4. **OCR-Worker:** holt das Objekt aus S3, extrahiert den Text mit der Bibliothek *xberg* (inkl. OCR via ONNX Runtime, HEIC-Unterstützung über libheif) und speichert ihn in `documents.ocr_text`.
5. **gRPC an Akasha:** Der Worker sendet Text, Insel-ID und Inselname per `ManifestTrials` (Nachricht `Chronicle`, mit Sprache Deutsch/Englisch).
6. **Akasha-Pipeline** (siehe unten) erzeugt Themen, Skills, Fragen und Anleitungen und schreibt sie direkt in die Datenbank.
7. Das Frontend lädt `GET /api/islands` und platziert jedes Thema als **Haus** auf der Insel.

### 4.2 Akasha – die vierstufige KI-Pipeline

Akasha ist ein eigener Dienst mit einer **schrittbasierten Pipeline** (`akasha/src/pipeline/`). Die Schritte sind nicht fest verdrahtet: Jeder Schritt kann bei Erfolg oder Fehler zu einem beliebigen anderen springen. Fehlgeschlagene Schritte werden mit dem Fehlertext als Feedback wiederholt (Standard: max. 3 Fehler pro Schritt, max. 100 Übergänge).

| # | Schritt | Aufgabe |
|---|---|---|
| 1 | **Extract** | LLM erzeugt aus dem Rohtext Fragen, gruppiert nach Thema. Temperatur 0,2; maximal `PIPELINE_MAX_QUESTIONS` (Standard 10) Fragen. |
| 2 | **Schema** | Rein statische Validierung (ohne LLM): Typen, Indizes, Längen, Duplikate, Themenname ≤ 60 Zeichen usw. |
| 3 | **Review** | Zweiter LLM-Aufruf als Qualitätsprüfer: richtige Sprache, kein Mojibake, keine Platzhalter, keine abgeschnittenen Sätze, kein Markdown/JSON im Text. |
| 4 | **Skill** | LLM ordnet die Fragen jedes Themas **Skills** zu (= Stockwerke). Bestehende Skills der Insel werden wiederverwendet. |

Wichtige Design-Entscheidungen im Prompt (`akasha/src/pipeline/prompt/*.md`):

- **Evidence-first:** Das LLM muss intern ein wörtliches Zitat (15–300 Zeichen) aus dem Material finden, das die Antwort belegt, bevor es die Frage schreibt. Gibt das Material nichts her, wird *keine* Frage erzeugt. Das reduziert Halluzinationen.
- **Wiederverwendung statt Duplikate:** Bestehende Themen und Skills der Insel werden dem LLM mitgegeben und müssen exakt übernommen werden, wenn sie passen. So wachsen Häuser mit weiteren Uploads, statt neu zu entstehen.
- **Qualität vor Menge:** „Fewer high-quality questions are better than many weak ones.“
- **Sprache:** Alle spielerrelevanten Texte werden in der Zielsprache geschrieben, Zitate bleiben im Original.

Das Ergebnis schreibt Akasha selbst in die Tabellen `topics`, `skills`, `tasks` und `instructions`.

### 4.3 Die neun Fragetypen

Definiert in `schema/questions.schema.json` und im Extract-Prompt:

| Typ | Beschreibung |
|---|---|
| `single_choice` | genau eine richtige Option |
| `multiple_choice` | eine oder mehrere richtige Optionen |
| `true_false` | mehrere Aussagen, je wahr/falsch |
| `text_input` | Freitext (ein kanonischer Begriff) |
| `number_input` | Zahl, optional mit Einheit |
| `matching` | linke Elemente rechten Elementen zuordnen |
| `grouping` | Elemente Kategorien zuordnen |
| `coords` | Position in einem Bild anklicken (Prozentkoordinaten) |
| `order` | Elemente in die richtige Reihenfolge bringen |

---

## 5. Das Spiel im Detail

### 5.1 Datenmodell (PostgreSQL, `backend/migrations/`)

```
users ──< island_members >── islands ──< topics ──< skills ──< tasks ──< instructions
                               │  └─ origin_id (Fork)           │           (Handbuch-Text)
                               └──< documents ──────────────────┘ (task.document_id)

games ──< game_parts   (Fragen des Spiels, Position, solved_at / failed_at)
      ──< game_players (Sitz 0/1, rejoin_token, bevorzugte Rolle)
      ──< game_topics  (gewählte Häuser)
      ──< game_events  (Event-Log, gapless sequence – Source of Truth)
```

- **islands:** höchstens **zwei Mitglieder** (im Backend unter Row-Lock erzwungen).
- **topics = Häuser**, eindeutig pro Insel (Groß-/Kleinschreibung egal).
- **skills = Stockwerke**, eindeutig pro Thema.
- **tasks** hängen an einem Skill; das Thema ergibt sich daraus.
- **instructions** enthalten den Handbuchtext zu einer Aufgabe.

Migrationen (nie nachträglich ändern, nur neue anlegen): `0001` Dokumente/Tasks, `0002` Spielschleife, `0003` Session-Protokoll, `0004` Inseln/Nutzer/Forks, `0005` Skills.

### 5.2 Identität

Es gibt **keine Authentifizierung** (Hackathon-Scope). `PUT /api/users/create` legt einen Nutzer an; Anfragen nennen ihren Nutzer über den Header `X-User-Id` (beim WebSocket `?user_id=`). Unbekannte Nutzer erhalten 401.

### 5.3 Session-Protokoll (WebSocket)

Details in `schema/session-protocol.md`. Der **Server ist die Autorität**: Er wählt die Fragen, führt den Timer, prüft Antworten und zählt Strikes. Die Clients rendern nur, was sie bekommen.

- Endpunkt: `GET /api/sessions/ws?user_id=<uuid>`; Lobby-Liste: `GET /api/sessions`.
- Erste Nachricht entscheidet über den Einstieg:

| Nachricht | Wirkung |
|---|---|
| `create` | öffnet eine Lobby (Sitz 0): `topics`, `question_count` (1–11), optional Rolle, `time_limit_secs` (30–3600, Standard 300) |
| `join` | tritt einem wartenden Spiel bei (Sitz 1) und startet es |
| `resume` | Wiedereinstieg mit dem `token` aus `welcome`; optional nur verpasste Events (`last_sequence`) |

- Server-Nachrichten: `welcome`, `snapshot`, `event`, `briefing` (privat pro Spieler und Runde), `presence`, `error`.
- Fehlercodes u. a.: `not_your_turn`, `stale_turn` (verhindert doppelte Strikes bei erneutem Senden), `game_full`, `invalid_token`.

**Spielzustandsautomat:**

```
waiting ──join──▶ active ──┬─ alle Teile gelöst ───▶ won
   │                       ├─ 3 Strikes / Zeitablauf ▶ lost
   └──────forfeit──────────┴─ forfeit ─────────────▶ aborted
```

### 5.4 Informations-Asymmetrie – wie sie technisch erzwungen wird

Der Server schickt **unterschiedliche Briefings** an die beiden Spieler:

- **Entschärfer:** `task` – die Frage in Modulform, aber **ohne `prompt`** (Fragetext) und – bei Auswahlfragen – ohne Antworttexte.
- **Experte:** `prompt` (der Fragetext) und `instruction` (Handbuchseite) sowie die Symbol-Zuordnung.

**Symbole statt Antworttexte:** Bei `single_choice`, `multiple_choice`, `order`, `grouping` und `matching` sieht der Entschärfer statt Texten **abstrakte Symbole** (`glyphs`). Der Experte erhält eine Tabelle `symbols: [{ glyph, text }]`. Die Symbole werden **einmal pro Spiel** vergeben (`backend/src/session/glyphs.rs`), sodass kein Symbol zweimal im Spiel vorkommt und beide Spieler dieselbe Bombe sehen. Die Spieler müssen sich die Formen gegenseitig beschreiben.

Für andere Fragetypen verteilt `frontend/src/game/briefing.ts` die Information so:

| Fragetyp | Entschärfer sieht | Experte liest im Handbuch |
|---|---|---|
| Single/Multiple Choice, Reihenfolge | Frage + Antworten als Symbole | Welches Symbol welche Antwort ist |
| Wahr/Falsch | „Welche Aussage ist wahr?“ + „Aussage 1, 2, …“ | Die Aussagen selbst |
| Zuordnen (matching) | linke Seite im Klartext, rechte Seite als Symbole | Symbol-Bedeutung |
| Gruppieren | Gruppen im Klartext, Elemente als Symbole | Symbol-Bedeutung |
| Zahleneingabe | nur Zahlenschloss/Einheit | Die Frage |
| Texteingabe | Terminal mit „eingeloggtem Nutzer“ (z. B. `luchs_42`) | Frage pro Nutzer |
| Koordinaten | nur das Radar | Die Frage |

Die Frage ist also nie auf einer Seite vollständig – ohne Kommunikation ist keine Antwort möglich.

### 5.5 Event Sourcing

`game_events` ist die **Source of Truth**:

- Event-Typen: `game_created`, `player_joined`, `game_started`, `turn_started`, `answer_submitted`, `game_ended`.
- Jedes Event hat eine lückenlose, steigende `sequence` pro Spiel.
- Events werden **zuerst in die DB geschrieben, dann gesendet** – ein Client sieht nie ein Event, das bei einem Neustart verloren gehen könnte.
- Der Spielzustand ist die Faltung (`fold`) der Events. Daher werden Spiele nach einem Server-Neustart aus dem Log wiederhergestellt; `games`, `game_parts` und `game_players` sind nur Projektionen.
- Live-Spiel und Replay nutzen denselben Code.

### 5.6 Backend-Architektur der Session (`backend/src/session/`)

| Datei | Verantwortung |
|---|---|
| `protocol.rs` | serde-Typen der Wire-Nachrichten (gespiegelt in den JSON-Schemas und in `frontend/src/api/types.ts`) |
| `state.rs` | **reine Regeln ohne IO:** `decide(Command) → Events`, `apply(Event)`; leicht testbar |
| `judge.rs` | vergleicht Antwort mit `tasks.solution` (Text getrimmt/case-insensitive, Multiple Choice als Menge, Koordinaten mit Radius in % – Standard 5) |
| `glyphs.rs` | verteilt die Symbole einmal pro Spiel |
| `actor.rs` | ein Tokio-Task pro laufendem Spiel: decide → in DB persistieren → apply → broadcast; Deadline-Timer; bleibt nach dem Disconnect kurz bestehen |
| `mod.rs` | `Sessions`: validiert `create`, wählt Aufgaben, erzeugt Spiele, stellt Akteure aus dem Event-Log wieder her |
| `api/session.rs` | WebSocket-Glue: Handshake-Timeout, Pings, Resync nach verlorenen Broadcasts |

**Aufgabenauswahl:** `Database::pick_tasks` verteilt die gezogenen Aufgaben auf die Skills der gewählten Themen (statt alles aus einem Skill zu nehmen).

### 5.7 Rollen

- Wählt der Ersteller eine Rolle, bekommt der Beitretende die andere. Wählt nur der Beitretende, zählt seine. Wählt niemand, entscheidet der Zufall.
- **Nach jeder Runde (Turn) werden die Rollen getauscht.**
- Eine falsche Antwort ist ein Strike, der Teil gilt als gescheitert, die nächste Runde beginnt trotzdem.

---

## 6. Lernfortschritt und Freischaltung

Die Regeln stehen rein funktional in `backend/src/knowledge.rs` (mit Unit-Tests):

- **Skill gelernt:** Ein Nutzer hat mindestens **eine Aufgabe des Skills** in irgendeinem Spiel gelöst (`game_parts.solved_at` × `game_players`).
- **Haus-Level:** Anzahl der Skills, die **jedes Mitglied** der Insel gelernt hat, begrenzt auf `MAX_LEVEL = 4` (so viele Stockwerke kann das Frontend zeichnen).
- Ein Haus wird also nur so weit gebaut, wie **alle** Mitglieder den Stoff beherrschen.

### Forks – lernen mit einer dritten Person

Eine Insel hat höchstens zwei Mitglieder. Um mit einer weiteren Person zu lernen, **forkt** ein Mitglied die Insel für sich und die neue Person (`PUT /api/islands/{id}/fork`):

- Dokumente und Themen bleiben auf der **Wurzel-Insel** (`origin_id`, Forks verketten sich nie); ein Upload auf einen Fork wird auf der Wurzel gespeichert.
- Der Fortschritt hängt am Nutzer und Skill, nicht an der Insel. Auf einem Fork sind genau die Stockwerke freigeschaltet, die **beide** Partner schon kennen.

---

## 7. Frontend

### 7.1 Seiten und Navigation (`frontend/src/router.tsx`)

| Route | Inhalt |
|---|---|
| `/` | Titelseite mit animierter Szene |
| `/islands/:islandId?` | Inselansicht: Häuser, Straßen, Fluss, Brücke, Vögel, Tiere, Verkehr, Avatar; Upload-Dialog |
| `/islands/:islandId/houses/:topicId` | Hausansicht: Stockwerke von außen |
| `/islands/:islandId/houses/:topicId/storeys/:storeyId` | Raum eines Stockwerks mit Bombe auf dem Tisch; hier startet man die Session |
| `/koop` | Lobby für Koop-Spiele (mit Backend über WebSocket) |
| `/koop/spiel/:gameId` | Das eigentliche Spiel (`?rolle=expert` für den Experten) |
| `/koop/:seed/bombe`, `/koop/:seed/handbuch` | Offline-/Mock-Koop: beide Seiten leiten die Bombe aus einem gemeinsamen Seed ab |
| `/minigames`, `/minigames/bomb`, `/minigames/modules/:moduleId` | Übungsmodus / Modul-Showcase |

Die Szenenwechsel werden durch eine **Wolken-Transition** (`CloudTransition`) überdeckt.

### 7.2 Spielwelt in 3D

- three.js über React Three Fiber / drei, isometrische Kamera.
- Insel: Low-Poly-Terrain mit Terrassen und Küstenrauschen; Häuser aus **Blender-Bausätzen** (`scripts/blender/houses.py` → `base`, wiederholbares `middle`, `top`), Fassadentexturen aus generierten PBR-Maps (`scripts/generate-textures.mjs`).
- Jedes Haus wird aus einem Thema gestaltet (`data/islands.ts`: `resolveIsland` platziert Themen als Häuser, wählt Design und Gitterzelle).
- Stockwerke bekommen Innenraum-Motive (Kacheln, Dielen, Streifen, Punkte, Raster, Schachbrett) und Konzept-Farben (`data/storeyConcepts.ts`).
- Bombe: GLB-Modell mit 11 Modul-Slots plus Timer-Modul; Timer und Strikes werden live auf eine Canvas-Textur gezeichnet.

### 7.3 Bomben-Module

Jedes Modul ist in 2D und 3D implementiert und deklariert, welche Interaktions-Primitiven es unterstützt (`frontend/src/game/modules/index.ts`). Ein Modul kann mehrere Fragetypen bedienen.

| Modul | Name im Spiel | Fragetypen |
|---|---|---|
| `wires` | Kabel durchschneiden | Single/Multiple Choice, Wahr/Falsch |
| `fuses` | Sicherungskasten | Single/Multiple Choice, Wahr/Falsch |
| `switches` | Schalter umlegen | Multiple Choice, Wahr/Falsch, Gruppieren |
| `rotary` | Drehschalter | Single Choice, Wahr/Falsch, Gruppieren |
| `cables` | Kabel verbinden | Zuordnen, Gruppieren |
| `sorter` | Sortier-Weiche | Gruppieren, Wahr/Falsch |
| `lock` | Zahlenschloss | Zahleneingabe (0–9999) |
| `terminal` | Terminal | Texteingabe, Zahleneingabe |
| `buttons` | Knöpfe drücken | Reihenfolge |
| `slider` | Schiebe-Rätsel | Reihenfolge |
| `radar` | Radar | Koordinaten |

Die Architektur dahinter: **Fragetypen → Adapter → Primitiven → Module**. `adapters.ts` übersetzt Fragen in wenige Interaktionsformen (`pick`, `assign`, `number`, `text`, `sequence`, `point`); `plan.ts` wählt pro Frage zufällig ein passendes Modul. Ein neues Modul braucht nur eine Implementierung der Primitive und einen Eintrag in `MODULES`.

### 7.4 Das Handbuch

Der Experte bekommt ein **aufblätterbares Buch** (`ManualBook.tsx`, Bibliothek *page-flip*) auf einem Samttisch: Ledereinband, pro Modul eine Seite, in gemischter Reihenfolge. Die Seiten zeigen Fragetexte und die Symbol-Zuordnung (`GlyphIcon`, Zeichnungen in `game/glyphs.ts`).

### 7.5 Einladungen und Präsenz

`useInviteFlow` + `api/invites.ts`:

1. Prüfen, ob der Partner online ist.
2. Spiel anlegen (`create`, Zustand `waiting`) und den Partner einladen.
3. Warten (Timeout 60 s). Bei Annahme geht der **Einlader zur Bombe, der Eingeladene zum Handbuch**; bei Ablehnung, Timeout oder Verlassen der Seite wird das Spiel abgebrochen.
4. Standardbombe einer Einladung: **5 Module, 5 Minuten**.

Das Frontend hält dafür einen **User-Channel** (`GET /api/users/ws`) offen mit Reconnect-Backoff (1, 2, 5, 10, 30 s). Ein Nutzer gilt als online, solange mindestens ein Channel offen ist. Nachrichten: `presence`, `invite`, `invite_sent`, `invite_answered`, `invite_cancelled`. Die genaue Spezifikation steht in `frontend/BACKEND_MODIFICATIONS.md`.

### 7.6 Mock-Modus

Ohne `VITE_API_URL` läuft das Frontend komplett gegen In-Memory-Mocks (`api/mock.ts`, `api/mockIslands.ts`) – nützlich für UI-Entwicklung und Demos ohne Backend. Mit Vite-Proxy: `VITE_API_URL=/backend`.

### 7.7 Effekte

Explosion mit Trümmern (`Explosion.tsx`, `boom.ts`, `debris.ts`) bei Niederlage, Feier-Animation (`Celebration.tsx`) bei Erfolg.

---

## 8. Entwicklung, Qualität und Betrieb

### 8.1 Lokale Umgebung

- `nix run .#dev` startet per process-compose den kompletten Stack: **PostgreSQL 18**, **RustFS** (S3 inkl. Webhook-Konfiguration), Setup-Schritte, Backend (`cargo watch`) und Akasha.
- `nix develop` liefert Toolchain und native Bibliotheken (ONNX Runtime, libheif, protoc).
- Frontend: `bun install`, `bun run dev`, `bun run build`, `bun run lint`.
- Lokaler Zustand liegt in `.data/` (Postgres, S3-Objekte, Logs).

### 8.2 Konfiguration

| Dienst | Wichtige Variablen |
|---|---|
| Backend | `DATABASE_URL`, `WEBHOOK_TOKEN`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`; optional `LISTEN_ADDR` (Standard `127.0.0.1:8081`), `MAX_UPLOAD_BYTES` (256 MiB), `S3_REGION` |
| Akasha | `DATABASE_URL`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; optional `ADDRESS` (Port 50051), `CONCURRENCY` (8), `PIPELINE_MAX_STEP_ERRORS` (3), `PIPELINE_MAX_QUESTIONS` (10), `PIPELINE_MAX_TRANSITIONS` (100) |

Das LLM wird über eine **OpenAI-kompatible API** angesprochen (`LLM_BASE_URL`), ist also austauschbar.

### 8.3 Qualitätssicherung

- **CI** (`.github/workflows/lint.yml`): `cargo fmt --check` und `cargo clippy` mit `-D warnings`. Die Clippy-Konfiguration ist streng (pedantic + viele Restriction-Lints).
- Rust-Code folgt den **Pragmatic Rust Guidelines**; Commits folgen **Conventional Commits**.
- **Tests:** Reine Logik (`state.rs`, `judge.rs`, `knowledge.rs`, `webhook.rs`) hat Unit-Tests ohne Datenbank (z. B. Strike-Regeln, Rollenwechsel, Deadline, Replay = Live-Zustand). Tests mit Postgres/S3 sind `#[ignore]` und laufen nur gegen den Dev-Stack (Upload, Session-End-to-End, Inseln/Forks).
- Der Upload ist über das Trait `UploadStore` abstrahiert, damit Tests ohne S3 laufen.

### 8.4 Wichtige Invarianten

- Events werden vor dem Broadcast persistiert.
- Wire-Typen müssen in `protocol.rs`, beiden JSON-Schemas, `types.ts` und `session-protocol.md` gemeinsam geändert werden.
- `GLYPH_COUNT` (Backend) muss der Zahl der Zeichnungen in `frontend/src/game/glyphs.ts` entsprechen.
- Das Schlüsselformat `uploads/<island_id>/<uuid>/<filename>` darf nicht ohne Anpassung des Webhooks geändert werden.

---

## 9. Stand der Umsetzung und Abweichungen von der Idee

Damit die Präsentation ehrlich bleibt, hier die Stellen, an denen der Code von der reinen Spielidee abweicht oder noch unfertig ist:

1. **Stockwerke sind Skills, keine fest definierten Schwierigkeitsstufen.** Die KI gruppiert Fragen in Skills; die Reihenfolge ergibt sich aus der Anlage (`ORDER BY s.created_at`). „Erdgeschoss = Anfänger“ gilt daher so weit, wie die Skills in aufsteigender Schwierigkeit entstehen – eine explizite Schwierigkeitsbewertung durch die KI gibt es nicht.
2. **Die Bombe eines Stockwerks ist noch nicht strikt auf dessen Skill begrenzt.** Eine Session wählt Aufgaben aus den gewählten *Themen* (Häusern) und verteilt sie über deren Skills (`pick_tasks`). Die Einladung startet „die Bombe des Hauses“, nicht gezielt die des einzelnen Stockwerks.
3. **Der Einzelraum (`StoreyPage`) benutzt noch eine Platzhalter-Bombe** mit festem Modul (`cables`); das echte Koop-Spiel läuft über `/koop/spiel/:gameId`.
4. **Keine Authentifizierung.** Nutzer werden per Header/Query identifiziert.
5. **Maximal 4 Stockwerke** pro Haus sichtbar (`MAX_LEVEL`), unabhängig von der Zahl der Skills.
6. **Akasha-Race-Condition (TODO im Code):** Laufen mehrere Jobs parallel, können gleiche Skills in unterschiedlicher Wortwahl entstehen. Ein Lock fehlt noch (`akasha/src/worker.rs`).
7. **Der Skill-Fortschritt zählt „mindestens eine gelöste Aufgabe“** – bewusst einfach gehalten, kein Spaced-Repetition-Modell.
8. **`coords`-Fragen** setzen eine explizit erlaubte Bild-URL im Material voraus; das LLM darf keine Bilder erfinden.
9. **Backend-Ergänzungen fürs Frontend** (User-Channel, Einladungen) sind in `frontend/BACKEND_MODIFICATIONS.md` spezifiziert; das Frontend zeigt Partner als offline, solange der Endpunkt fehlt.

---

## 10. Mögliche nächste Schritte

- Explizite Schwierigkeits-/Level-Bewertung der Skills durch die KI.
- Bombe strikt pro Stockwerk/Skill; Freischaltung höherer Stockwerke erst nach Entschärfen des darunterliegenden.
- Echte Authentifizierung und Nutzerverwaltung.
- Spaced Repetition: Fortschritt verfällt oder wird wiederholt abgefragt.
- Mehr Spieler (Lern-Gruppen) und Ranglisten.
- Weitere Module und Fragetypen; Bildfragen mit hochgeladenen Abbildungen.
- Lock/Deduplizierung für parallele Akasha-Jobs.
- Frontend-Tests (derzeit gibt es kein Test-Skript).

---

## 11. Präsentations-Stichpunkte (Redeleitfaden)

1. **Problem:** Lernen allein ist langweilig, Karteikarten sind passiv.
2. **Idee:** *Keep Talking and Nobody Explodes* trifft auf eigenes Lernmaterial.
3. **Welt:** Inseln (Etappen) → Häuser (Themen) → Stockwerke (Lernstand) → Bomben.
4. **Magie im Hintergrund:** Upload → OCR → KI-Pipeline (Extract, Schema, Review, Skill) → Spielinhalt.
5. **Kernmechanik:** Informations-Asymmetrie – Symbole statt Antworten, Handbuch statt Fragen, Rollenwechsel nach jeder Runde.
6. **Technik:** Rust (Axum, Tokio, sqlx), eigener KI-Dienst per gRPC, WebSocket-Sessions mit Event Sourcing, React + three.js im Frontend.
7. **Robustheit:** Server-autoritativ, Reconnect per Token, Spiele überleben Neustarts.
8. **Fortschritt:** Häuser wachsen nur, wenn **beide** Partner den Stoff beherrschen.
9. **Demo:** Dokument hochladen → Haus erscheint → Einladung → Bombe entschärfen (oder explodieren).
10. **Ausblick:** Schwierigkeitsstufen, Auth, Spaced Repetition, Gruppen.
