# akq-bot-stub

Interactive Slack bot scaffold that walks a user through collecting project attributes (for a Notion database integration) via direct messages. Deployed as an AWS Lambda Function URL and shipped via GitHub Actions with OIDC.

## Prerequisites

- Node.js 20+
- Docker (required for building the Lambda container image)
- AWS account with access to Systems Manager Parameter Store, Lambda, and ECR
- GitHub repository connected to this project

## Local development

Install dependencies:

```bash
npm install
```

## Deployment configuration

1. **Provide Slack credentials** to the Lambda runtime.  
   Either store them in AWS Systems Manager Parameter Store (shown below) *or* set them directly on the Lambda environment variables.

   ```bash
   aws ssm put-parameter \
     --name "/akq-bot/prod/SLACK_SIGNING_SECRET" \
     --type "SecureString" \
     --value "<your_slack_signing_secret>" \
     --region eu-central-1

   aws ssm put-parameter \
     --name "/akq-bot/prod/SLACK_BOT_TOKEN" \
     --type "SecureString" \
     --value "xoxb-<your_bot_token>" \
     --region eu-central-1
   ```
2. **Set the Notion integration secrets** on the Lambda:  
   - `NOTION_TOKEN`: Internal integration token from Notion (Setup → Connections → Develop or Manage integrations).  
   - `NOTION_DATABASE_ID`: ID der Projektdatenbank (Share → Copy link, then extract the 32 character ID).  
   - `NOTION_ACQ_DATABASE_ID` *(optional)*: ID der Kunden-Akquise-Datenbank für `/newacquisition`.  
   - `NOTION_ACQ_RESEARCH_DATABASE_ID` *(optional)*: ID der Forschungsprojekt-Akquise-Datenbank, die ausgewählt wird, wenn der Nutzer im Flow „Forschungsprojekt“ auswählt.  
   Configure them as Lambda environment variables or SSM parameters referenced in `serverless.yml`.  
   Vergiss nicht, die Datenbank mit der Integration zu teilen (Notion → Share → Invite → Integration auswählen).
   Achte darauf, dass die ID keine zusätzlichen Zeichen (z. B. Punkt am Ende) enthält – der Bot entfernt zwar Sonderzeichen, aber die ID sollte exakt 32 Hex-Zeichen umfassen.
3. **Configure GitHub → AWS OIDC** with an IAM role similar to `arn:aws:iam::<ACCOUNT_ID>:role/GitHubActionsOIDCDeploy`. Grant it permissions for CloudFormation, Lambda, IAM PassRole, and SSM read.
4. **Review** `.github/workflows/deploy.yml` and update the `role-to-assume` value with your account ID. Ensure the IAM role grants CloudFormation, Lambda, ECR (GetAuthorizationToken, BatchCheckLayerAvailability, PutImage, InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload), IAM PassRole (if needed), and SSM `GetParameter` permissions.
5. **Optionally adjust `NOTION_PROPERTIES` / `QUESTION_FLOW`** in `src/index.js` if eure Datenbank andere Property-Namen nutzt.
6. **(Optional) Set OneDrive defaults** via environment variables:
   - `ONEDRIVE_BASE_URL`: Fallback-Link für Projektordner.
   - `ONEDRIVE_PARENT_PATH`: Pfad innerhalb des Drives für Projektordner (z. B. `Internal_FloodWaive/02_Projekte`).
   - `ONEDRIVE_ACQ_BASE_URL`: Fallback-Link für Akquiseordner.
   - `ONEDRIVE_ACQ_PARENT_PATH`: Pfad innerhalb des Drives für Akquiseordner (Standard: `Internal_FloodWaive/00_Akquise`).
   - Weitere Graph-Variablen siehe Abschnitt *OneDrive-Integration*.

Push to `main` to deploy using Serverless Framework (`serverless.yml` provisions the Lambda and Function URL).

To inspect the deployed URL:
```bash
npx serverless info --verbose
```

## Conversation flow

Running `/newproject` oder `/newacquisition` startet einen Thread im Channel, in dem der Slash-Command ausgeführt wurde. Dort sammelt der Bot Schritt für Schritt die Eigenschaften aus dem jeweiligen Fragebogen, zeigt für Personenfelder eine Liste der möglichen Notion-Nutzer, lässt Auswahlfragen (z. B. Projekttyp oder „Status des Kontakts“) per Buttons beantworten und erstellt anschließend den Datensatz in Notion **sowie automatisch einen Slack-Channel** (`prj_<slug>` für Projekte, `akq_<slug>` für Akquisen; der Aufrufer wird hinzugefügt). Beim Akquise-Flow fragt der Bot zunächst, ob es sich um eine Kunden- oder Forschungsprojekt-Akquise handelt, wechselt dann in den passenden Fragenkatalog und nutzt die in `NOTION_ACQ_DATABASE_ID` bzw. `NOTION_ACQ_RESEARCH_DATABASE_ID` hinterlegten Datenbanken. Zum Schluss postet der Bot eine Zusammenfassung mit Notion- und OneDrive-Link sowohl in den Thread als auch – bei neuen Channels – direkt als erste Nachricht im Channel. Mit `stop` kann der Nutzer den Flow jederzeit abbrechen.
Wichtig: Der Bot muss Mitglied des Channels sein. Falls du die Meldung erhältst, dass er nicht posten darf, lade ihn mit `/invite @akq-bot-stub` ein und starte den Flow erneut.

