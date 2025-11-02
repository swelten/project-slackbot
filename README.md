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
   - `NOTION_DATABASE_ID`: ID of the Projektdatenbank (Share → Copy link, then extract the 32 character ID).  
   Configure them as Lambda environment variables or SSM parameters referenced in `serverless.yml`.  
   Vergiss nicht, die Datenbank mit der Integration zu teilen (Notion → Share → Invite → Integration auswählen).
   Achte darauf, dass die ID keine zusätzlichen Zeichen (z. B. Punkt am Ende) enthält – der Bot entfernt zwar Sonderzeichen, aber die ID sollte exakt 32 Hex-Zeichen umfassen.
3. **Configure GitHub → AWS OIDC** with an IAM role similar to `arn:aws:iam::<ACCOUNT_ID>:role/GitHubActionsOIDCDeploy`. Grant it permissions for CloudFormation, Lambda, IAM PassRole, and SSM read.
4. **Review** `.github/workflows/deploy.yml` and update the `role-to-assume` value with your account ID. Ensure the IAM role grants CloudFormation, Lambda, ECR (GetAuthorizationToken, BatchCheckLayerAvailability, PutImage, InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload), IAM PassRole (if needed), and SSM `GetParameter` permissions.
5. **Optionally adjust `NOTION_PROPERTIES` / `QUESTION_FLOW`** in `src/index.js` if eure Datenbank andere Property-Namen nutzt.

Push to `main` to deploy using Serverless Framework (`serverless.yml` provisions the Lambda and Function URL).

To inspect the deployed URL:
```bash
npx serverless info --verbose
```

## Conversation flow

Running `/newproject` startet einen Thread im Channel, in dem der Slash-Command ausgeführt wurde. Dort sammelt der Bot Schritt für Schritt die Eigenschaften aus `QUESTION_FLOW`, erstellt anschließend den Datensatz in Notion **und legt automatisch einen Slack-Channel `prj_<slug>` an** (der Aufrufer wird hinzugefügt). Zum Schluss postet der Bot eine Zusammenfassung mit dem Notion-Link und dem Channel-Hinweis in den Thread. Mit `stop` kann der Nutzer den Flow jederzeit abbrechen.
Wichtig: Der Bot muss Mitglied des Channels sein. Falls du die Meldung erhältst, dass er nicht posten darf, lade ihn mit `/invite @akq-bot-stub` ein und starte den Flow erneut.

Aktuell erfasst der Flow folgende Felder analog zur Notion-Datenbank (Property-Namen siehe `NOTION_PROPERTIES` in `src/index.js`):

- `Name` (Titel)
- `Budget` (Number)
- `Zeitraum` (Date mit Start/Ende)
- `Inhaltlich` (People)
- `Koordination` (People)
- `Art` (Select mit Optionen `Kundenprojekte`, `Forschungsprojekt`, `Internes Projekt`)
- Projekttitel werden automatisch mit einem Präfix `P_YYXXX` versehen (`YY` = aktuelles Jahr, `XXX` = fortlaufende Nummer pro Jahr). Bestehende Nummern im Notion-Workspace werden ausgelesen, damit die Sequenz weiterläuft.

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
      - channels:manage
      - channels:read
settings:
  event_subscriptions:
    request_url: https://gjxnfweznwiinhyxamgjj6csvu0rwmid.lambda-url.eu-central-1.on.aws/slack/events
    bot_events:
      - message.channels
      - message.groups
      - message.im
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

Smoke test:

- `GET https://YOUR_LAMBDA_URL_BASE/healthz` → `ok`
- In Slack, run `/newproject` in any channel → expect an ephemeral confirmation and eine Thread-Konversation, die Projektdetails einsammelt
