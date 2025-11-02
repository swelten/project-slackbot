import bolt from '@slack/bolt';
import { Client as NotionClient } from '@notionhq/client';

const { App, AwsLambdaReceiver } = bolt;

const PROJECT_TYPE_OPTIONS = ['Kundenprojekte', 'Forschungsprojekt', 'Internes Projekt'];

const PROJECT_TYPE_ALIASES = {
  kundenprojekte: 'Kundenprojekte',
  kundenprojekt: 'Kundenprojekte',
  kunden: 'Kundenprojekte',
  'kunden projekt': 'Kundenprojekte',
  forschungsprojekt: 'Forschungsprojekt',
  forschung: 'Forschungsprojekt',
  forschungsprojekte: 'Forschungsprojekt',
  'internes projekt': 'Internes Projekt',
  intern: 'Internes Projekt',
  'internes-projekt': 'Internes Projekt',
  'internes': 'Internes Projekt',
  'internesprojekt': 'Internes Projekt',
};

const NOTION_PROPERTIES = {
  title: 'Name',
  budget: 'Budget',
  timeframe: 'Zeitraum',
  contentLead: 'Inhaltlich',
  coordination: 'Koordination',
  projectType: 'Art',
};

const QUESTION_FLOW = [
  {
    key: 'projectName',
    label: 'Projektname',
    prompt: 'Wie soll das Projekt heißen?',
    normalize: (input) => {
      const cleaned = input.trim();
      if (!cleaned) {
        return { ok: false, error: 'Ich brauche einen Projektnamen. Versuch es bitte noch einmal.' };
      }
      return { ok: true, value: cleaned };
    },
  },
  {
    key: 'budget',
    label: 'Budget',
    prompt: 'Welches Budget ist eingeplant? (Bitte als Zahl oder Zahl mit Währung angeben.)',
    normalize: (input) => {
      const parsed = parseNumber(input);
      if (parsed == null) {
        return {
          ok: false,
          error: 'Ich konnte kein Budget erkennen. Bitte gib eine Zahl an (z. B. 500 oder 1.250,50).',
        };
      }
      return { ok: true, value: parsed };
    },
  },
  {
    key: 'startDate',
    label: 'Zeitraum (Start)',
    prompt: 'Wann startet das Projekt? (Format z. B. 2024-05-01)',
    normalize: (input) => validateDate(input),
  },
  {
    key: 'endDate',
    label: 'Zeitraum (Ende)',
    prompt: 'Wann endet das Projekt? (Format z. B. 2024-10-31)',
    normalize: (input) => validateDate(input),
  },
  {
    key: 'contentLead',
    label: 'Inhaltlich verantwortlich',
    prompt: 'Wer ist inhaltlich verantwortlich? (Bitte den Notion-Namen oder @-Name angeben.)',
    normalize: (input) => {
      const cleaned = input.trim();
      if (!cleaned) {
        return { ok: false, error: 'Ich brauche eine verantwortliche Person. Versuche es bitte noch einmal.' };
      }
      return { ok: true, value: cleaned };
    },
  },
  {
    key: 'coordination',
    label: 'Koordination',
    prompt: 'Wer koordiniert das Projekt? (Bitte den Notion-Namen oder @-Name angeben.)',
    normalize: (input) => {
      const cleaned = input.trim();
      if (!cleaned) {
        return { ok: false, error: 'Ich brauche eine koordinierende Person. Versuche es bitte noch einmal.' };
      }
      return { ok: true, value: cleaned };
    },
  },
  {
    key: 'projectType',
    label: 'Art des Projekts',
    prompt: `Welche Art von Projekt ist es? (${PROJECT_TYPE_OPTIONS.join(', ')})`,
    normalize: (input) => normalizeProjectType(input),
  },
];

const sessionStore = new Map();

const receiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

const notion =
  process.env.NOTION_TOKEN && process.env.NOTION_TOKEN.trim()
    ? new NotionClient({ auth: process.env.NOTION_TOKEN.trim() })
    : null;
const notionDatabaseId = process.env.NOTION_DATABASE_ID?.trim().replace(/[^a-f0-9-]/gi, '');
let cachedNotionUsers = null;

