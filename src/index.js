import bolt from '@slack/bolt';

const { App, AwsLambdaReceiver } = bolt;

// Receiver validates Slack signatures via Slack signing secret
const receiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Minimal /init stub responding ephemerally in the invoking channel
app.command('/init', async ({ ack, command, respond }) => {
  await ack(); // Slack requires acknowledgement within ~3 seconds
  await respond({
    response_type: 'ephemeral',
    text: `👋 Stub received in <#${command.channel_id}>. (No-op for now)`,
  });
});

// Lambda entrypoint compatible with AWS Lambda Function URLs
export const handler = async (event, context, callback) => {
  const path = event.rawPath || event.path || '/';
  if (path === '/healthz') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'ok',
    };
  }

  const boltHandler = await receiver.start();
  return boltHandler(event, context, callback);
};
