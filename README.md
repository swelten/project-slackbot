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
3. **Configure GitHub → AWS OIDC** with an IAM role similar to `arn:aws:iam::<ACCOUNT_ID>:role/GitHubActionsOIDCDeploy`. Grant it permissions for CloudFormation, Lambda, IAM PassRole, and SSM read.
4. **Review** `.github/workflows/deploy.yml` and update the `role-to-assume` value with your account ID. Ensure the IAM role grants CloudFormation, Lambda, ECR (GetAuthorizationToken, BatchCheckLayerAvailability, PutImage, InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload), IAM PassRole (if needed), and SSM `GetParameter` permissions.
5. **Optionally adjust `NOTION_PROPERTIES` / `QUESTION_FLOW`** in `src/index.js` if eure Datenbank andere Property-Namen nutzt.

Push to `main` to deploy using Serverless Framework (`serverless.yml` provisions the Lambda and Function URL).

To inspect the deployed URL:
```bash
npx serverless info --verbose
```

## Conversation flow

Running `/init` opens a direct message with the invoking user. The bot asks each question defined in `QUESTION_FLOW`, speichert die Antworten, erstellt anschließend über `createNotionProject` einen Eintrag in der angegebenen Notion-Datenbank und sendet die Zusammenfassung zurück. Users can type `stop` in the DM to abort the flow.

Aktuell erfasst der Flow folgende Felder analog zur Notion-Datenbank (Property-Namen siehe `NOTION_PROPERTIES` in `src/index.js`):

- Projektname (Titel)
- Budget (Text/Zahl)
- Zeitraum Start & Ende (`YYYY-MM-DD`)
- Inhaltlich verantwortlich (Person)
- Koordination (Person)
- Art des Projekts (`Kundenprojekt`, `Forschungsprojekt`, `Internes Projekt`)

Die Notion-Anbindung erstellt unmittelbar einen Eintrag in der Datenbank. Personen werden über den Namen aufgelöst (`notion.users.list`). Falls ein Name nicht eindeutig gefunden wird, informiert der Bot den Nutzer in der Abschlussnachricht und lässt das People-Feld leer.

## Docker image deployment

The Lambda function is packaged as a container image defined in the provided `Dockerfile` (based on `public.ecr.aws/lambda/nodejs:20`). Serverless Framework builds and pushes this image to the managed ECR repository during `serverless deploy`, so Docker must be available wherever the deploy runs (locally or in CI).

To build locally for verification:

```bash
docker build -t akq-bot-stub:latest .
```

The resulting image exposes the Lambda handler `src/index.handler`. When deploying via Serverless, the CI workflow runs the same build and publishes it to ECR automatically; no additional manual push is required.

## Slack app setup

Use the manifest below and replace `YOUR_LAMBDA_URL_BASE` with the deployed function URL (without trailing slash):

```yaml
_metadata:
  major_version: 2
  minor_version: 1
display_information:
  name: akq-bot-stub
features:
  bot_user:
    display_name: akq-bot
  slash_commands:
    - command: /init
      description: Starte den Projekt-Dialog
      should_escape: false
      url: https://YOUR_LAMBDA_URL_BASE/slack/events
oauth_config:
  scopes:
    bot:
      - commands
      - chat:write
      - im:write
      - im:history
settings:
  event_subscriptions:
    request_url: https://YOUR_LAMBDA_URL_BASE/slack/events
    bot_events:
      - message.im
  interactivity:
    is_enabled: true
    request_url: https://YOUR_LAMBDA_URL_BASE/slack/events
  socket_mode_enabled: false
```

After creating the app from the manifest:

- Install (or reinstall) the app to your workspace and capture the Bot User OAuth Token (`xoxb-…`).
- Copy the Signing Secret from **Basic Information → App Credentials**.
- Configure these secrets on the Lambda function or in SSM as described above.

Smoke test:

- `GET https://YOUR_LAMBDA_URL_BASE/healthz` → `ok`
- In Slack, run `/init` in any channel → expect an ephemeral confirmation and a DM conversation that collects project details
