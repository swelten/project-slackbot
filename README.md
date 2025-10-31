# akq-bot-stub

Minimal Slack Bolt stub deployed as an AWS Lambda Function URL. Responds to `/init`, verifies Slack signatures, and ships via GitHub Actions with OIDC.

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

1. **Create SSM parameters** (run once per account/region):
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
2. **Configure GitHub → AWS OIDC** with an IAM role similar to `arn:aws:iam::<ACCOUNT_ID>:role/GitHubActionsOIDCDeploy`. Grant it permissions for CloudFormation, Lambda, IAM PassRole, and SSM read.
3. **Review** `.github/workflows/deploy.yml` and update the `role-to-assume` value with your account ID. Ensure the IAM role grants CloudFormation, Lambda, ECR (GetAuthorizationToken, BatchCheckLayerAvailability, PutImage, InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload), IAM PassRole (if needed), and SSM `GetParameter` permissions.

Push to `main` to deploy using Serverless Framework (`serverless.yml` provisions the Lambda and Function URL).

To inspect the deployed URL:
```bash
npx serverless info --verbose
```

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
      description: Init stub
      should_escape: false
      url: https://YOUR_LAMBDA_URL_BASE/slack/events
oauth_config:
  scopes:
    bot:
      - commands
settings:
  interactivity:
    is_enabled: true
    request_url: https://YOUR_LAMBDA_URL_BASE/slack/events
  socket_mode_enabled: false
```

Install the Slack app, then smoke-test:

- `GET https://YOUR_LAMBDA_URL_BASE/healthz` → `ok`
- In Slack, run `/init` in any channel → expect `👋 Stub received in <#CHANNEL>. (No-op for now)`