Nachdem ein Projekt-Channel (`prj_*`) angelegt wurde, achtet der Bot auf neue Datei-Uploads. Der jeweilige Uploader bekommt eine ephemere Nachfrage, ob die Datei in den zum Projekt gehörenden OneDrive-Ordner verschoben werden soll (Link aus der Notion-Property). Dabei lässt sich nun direkt ein Zielordner auswählen – der Bot zeigt Vorschläge anhand des Dateinamens und der Ordnerstruktur (`projectstructure/` bzw. `acquisitionstructure/`). Bei Zustimmung lädt der Bot die Slack-Datei (`files:read`-Scope erforderlich) über Microsoft Graph direkt in den gewählten Ordner (bis 4 MB via Direkt-Upload, größere Dateien über Upload-Sessions). Die OneDrive-Umgebungsvariablen müssen dafür gesetzt sein, und für private Channels wird zusätzlich `groups:read` benötigt, damit der Bot an die Channel-Metadaten kommt. Das gleiche Verhalten gilt für Akquise-Channels (`akq_*`): die passende Notion-Seite wird gesucht, die Ordnerstruktur (`acquisitionstructure/`) gespiegelt und doppelte Nachfragen über Marker im Thread verhindert.

Standardmäßig lädt der Bot Julian (`U04E6N323DY`) und Adrian (`U04E04A07T8`) in jeden neuen Projekt- oder Akquise-Channel ein. Setze optional `SLACK_PROJECT_CHANNEL_MEMBERS` auf eine andere kommaseparierte Liste von Slack User-IDs, wenn ihr das Verhalten anpassen wollt. Die Abschlussnachricht landet außerdem direkt als erste Nachricht im frisch erzeugten Channel, und der Channel-Topic/Purpose wird mit dem Notion- und OneDrive-Link vorbelegt.

Aktuell erfasst der Flow folgende Felder analog zur Notion-Datenbank (Property-Namen siehe `NOTION_PROPERTIES` in `src/index.js`):

- `Name` (Titel)
- `Budget` (Number)
- `Zeitraum` (Date mit Start/Ende)
- `Inhaltlich` (People)
- `Koordination` (People)
- `Art` (Select mit Optionen `Kundenprojekte`, `Forschungsprojekt`, `Internes Projekt`)
- `OneDrive` (URL) – wird automatisch mit dem erzeugten Ordner-Link befüllt
- Projekttitel werden automatisch mit einem Präfix `P_YYXXX_` versehen (`YY` = aktuelles Jahr, `XXX` = fortlaufende Nummer pro Jahr). Bestehende Nummern im Workspace werden ausgelesen, und Leerzeichen im Namen werden durch `_` ersetzt.

Die Notion-Anbindung erstellt unmittelbar einen Eintrag in der Datenbank. Personen werden über den Namen aufgelöst (`notion.users.list`). Falls ein Name nicht eindeutig gefunden wird, informiert der Bot den Nutzer in der Abschlussnachricht und lässt das People-Feld leer.
Tipp: Gib die Person genauso an, wie sie in Notion erscheint (oder nutze einen Slack-@Mention), sonst kann die Zuordnung fehlschlagen.

## Docker image deployment

The Lambda function is packaged as a container image defined in the provided `Dockerfile` (based on `public.ecr.aws/lambda/nodejs:20`). Serverless Framework builds and pushes this image to the managed ECR repository during `serverless deploy`, so Docker must be available wherever the deploy runs (locally or in CI).

To build locally for verification:

```bash
docker build -t akq-bot-stub:latest .
```

The resulting image exposes the Lambda handler `src/index.handler`. When deploying via Serverless, the CI workflow runs the same build and publishes it to ECR automatically; no additional manual push is required.

## Slack app setup

Use the manifest below (update URLs if your Lambda Function URL changes):