app.command('/newproject', async ({ ack, command, respond, client, logger }) => {
  await ack();

  if (QUESTION_FLOW.length === 0) {
    await respond({
      response_type: 'ephemeral',
      text: 'Es sind noch keine Fragen konfiguriert. Bitte hinterlegt zunächst die Notion-Attribute.',
    });
    return;
  }

  if (!notion || !notionDatabaseId) {
    await respond({
      response_type: 'ephemeral',
      text: 'Die Notion-Integration ist noch nicht konfiguriert. Bitte setzt `NOTION_TOKEN` und `NOTION_DATABASE_ID` in der Lambda-Umgebung.',
    });
    return;
  }

  const existingSession = sessionStore.get(command.user_id);
  if (existingSession) {
    await respond({
      response_type: 'ephemeral',
      text: 'Ich sammle bereits Angaben für dich. Bitte nutze den bestehenden Thread.',
    });
    return;
  }

  try {
    const channel = command.channel_id;

    const session = {
      userId: command.user_id,
      channel,
      threadTs: null,
      stepIndex: 0,
      answers: {},
    };
    sessionStore.set(session.userId, session);

    await respond({
      response_type: 'ephemeral',
      text: 'Alles klar! Ich starte den Projektdialog gleich hier im Channel. Bitte antworte im Thread.',
    });

    const introMessage = await client.chat.postMessage({
      channel,
      text: `Hey <@${command.user_id}>, lass uns die Projektdetails hier im Thread sammeln. Du kannst jederzeit mit \`stop\` abbrechen.`,
    });

    session.threadTs = introMessage.ts;

    await client.chat.postMessage({
      channel,
      thread_ts: session.threadTs,
      text: [
        'Los geht’s! Bitte beantworte die Fragen direkt in diesem Thread.',
        '',
        QUESTION_FLOW[session.stepIndex].prompt,
      ].join('\n'),
    });
  } catch (error) {
    logger.error('Failed to start onboarding session', error);
    sessionStore.delete(command.user_id);

    await respond({
      response_type: 'ephemeral',
      text: getStartErrorMessage(error),
    });
  }
});

app.event('message', async ({ event, client, logger }) => {
  if (event.subtype || event.bot_id) {
    return;
  }

  const session = sessionStore.get(event.user);
  if (!session) {
    return;
  }

  if (event.channel !== session.channel) {
    return;
  }

  const isThreadReply =
    session.threadTs &&
    (event.thread_ts === session.threadTs || (!event.thread_ts && event.ts === session.threadTs));

  if (!isThreadReply) {
    try {
      await client.chat.postEphemeral({
        channel: session.channel,
        user: session.userId,
        text: 'Bitte antworte direkt im Thread, damit nichts verloren geht.',
      });
    } catch (error) {
      logger.warn('Failed to nudge user back into thread', error);
    }
    return;
  }

  const rawAnswer = (event.text || '').trim();
  if (!rawAnswer) {
    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: 'Bitte gib eine Antwort ein, damit ich weitermachen kann.',
    });
    return;
  }

  if (rawAnswer.toLowerCase() === 'stop') {
    sessionStore.delete(session.userId);
    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: 'Alles klar, ich habe den Flow abgebrochen. Starte ihn jederzeit neu mit `/newproject`.',
    });
    return;
  }

  const currentQuestion = QUESTION_FLOW[session.stepIndex];
  const normalized = currentQuestion.normalize
    ? currentQuestion.normalize(rawAnswer)
    : { ok: true, value: rawAnswer };

  if (!normalized.ok) {
    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: normalized.error ?? 'Das konnte ich nicht verarbeiten. Versuche es bitte noch einmal.',
    });
    return;
  }

  session.answers[currentQuestion.key] = normalized.value;
  session.stepIndex += 1;

  if (session.stepIndex < QUESTION_FLOW.length) {
    const nextQuestion = QUESTION_FLOW[session.stepIndex];
    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: nextQuestion.prompt,
    });
    return;
  }

  try {
    const notionResult = await createNotionProject(session.answers);
    if (notionResult?.title) {
      session.answers.prefixedProjectName = notionResult.title;
      session.answers.projectCode = notionResult.prefix;
    }
    const summary = QUESTION_FLOW.map(({ label, key }) => {
      const value =
        key === 'projectName'
          ? session.answers.prefixedProjectName ?? session.answers[key]
          : session.answers[key];
      const displayValue = typeof value === 'number' ? formatNumber(value) : value;
      return `• ${label}: ${displayValue}`;
    }).join('\n');
    const followUp = notionResult?.url ?? 'Ich konnte keine Notion-Seite verlinken. Bitte prüfe die Logs für Details.';

    const messageLines = [
      'Danke! Ich habe alle Angaben gesammelt:',
      summary,
      '',
      followUp,
    ];

    if (notionResult?.unresolvedPeople?.length) {
      messageLines.push(
        '',
        'Hinweis: Diese Personen konnte ich nicht automatisch in Notion zuordnen:',
        ...notionResult.unresolvedPeople.map(({ label, value }) => `• ${label}: ${value}`),
      );
    }

    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: messageLines.join('\n'),
    });
  } catch (error) {
    logger.error('Failed to create Notion project', error);
    console.error('Notion error details:', JSON.stringify(safeError(error), null, 2));

    let message = 'Beim Anlegen des Notion-Projekts ist ein Fehler aufgetreten. Bitte versuche es später erneut.';
    if (isWrongNotionDatabase(error)) {
      message =
        'Ich konnte die Notion-Datenbank nicht finden. Bitte prüfe, ob `NOTION_DATABASE_ID` korrekt ist und die Integration Zugriff auf die Datenbank hat.';
    } else if (isDeniedNotionAccess(error)) {
      message =
        'Ich habe keinen Zugriff auf die Notion-Datenbank. Bitte teile die Datenbank mit meiner Integration und versuche es erneut.';
    }

    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: message,
    });
  } finally {
    sessionStore.delete(session.userId);
  }
});