```yaml
_metadata:
  major_version: 2
  minor_version: 1
display_information:
  name: Akquise und Projekt Bot
  description: Bot für die Erstellung von Projekten und Akquisen
  background_color: "#2047bd"
features:
  bot_user:
    display_name: akq-bot
    always_online: true
  slash_commands:
    - command: /newproject
      url: https://gjxnfweznwiinhyxamgjj6csvu0rwmid.lambda-url.eu-central-1.on.aws/slack/events
      description: Init stub
      should_escape: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - commands
      - im:history
      - im:write
      - channels:history
      - groups:history
      - groups:read
      - channels:manage
      - channels:read
      - files:read
settings:
  event_subscriptions:
    request_url: https://gjxnfweznwiinhyxamgjj6csvu0rwmid.lambda-url.eu-central-1.on.aws/slack/events
    bot_events:
      - message.channels
      - message.groups
      - message.im
      - file_shared
  interactivity:
    is_enabled: true
    request_url: https://gjxnfweznwiinhyxamgjj6csvu0rwmid.lambda-url.eu-central-1.on.aws/slack/events
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

After creating the app from the manifest:

- Install (or reinstall) the app to your workspace and capture the Bot User OAuth Token (`xoxb-…`).
- Copy the Signing Secret from **Basic Information → App Credentials**.
- Configure these secrets on the Lambda function or in SSM as described above.
- Immer erneut installieren, nachdem neue Scopes (z. B. `groups:read` für private Projekt-Channels oder `files:read` für OneDrive-Uploads) ergänzt wurden, sonst stellt Slack die neuen Berechtigungen nicht zur Verfügung.

Smoke test:

- `GET https://YOUR_LAMBDA_URL_BASE/healthz` → `ok`
- In Slack, run `/newproject` in any channel → expect an ephemeral confirmation and eine Thread-Konversation, die Projektdetails einsammelt

## OneDrive-Integration (Microsoft Graph)

Der Bot legt bei jedem neuen Projekt automatisch einen Ordner über Microsoft Graph an und speichert den SharePoint-Link in Notion. Dafür müssen folgende Umgebungsvariablen gesetzt sein (z. B. als Lambda-Umgebungsvariablen oder SSM-Parameter):

- `ONEDRIVE_CLIENT_ID` – Client ID der Azure AD App.
- `ONEDRIVE_CLIENT_SECRET` – zugehöriges Client Secret.
- `ONEDRIVE_TENANT_ID` – Tenant GUID oder Domain (z. B. `contoso.onmicrosoft.com`).
- `ONEDRIVE_DRIVE_ID` – Drive-ID der Dokumentbibliothek (z. B. `b!Msr0V…`). Ermittle sie via Graph (`/sites/{hostname}:/sites/{sitename}` → `/drives`).
- `ONEDRIVE_PARENT_PATH` *(optional)* – Unterordner innerhalb des Drives, in dem neue Projektordner entstehen sollen (z. B. `Internal_FloodWaive/02_Projekte`). Standard ist das Drive-Root.
- `ONEDRIVE_BASE_URL` *(optional)* – Fallback-Basis-URL, falls Graph nicht erreicht werden kann. Wird nur genutzt, wenn obige Variablen fehlen oder der Graph-Call fehlschlägt.
- `ONEDRIVE_ACQ_PARENT_PATH` *(optional)* – Separater Unterordner für Akquise-Ordner (Standard: `Internal_FloodWaive/00_Akquise`).
- `ONEDRIVE_ACQ_BASE_URL` *(optional)* – Fallback-Basis-URL für Akquise-Ordner (Standard: `https://floodwaivede-my.sharepoint.com/personal/hofmann_floodwaive_de/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fhofmann_floodwaive_de%2FDocuments%2FInternal_FloodWaive%2F00_Akquise&viewid=88fe7efd-76fe-444a-a788-50f2f07d09fd&ga=1`).

Die lokalen Vorlagen `projectstructure/` und `acquisitionstructure/` werden beim Docker-Build ins Lambda-Image kopiert (`Dockerfile`), damit der Bot die Ordnerhierarchie automatisch auf OneDrive replizieren kann. Passe die Ordnerstrukturen im Repository an, wenn ihr andere Templates benötigt.

Vorgehen zur Einrichtung:

1. **Azure AD App registrieren** → neue App für OneDrive/SharePoint.
2. **API-Berechtigungen** → `Files.ReadWrite.All` als *Application Permission*, Admin-Consent erteilen.
3. **Secrets & IDs** → Client secret erzeugen und die Werte für `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`, `ONEDRIVE_TENANT_ID` und `ONEDRIVE_DRIVE_ID` sicher ablegen.
4. **Parent-Pfad validieren** → falls ihr einen Unterordner nutzt, prüft den Pfad mit dem mitgelieferten Script `python3 scripts/test_onedrive.py --share-url "<Link>" --folder-name "<Test>" --parent-path "Internal_FloodWaive/02_Projekte"`.

Das Script `scripts/test_onedrive.py` nutzt dieselben Environment-Variablen, um die Verbindung zu prüfen und testweise einen Ordner anzulegen. Damit könnt ihr vor einer Deployment-Änderung die Berechtigungen validieren.