app.error((error) => {
  console.error('Slack Bolt error', error);
});

async function createNotionProject(answers) {
  if (!notion || !notionDatabaseId) {
    throw new Error('Notion client oder Datenbank-ID fehlen');
  }

  if (answers.startDate && answers.endDate && answers.endDate < answers.startDate) {
    throw new Error('Das Enddatum liegt vor dem Startdatum');
  }

  const unresolvedPeople = [];

  const [contentLeadPeople, coordinationPeople] = await Promise.all([
    resolvePersonProperty(answers.contentLead, 'Inhaltlich verantwortlich', unresolvedPeople),
    resolvePersonProperty(answers.coordination, 'Koordination', unresolvedPeople),
  ]);

  const { prefixedTitle, prefix } = await buildPrefixedTitle(answers.projectName);

  const properties = {
    [NOTION_PROPERTIES.title]: {
      title: [
        {
          text: { content: prefixedTitle },
        },
      ],
    },
    [NOTION_PROPERTIES.budget]: {
      number: answers.budget ?? null,
    },
    [NOTION_PROPERTIES.timeframe]: {
      date: {
        start: answers.startDate,
        end: answers.endDate,
      },
    },
    [NOTION_PROPERTIES.projectType]: {
      select: { name: answers.projectType },
    },
    [NOTION_PROPERTIES.contentLead]: {
      people: contentLeadPeople,
    },
    [NOTION_PROPERTIES.coordination]: {
      people: coordinationPeople,
    },
  };

  const response = await notion.pages.create({
    parent: { database_id: notionDatabaseId },
    properties,
  });

  return {
    url: response.url,
    unresolvedPeople,
    title: prefixedTitle,
    prefix,
  };
}

function validateDate(input) {
  const cleaned = input.trim();
  const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoPattern.test(cleaned)) {
    return {
      ok: false,
      error: 'Bitte nutze das Format JJJJ-MM-TT, z. B. 2024-05-01.',
    };
  }
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) {
    return {
      ok: false,
      error: 'Das Datum konnte ich nicht lesen. Versuche es bitte erneut (JJJJ-MM-TT).',
    };
  }
  return { ok: true, value: cleaned };
}

function normalizeProjectType(input) {
  const cleaned = input.trim();
  if (!cleaned) {
    return {
      ok: false,
      error: `Bitte wähle eine der Optionen: ${PROJECT_TYPE_OPTIONS.join(', ')}`,
    };
  }

  const lower = cleaned.toLowerCase();
  const canonical =
    PROJECT_TYPE_ALIASES[lower.replace(/[\s_-]+/g, '')] ||
    PROJECT_TYPE_OPTIONS.find((option) => option.toLowerCase() === lower);

  if (!canonical) {
    return {
      ok: false,
      error: `Bitte wähle eine der Optionen: ${PROJECT_TYPE_OPTIONS.join(', ')}`,
    };
  }

  return { ok: true, value: canonical };
}

function parseNumber(rawValue) {
  if (!rawValue) {
    return null;
  }

  const compact = String(rawValue).replace(/\s+/g, '');
  const numericChars = compact.replace(/[^0-9,.-]/g, '');
  if (!numericChars) {
    return null;
  }

  const lastComma = numericChars.lastIndexOf(',');
  const lastDot = numericChars.lastIndexOf('.');

  let normalized = numericChars;
  if (lastComma > lastDot) {
    // Treat comma as decimal separator, remove other punctuation.
    normalized = numericChars
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/(?!^)-/g, '')
      .replace(/[^\d.-]/g, '');
  } else if (lastDot !== -1) {
    // Treat dot as decimal separator.
    normalized = numericChars
      .replace(/,/g, '')
      .replace(/(?!^)-/g, '')
      .replace(/[^\d.-]/g, '');
  } else {
    normalized = numericChars.replace(/(?!^)-/g, '').replace(/[^\d-]/g, '');
  }

  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
    return null;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatNumber(value) {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

async function buildPrefixedTitle(baseName) {
  const trimmedBase = stripExistingPrefix(baseName);
  const yearSuffix = String(new Date().getFullYear()).slice(-2);
  const matcher = new RegExp(`^P[_-]?${yearSuffix}(\\d{3})`, 'i');

  let cursor;
  let maxSequence = 0;

  do {
    const response = await notion.databases.query({
      database_id: notionDatabaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      const titleProp = page.properties?.[NOTION_PROPERTIES.title];
      if (!titleProp || titleProp.type !== 'title') {
        continue;
      }

      const titleText = titleProp.title.map((item) => item.plain_text ?? '').join('').trim();
      if (!titleText) {
        continue;
      }

      const match = matcher.exec(titleText);
      if (match) {
        const seq = Number.parseInt(match[1], 10);
        if (Number.isInteger(seq) && seq > maxSequence) {
          maxSequence = seq;
        }
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  const nextSequence = maxSequence + 1;
  const sequenceStr = String(nextSequence).padStart(3, '0');
  const prefix = `P_${yearSuffix}${sequenceStr}`;
  const prefixedTitle = `${prefix} ${trimmedBase}`;

  return { prefixedTitle, prefix, sequence: nextSequence };
}

function stripExistingPrefix(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) {
    return 'Unbenanntes Projekt';
  }
  return trimmed.replace(/^P[_-]?\d{2}\d{3}\s*/i, '').trim() || 'Unbenanntes Projekt';
}

async function resolvePersonProperty(rawValue, label, unresolvedPeople) {
  if (!rawValue) {
    return [];
  }

  const sanitized = rawValue.replace(/[<@>]/g, '').trim();
  if (!sanitized) {
    return [];
  }

  const userId = await resolveNotionUserId(sanitized);
  if (!userId) {
    unresolvedPeople.push({ label, value: rawValue });
    return [];
  }

  return [{ id: userId }];
}

async function resolveNotionUserId(searchTerm) {
  const lowerSearch = searchTerm.toLowerCase();
  const users = await listNotionUsers();
  const match = users.find((user) => {
    const name = user.name?.toLowerCase();
    if (!name) {
      return false;
    }
    if (name === lowerSearch) {
      return true;
    }
    if (name.replace(/\s+/g, '') === lowerSearch.replace(/\s+/g, '')) {
      return true;
    }
    return false;
  });
  return match?.id ?? null;
}

async function listNotionUsers() {
  if (!notion) {
    return [];
  }
  if (cachedNotionUsers) {
    return cachedNotionUsers;
  }

  const results = [];
  let cursor;
  do {
    const response = await notion.users.list({ start_cursor: cursor });
    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  cachedNotionUsers = results;
  return cachedNotionUsers;
}

function isWrongNotionDatabase(error) {
  const status = error?.status ?? error?.statusCode;
  const code = error?.body?.code;
  return status === 404 && code === 'object_not_found';
}

function isDeniedNotionAccess(error) {
  const status = error?.status ?? error?.statusCode;
  return status === 403;
}

function getStartErrorMessage(error) {
  const slackError = error?.data?.error;
  switch (slackError) {
    case 'not_in_channel':
    case 'channel_not_found':
    case 'missing_scope':
      return 'Ich darf hier (noch) nicht schreiben. Bitte lade mich zuerst mit `/invite @akq-bot-stub` in diesen Channel ein und versuche es dann erneut.';
    case 'is_archived':
      return 'Dieser Channel ist archiviert. Bitte nutze einen aktiven Channel.';
    case 'restricted_action':
      return 'Ich habe nicht genug Berechtigungen für diesen Channel. Bitte prüfe meine Slack-Scopes oder lade mich direkt ein.';
    default:
      return 'Beim Starten des Frage-Antwort-Flows ist etwas schiefgelaufen. Bitte versuche es später erneut.';
  }
}

function safeError(error) {
  if (!error) {
    return null;
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  const base = {
    message: error.message,
    status: error.status ?? error.statusCode,
    code: error.code,
  };
  if (error.body) {
    base.body = {
      object: error.body.object,
      code: error.body.code,
      status: error.body.status,
      message: error.body.message,
      details: error.body?.details,
    };
  }
  return base;
}

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
