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

const ACQUISITION_STATUS_OPTIONS = [
  'Kontakt',
  'Lead Qualifiziert',
  'Bedarfsanalyse / Demo',
  'Angebot',
  'Angebot versendet',
  'Verhandlung',
  'Abgeschlossen & gewonnen',
  'Verloren',
  'To-Do',
  'Archiv',
];

const RESEARCH_STATUS_OPTIONS = ['Idee', 'To-Do', 'In Bearbeitung', 'Eingereicht', 'Abgelehnt', 'Archiv'];

const NOTION_PROPERTIES = {
  title: 'Name',
  budget: 'Budget',
  timeframe: 'Zeitraum',
  contentLead: 'Inhaltlich',
  coordination: 'Koordination',
  projectType: 'Art',
  onedrive: 'OneDrive',
};

const ACQUISITION_NOTION_PROPERTIES = {
  title: 'Name',
  description: 'Projektbeschreibung',
  status: 'Status des Kontakts',
  owner: 'Verantwortlich',
  assignee: 'Assignee',
  due: 'Due',
  onedrive: 'OneDrive',
};

const RESEARCH_ACQ_PROPERTIES = {
  title: 'Name',
  acronym: 'Akronym',
  summary: 'Zusammenfassung',
  description: 'Projektbeschreibung',
  status: 'Status',
  contactStatus: 'Status des Kontakts',
  leadPartner: 'Lead-Partner',
  partners: 'Partner',
  verantwortliche: 'Verantwortlich',
  deadline: 'Deadline',
  timeframe: 'Zeitraum',
  fundingRate: 'Förderquote (%)',
  totalVolume: 'Gesamtvolumen (€)',
  fwVolume: 'FW-Volumen (€)',
  links: 'Links',
  onedrive: 'OneDrive',
};

const FLOW_CONFIGS = {
  project: {
    key: 'project',
    command: '/newproject',
    displayName: 'Projekt',
    introLabel: 'Projektdialog',
    detailsLabel: 'Projektdetails',
    summaryHeading: 'Projektdetails',
    channelPrefix: 'prj',
    channelLabel: 'Projekt-Channel',
    prefixLetter: 'P',
    notionProperties: NOTION_PROPERTIES,
    questionFlow: [
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
        prompt: 'Welcher Projekttyp passt?',
        type: 'button-select',
        options: PROJECT_TYPE_OPTIONS,
        normalize: (input) => normalizeProjectType(input),
      },
    ],
    onedriveParentPathEnv: 'ONEDRIVE_PARENT_PATH',
    databaseEnv: 'NOTION_DATABASE_ID',
    placeholderBaseUrlEnv: 'ONEDRIVE_BASE_URL',
  },
  acquisition: {
    key: 'acquisition',
    command: '/newacquisition',
    displayName: 'Akquise',
    introLabel: 'Akquise-Dialog',
    detailsLabel: 'Akquise-Details',
    summaryHeading: 'Akquise-Details',
    channelPrefix: 'akq',
    channelLabel: 'Akquise-Channel',
    prefixLetter: 'A',
    questionFlow: [
      {
        key: 'acquisitionType',
        label: 'Akquise-Typ',
        prompt: 'Handelt es sich um eine Kundenakquise oder eine Forschungsprojekt-Akquise?',
        type: 'button-select',
        options: [
          { label: 'Kundenakquise', value: 'customer' },
          { label: 'Forschungsprojekt-Akquise', value: 'research' },
        ],
        allowSkip: false,
        variantSelector: true,
        normalize: (input) => ({ ok: true, value: input.trim() }),
      },
    ],
    onedriveParentPathEnv: 'ONEDRIVE_ACQ_PARENT_PATH',
    placeholderBaseUrlEnv: 'ONEDRIVE_ACQ_BASE_URL',
    defaultOnedriveParentPath: 'Internal_FloodWaive/00_Akquise',
    defaultPlaceholderBaseUrl:
      'https://floodwaivede-my.sharepoint.com/personal/hofmann_floodwaive_de/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fhofmann_floodwaive_de%2FDocuments%2FInternal_FloodWaive%2F00_Akquise&viewid=88fe7efd-76fe-444a-a788-50f2f07d09fd&ga=1',
    variants: {
      customer: {
        variantKey: 'customer',
        displayName: 'Kundenakquise',
        summaryHeading: 'Akquise-Details',
        prefixLetter: 'A',
        questionFlow: [
          {
            key: 'projectName',
            label: 'Akquise-Name',
            prompt: 'Wie soll die Akquise heißen?',
            normalize: (input) => {
              const cleaned = input.trim();
              if (!cleaned) {
                return { ok: false, error: 'Ich brauche einen Namen. Versuch es bitte noch einmal.' };
              }
              return { ok: true, value: cleaned };
            },
          },
          {
            key: 'description',
            label: 'Beschreibung',
            prompt: 'Gib mir bitte eine kurze Beschreibung oder den Kontext.',
            normalize: (input) => ({ ok: true, value: input.trim() }),
          },
          {
            key: 'contactStatus',
            label: 'Status des Kontakts',
            prompt: 'Welcher Status beschreibt die Akquise am besten?',
            type: 'button-select',
            options: ACQUISITION_STATUS_OPTIONS,
            normalize: (input) => normalizeAcquisitionStatus(input),
          },
          {
            key: 'owner',
            label: 'Verantwortlich',
            prompt: 'Wer verantwortet die Akquise? (Bitte den Notion-Namen oder @-Name angeben.)',
            normalize: (input) => {
              const cleaned = input.trim();
              if (!cleaned) {
                return { ok: false, error: 'Ich brauche eine verantwortliche Person. Versuch es bitte noch einmal.' };
              }
              return { ok: true, value: cleaned };
            },
          },
          {
            key: 'assignee',
            label: 'Assignee',
            prompt: 'Wer bearbeitet die Akquise? (Optional, Notion-Name oder @-Name)',
            normalize: (input) => ({ ok: true, value: input.trim() }),
          },
        ],
        notionProperties: ACQUISITION_NOTION_PROPERTIES,
        databaseEnv: 'NOTION_ACQ_DATABASE_ID',
        contextType: 'acquisition-customer',
      },
      research: {
        variantKey: 'research',
        displayName: 'Forschungsprojekt-Akquise',
        summaryHeading: 'Forschungsprojekt-Akquise',
        prefixLetter: 'A',
        questionFlow: [
          {
            key: 'projectName',
            label: 'Projektname',
            prompt: 'Wie heißt das Forschungsprojekt?',
            normalize: (input) => {
              const cleaned = input.trim();
              if (!cleaned) {
                return { ok: false, error: 'Ich brauche einen Namen. Versuch es bitte noch einmal.' };
              }
              return { ok: true, value: cleaned };
            },
          },
          {
            key: 'acronym',
            label: 'Akronym',
            prompt: 'Welches Akronym nutzt ihr? (Optional)',
            normalize: (input) => ({ ok: true, value: input.trim() }),
          },
          {
            key: 'summary',
            label: 'Zusammenfassung',
            prompt: 'Gib bitte eine kurze Zusammenfassung (optional).',
            normalize: (input) => ({ ok: true, value: input.trim() }),
          },
          {
            key: 'description',
            label: 'Projektbeschreibung',
            prompt: 'Beschreibe kurz den Inhalt des Projekts (optional).',
            normalize: (input) => ({ ok: true, value: input.trim() }),
          },
          {
            key: 'researchStatus',
            label: 'Status',
            prompt: 'Welcher Status beschreibt das Projekt?',
            type: 'button-select',
            options: RESEARCH_STATUS_OPTIONS,
            normalize: (input) => normalizeResearchStatus(input),
          },
          {
            key: 'leadPartner',
            label: 'Lead-Partner',
            prompt: 'Wer ist Lead-Partner? (Bitte Namen eingeben)',
            normalize: (input) => ({ ok: true, value: input.trim() }),
          },
          {
            key: 'partners',
            label: 'Partner',
            prompt: 'Welche Partner sind beteiligt? (Kommagetrennt, optional)',
            normalize: (input) => ({ ok: true, value: input.trim() }),
          },
          {
            key: 'owner',
            label: 'Verantwortlich',
            prompt: 'Wer verantwortet das Projekt? (Bitte den Notion-Namen oder @-Name angeben.)',
            normalize: (input) => {
              const cleaned = input.trim();
              if (!cleaned) {
                return { ok: false, error: 'Ich brauche eine verantwortliche Person. Versuch es bitte noch einmal.' };
              }
              return { ok: true, value: cleaned };
            },
          },
          {
            key: 'deadline',
            label: 'Deadline',
            prompt: 'Gibt es eine Deadline oder nächste Abgabe? (JJJJ-MM-TT, optional)',
            normalize: (input) => validateOptionalDate(input),
          },
          {
            key: 'startDate',
            label: 'Zeitraum (Start)',
            prompt: 'Wann startet das Projekt? (JJJJ-MM-TT, optional)',
            normalize: (input) => validateOptionalDate(input),
          },
          {
            key: 'endDate',
            label: 'Zeitraum (Ende)',
            prompt: 'Wann endet das Projekt? (JJJJ-MM-TT, optional)',
            normalize: (input) => validateOptionalDate(input),
          },
          {
            key: 'fundingRate',
            label: 'Förderquote (%)',
            prompt: 'Wie hoch ist die Förderquote in %? (optional)',
            normalize: (input) => normalizeOptionalNumber(input),
          },
          {
            key: 'totalVolume',
            label: 'Gesamtvolumen (€)',
            prompt: 'Wie hoch ist das Gesamtvolumen in €? (optional)',
            normalize: (input) => normalizeOptionalNumber(input),
          },
          {
            key: 'fwVolume',
            label: 'FW-Volumen (€)',
            prompt: 'Wie hoch ist das FW-Volumen in €? (optional)',
            normalize: (input) => normalizeOptionalNumber(input),
          },
          {
            key: 'links',
            label: 'Links',
            prompt: 'Gibt es einen relevanten Link (https://…)? (optional)',
            normalize: (input) => normalizeOptionalUrl(input),
          },
        ],
        notionProperties: RESEARCH_ACQ_PROPERTIES,
        databaseEnv: 'NOTION_ACQ_RESEARCH_DATABASE_ID',
        contextType: 'acquisition-research',
      },
    },
  },
};

const PROJECT_CHANNEL_PREFIX = FLOW_CONFIGS.project?.channelPrefix || 'prj';
const ONEDRIVE_UPLOAD_APPROVE_ACTION = 'approve_onedrive_upload';
const ONEDRIVE_UPLOAD_DECLINE_ACTION = 'decline_onedrive_upload';
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const processedFileUploads = new Set();
const CHANNEL_CONTEXT_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const channelContextCache = new Map();

const DEFAULT_PROJECT_CHANNEL_MEMBERS = ['U04E6N323DY', 'U04E04A07T8', 'U08FKS4CT55']; // Julian, Adrian & extra member
const rawProjectMembers =
  (process.env.SLACK_PROJECT_CHANNEL_MEMBERS && process.env.SLACK_PROJECT_CHANNEL_MEMBERS.trim()) ||
  DEFAULT_PROJECT_CHANNEL_MEMBERS.join(',');
const PROJECT_CHANNEL_EXTRA_MEMBERS = rawProjectMembers
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const NOTION_SYSTEM_USER_NAMES = new Set(
  [
    'Notion Automations',
    'Zapier',
    'Gmail™ to Notion',
    'Slack Connector for Notion',
    'Notta',
    'projekt_token',
    'Emails',
    'Notion MCP (Beta)',
    'Notion MCP',
    'Notis',
  ].map((name) => name.trim().toLowerCase()),
);

const SKIP_KEYWORD = 'skip';
const SKIP_HINT_TEXT = 'Schreibe `skip`, um die Frage zu überspringen.';

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
const defaultNotionDatabaseId = sanitizeDatabaseId(process.env.NOTION_DATABASE_ID);
let cachedNotionUsers = null;

Object.values(FLOW_CONFIGS).forEach((flowConfig) => {
  registerFlowCommand(flowConfig);
});

function registerFlowCommand(flowConfig) {
  app.command(flowConfig.command, async ({ ack, command, respond, client, logger }) => {
    await ack();

    const existingSession = sessionStore.get(command.user_id);
    if (existingSession) {
      await respond({
        response_type: 'ephemeral',
        text: 'Ich sammle bereits Angaben für dich. Bitte nutze den bestehenden Thread.',
      });
      return;
    }

    const flow = buildFlowRuntime(flowConfig);

    if (!flow.questions?.length) {
      await respond({
        response_type: 'ephemeral',
        text: 'Es sind noch keine Fragen konfiguriert. Bitte hinterlegt zunächst die Notion-Attribute.',
      });
      return;
    }

    if (!notion) {
      await respond({
        response_type: 'ephemeral',
        text: 'Die Notion-Integration ist noch nicht konfiguriert. Bitte setzt die benötigten Umgebungsvariablen (Token & Datenbank-ID).',
      });
      return;
    }

    if (!flow.databaseId && !flow.variants) {
      await respond({
        response_type: 'ephemeral',
        text: 'Ich kenne die Notion-Datenbank für diesen Flow nicht. Bitte setzt `NOTION_DATABASE_ID` oder die spezifische Flow-Variable.',
      });
      return;
    }

    try {
      const channel = command.channel_id;

      let peopleHint = '';
      try {
        const notionUsers = await listNotionUsers();
        const names = notionUsers.map((user) => user.name).filter(Boolean);
        peopleHint = buildPeopleHint(names);
      } catch (peopleError) {
        logger.warn('Could not fetch Notion users for hint', peopleError);
      }

      const session = {
        userId: command.user_id,
        channel,
        threadTs: null,
        stepIndex: 0,
        answers: {},
        peopleHint,
        flow,
      };
      sessionStore.set(session.userId, session);

      const introLabel = flow.introLabel || 'Dialog';
      await respond({
        response_type: 'ephemeral',
        text: `Alles klar! Ich starte den ${introLabel} gleich hier im Channel. Bitte antworte im Thread.`,
      });

      const detailsLabel = flow.detailsLabel || 'Details';
      const introMessage = await client.chat.postMessage({
        channel,
        text: `Hey <@${command.user_id}>, lass uns die ${detailsLabel} hier im Thread sammeln. Du kannst jederzeit mit \`stop\` abbrechen.`,
      });

      session.threadTs = introMessage.ts;

      await sendQuestion(session, client);
    } catch (error) {
      logger.error('Failed to start onboarding session', error);
      sessionStore.delete(command.user_id);

      await respond({
        response_type: 'ephemeral',
        text: getStartErrorMessage(error),
      });
    }
  });
}

function buildFlowRuntime(flowConfig) {
  const runtime = {
    ...flowConfig,
    prefixLetter: flowConfig.prefixLetter || 'P',
    questions: flowConfig.questionFlow ? flowConfig.questionFlow.map((q) => ({ ...q })) : [],
    notionProperties: flowConfig.notionProperties || NOTION_PROPERTIES,
  };

  runtime.onedriveParentPath = resolveParentPath(flowConfig);
  runtime.placeholderBaseUrl = resolvePlaceholderBase(flowConfig, runtime.onedriveParentPath);
  runtime.databaseId = resolveDatabaseId(flowConfig);
  runtime.variants = flowConfig.variants || null;
  runtime.rawConfig = flowConfig;
  runtime.contextType = flowConfig.contextType || flowConfig.key;
  return runtime;
}

function resolveParentPath(config) {
  return (
    (config.onedriveParentPathEnv && process.env[config.onedriveParentPathEnv]?.trim()) ||
    config.defaultOnedriveParentPath ||
    process.env.ONEDRIVE_PARENT_PATH?.trim() ||
    undefined
  );
}

function activateVariantFlow(baseFlow, variantKey) {
  const variantDefinitions = baseFlow.variants;
  if (!variantDefinitions) {
    return null;
  }
  const variantConfig = variantDefinitions[variantKey];
  if (!variantConfig) {
    return null;
  }

  const mergedConfig = {
    ...baseFlow.rawConfig,
    ...variantConfig,
    command: baseFlow.command,
    channelPrefix: variantConfig.channelPrefix || baseFlow.channelPrefix,
    channelLabel: variantConfig.channelLabel || baseFlow.channelLabel,
    summaryHeading: variantConfig.summaryHeading || baseFlow.summaryHeading,
    introLabel: variantConfig.introLabel || baseFlow.introLabel,
    detailsLabel: variantConfig.detailsLabel || baseFlow.detailsLabel,
    displayName: variantConfig.displayName || baseFlow.displayName,
    prefixLetter: variantConfig.prefixLetter || baseFlow.prefixLetter,
    contextType: variantConfig.contextType || baseFlow.contextType || baseFlow.key,
  };

  const runtime = buildFlowRuntime(mergedConfig);
  runtime.variants = null;
  runtime.variantKey = variantKey;
  runtime.rawConfig = mergedConfig;
  return runtime;
}

function resolvePlaceholderBase(config, parentPath) {
  return (
    (config.placeholderBaseUrlEnv && process.env[config.placeholderBaseUrlEnv]?.trim()) ||
    config.defaultPlaceholderBaseUrl ||
    process.env.ONEDRIVE_BASE_URL ||
    (parentPath
      ? `https://onedrive-placeholder.local/${encodeURIComponent(parentPath.replace(/\//g, '_'))}`
      : 'https://onedrive-placeholder.local/folders')
  );
}

function resolveDatabaseId(config) {
  const fromEnv = config.databaseEnv && sanitizeDatabaseId(process.env[config.databaseEnv]);
  const fallback = sanitizeDatabaseId(config.databaseId);
  return fromEnv || fallback || defaultNotionDatabaseId || '';
}

app.event('message', async ({ event, client, logger }) => {
  if (event.bot_id) {
    return;
  }

  if (event.subtype === 'file_share') {
    await handleFileShareEvent({ event, client, logger });
    return;
  }

  if (event.subtype) {
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
      text: `Alles klar, ich habe den Flow abgebrochen. Starte ihn jederzeit neu mit \`${session.flow?.command ?? '/newproject'}\`.`,
    });
    return;
  }

  await processAnswer(session, rawAnswer, client, logger);
});

app.event('file_shared', async ({ event, client, logger }) => {
  const normalized = await normalizeFileSharedEvent(event, client, logger);
  if (!normalized) {
    return;
  }
  await handleFileShareEvent({ event: normalized, client, logger });
});

app.action(/.+_option_\d+$/, async ({ ack, body, action, client, logger }) => {
  await ack();
  const userId = body.user?.id;
  if (!userId) {
    return;
  }

  const session = sessionStore.get(userId);
  if (!session) {
    return;
  }

  if (body.channel?.id && session.channel !== body.channel.id) {
    return;
  }

  const threadTs = body.container?.thread_ts ?? body.message?.thread_ts;
  if (session.threadTs && threadTs && threadTs !== session.threadTs) {
    return;
  }

  const value = action?.value;
  if (!value) {
    return;
  }

  await processAnswer(session, value, client, logger);
});

app.action(ONEDRIVE_UPLOAD_APPROVE_ACTION, async ({ ack, body, action, client, logger }) => {
  await ack();
  const payload = decodeActionValue(action?.value);
  if (!payload) {
    return;
  }

  try {
    await handleOnedriveUploadApproval({
      payload,
      client,
      logger,
      userId: body.user?.id,
    });
  } catch (error) {
    logger.error('Failed to upload Slack file to OneDrive', error);
    await postEphemeralSafe(client, payload.channelId, body.user?.id, {
      text: 'Beim Hochladen zur OneDrive-Projektmappe ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
    });
  }
});

app.action(ONEDRIVE_UPLOAD_DECLINE_ACTION, async ({ ack, body, action, client }) => {
  await ack();
  const payload = decodeActionValue(action?.value);
  if (!payload) {
    return;
  }
  await postEphemeralSafe(client, payload.channelId, body.user?.id, {
    text: 'Alles klar, ich lade die Datei nicht nach OneDrive hoch.',
    thread_ts: payload.messageTs,
  });
});

app.error((error) => {
  console.error('Slack Bolt error', error);
});

async function createNotionProject(answers, flow) {
  if (!notion || !flow?.databaseId) {
    throw new Error('Notion client oder Datenbank-ID fehlen');
  }

  const unresolvedPeople = [];
  const prefixLetter = flow?.prefixLetter || 'P';
  const { prefixedTitle, prefix, channelSlug, sanitizedBase } = await buildPrefixedTitle(
    answers.projectName,
    { prefixLetter, databaseId: flow.databaseId },
  );

  const onedriveUrl = await ensureOnedriveFolder(prefixedTitle, {
    parentPath: flow?.onedriveParentPath,
    baseUrl: flow?.placeholderBaseUrl,
  });

  let properties = {};
  const context = flow?.contextType || flow?.key;

  if (context === 'acquisition-research') {
    const researchProps = flow.notionProperties || RESEARCH_ACQ_PROPERTIES;
    const [ownerPeople] = await Promise.all([
      resolvePersonProperty(answers.owner, 'Verantwortlich', unresolvedPeople),
    ]);

    properties = {
      [researchProps.title]: {
        title: [
          {
            text: { content: prefixedTitle },
          },
        ],
      },
    };

    if (researchProps.acronym) {
      properties[researchProps.acronym] = { rich_text: toRichText(answers.acronym) };
    }
    if (researchProps.summary) {
      properties[researchProps.summary] = { rich_text: toRichText(answers.summary) };
    }
    if (researchProps.description) {
      properties[researchProps.description] = { rich_text: toRichText(answers.description) };
    }
    if (researchProps.status) {
      properties[researchProps.status] = {
        status: answers.researchStatus ? { name: answers.researchStatus } : null,
      };
    }
    if (researchProps.leadPartner) {
      properties[researchProps.leadPartner] = {
        select: answers.leadPartner ? { name: answers.leadPartner } : null,
      };
    }
    if (researchProps.partners) {
      properties[researchProps.partners] = {
        multi_select: buildMultiSelectValues(answers.partners),
      };
    }
    if (researchProps.verantwortliche) {
      properties[researchProps.verantwortliche] = {
        people: ownerPeople,
      };
    }
    if (researchProps.deadline) {
      properties[researchProps.deadline] = {
        date: answers.deadline ? { start: answers.deadline } : null,
      };
    }
    if (researchProps.timeframe) {
      properties[researchProps.timeframe] = {
        date:
          answers.startDate || answers.endDate
            ? {
                start: answers.startDate || null,
                end: answers.endDate || null,
              }
            : null,
      };
    }
    if (researchProps.fundingRate) {
      properties[researchProps.fundingRate] = {
        number: answers.fundingRate ?? null,
      };
    }
    if (researchProps.totalVolume) {
      properties[researchProps.totalVolume] = {
        number: answers.totalVolume ?? null,
      };
    }
    if (researchProps.fwVolume) {
      properties[researchProps.fwVolume] = {
        number: answers.fwVolume ?? null,
      };
    }
    if (researchProps.links) {
      properties[researchProps.links] = {
        url: answers.links || null,
      };
    }
  } else if (context === 'acquisition-customer' || context === 'acquisition') {
    const acquisitionProps = flow.notionProperties || ACQUISITION_NOTION_PROPERTIES;
    const [ownerPeople, assigneePeople] = await Promise.all([
      resolvePersonProperty(answers.owner, 'Verantwortlich', unresolvedPeople),
      resolvePersonProperty(answers.assignee, 'Assignee', unresolvedPeople),
    ]);

    properties = {
      [acquisitionProps.title]: {
        title: [
          {
            text: { content: prefixedTitle },
          },
        ],
      },
    };

    if (acquisitionProps.description) {
      properties[acquisitionProps.description] = { rich_text: toRichText(answers.description) };
    }
    if (acquisitionProps.status) {
      properties[acquisitionProps.status] = {
        select: answers.contactStatus ? { name: answers.contactStatus } : null,
      };
    }
    if (acquisitionProps.owner) {
      properties[acquisitionProps.owner] = {
        people: ownerPeople,
      };
    }
    if (acquisitionProps.assignee) {
      properties[acquisitionProps.assignee] = {
        people: assigneePeople,
      };
    }
  } else {
    if (answers.startDate && answers.endDate && answers.endDate < answers.startDate) {
      throw new Error('Das Enddatum liegt vor dem Startdatum');
    }

    const projectProps = flow?.notionProperties || NOTION_PROPERTIES;
    const [contentLeadPeople, coordinationPeople] = await Promise.all([
      resolvePersonProperty(answers.contentLead, 'Inhaltlich verantwortlich', unresolvedPeople),
      resolvePersonProperty(answers.coordination, 'Koordination', unresolvedPeople),
    ]);

    const timeframeDate =
      answers.startDate || answers.endDate
        ? {
            start: answers.startDate || null,
            end: answers.endDate || null,
          }
        : null;
    const projectTypeSelect = answers.projectType ? { name: answers.projectType } : null;

    properties = {
      [projectProps.title]: {
        title: [
          {
            text: { content: prefixedTitle },
          },
        ],
      },
      [projectProps.budget]: {
        number: answers.budget ?? null,
      },
      [projectProps.timeframe]: {
        date: timeframeDate,
      },
      [projectProps.projectType]: {
        select: projectTypeSelect,
      },
      [projectProps.contentLead]: {
        people: contentLeadPeople,
      },
      [projectProps.coordination]: {
        people: coordinationPeople,
      },
    };
  }

  const onedrivePropertyName = flow?.notionProperties?.onedrive || NOTION_PROPERTIES.onedrive;
  if (onedriveUrl && onedrivePropertyName) {
    properties[onedrivePropertyName] = {
      url: onedriveUrl,
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: flow.databaseId },
    properties,
  });

  return {
    pageId: response.id,
    url: response.url,
    unresolvedPeople,
    title: prefixedTitle,
    prefix,
    channelSlug,
    sanitizedBase,
    onedriveUrl,
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

function validateOptionalDate(input) {
  const cleaned = input.trim();
  if (!cleaned) {
    return { ok: true, value: null };
  }
  return validateDate(cleaned);
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

function normalizeAcquisitionStatus(input) {
  const cleaned = input.trim();
  if (!cleaned) {
    return {
      ok: false,
      error: `Bitte wähle eine der Optionen: ${ACQUISITION_STATUS_OPTIONS.join(', ')}`,
    };
  }
  const match = ACQUISITION_STATUS_OPTIONS.find(
    (option) => option.toLowerCase() === cleaned.toLowerCase(),
  );
  if (!match) {
    return {
      ok: false,
      error: `Bitte wähle eine der Optionen: ${ACQUISITION_STATUS_OPTIONS.join(', ')}`,
    };
  }
  return { ok: true, value: match };
}

function normalizeResearchStatus(input) {
  const cleaned = input.trim();
  if (!cleaned) {
    return {
      ok: false,
      error: `Bitte wähle eine der Optionen: ${RESEARCH_STATUS_OPTIONS.join(', ')}`,
    };
  }
  const match = RESEARCH_STATUS_OPTIONS.find(
    (option) => option.toLowerCase() === cleaned.toLowerCase(),
  );
  if (!match) {
    return {
      ok: false,
      error: `Bitte wähle eine der Optionen: ${RESEARCH_STATUS_OPTIONS.join(', ')}`,
    };
  }
  return { ok: true, value: match };
}

function normalizeOptionalNumber(input) {
  const cleaned = input.trim();
  if (!cleaned) {
    return { ok: true, value: null };
  }
  const parsed = parseNumber(cleaned);
  if (parsed == null) {
    return {
      ok: false,
      error: 'Ich konnte keine Zahl erkennen. Bitte gib eine Zahl an oder lasse das Feld leer.',
    };
  }
  return { ok: true, value: parsed };
}

function normalizeOptionalUrl(input) {
  const cleaned = input.trim();
  if (!cleaned) {
    return { ok: true, value: null };
  }
  try {
    const url = new URL(cleaned);
    return { ok: true, value: url.toString() };
  } catch {
    return {
      ok: false,
      error: 'Das sieht nicht nach einer gültigen URL aus. Bitte nutze das Format https://…',
    };
  }
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

async function buildPrefixedTitle(baseName, options = {}) {
  if (!options.databaseId) {
    throw new Error('Notion-Datenbank-ID fehlt für die Präfix-Ermittlung');
  }
  const stripped = stripExistingPrefix(baseName);
  const baseForSanitizing =
    stripped && stripped.toLowerCase() !== 'unbenanntes projekt'
      ? stripped
      : baseName?.trim()
        ? baseName
        : 'Projekt';
  const sanitizedBase = sanitizeTitle(baseForSanitizing);
  const yearSuffix = String(new Date().getFullYear()).slice(-2);
  const prefixLetter = options.prefixLetter || 'P';
  const matcher = new RegExp(`^${prefixLetter}[_-]?${yearSuffix}(\\d{3})`, 'i');

  let cursor;
  let maxSequence = 0;

  do {
    const response = await notion.databases.query({
      database_id: options.databaseId,
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
  const prefix = `${prefixLetter}${yearSuffix}${sequenceStr}_`;
  const prefixedTitle = `${prefix}${sanitizedBase}`;
  const channelSlug = buildChannelSlug(sanitizedBase);

  return { prefixedTitle, prefix, sequence: nextSequence, channelSlug, sanitizedBase };
}

function stripExistingPrefix(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) {
    return 'Unbenanntes Projekt';
  }
  const withoutPrefix = trimmed.replace(/^[A-Z][_ -]?\d{5}[_\s-]*/i, '');
  const normalized = withoutPrefix.replace(/^_+/, '').trim();
  return normalized || 'Unbenanntes Projekt';
}

function sanitizeTitle(name) {
  const replaced = (name ?? '').replace(/\s+/g, '_');
  const collapsed = replaced.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return collapsed || 'Projekt';
}

function sanitizeDatabaseId(raw) {
  if (!raw) {
    return '';
  }
  return raw.trim().replace(/[^a-f0-9]/gi, '');
}

function buildChannelSlug(sanitizedBase) {
  const lower = (sanitizedBase ?? '').toLowerCase();
  const cleaned = lower.replace(/[^a-z0-9_-]/g, '_');
  const collapsed = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const slug = collapsed || 'projekt';
  return slug.slice(0, 60);
}

function buildPeopleHint(names) {
  if (!names?.length) {
    return '';
  }

  const filtered = names
    .map((name) => name?.trim())
    .filter(Boolean)
    .filter((name) => !isSystemNotionUser(name));

  if (!filtered.length) {
    return '';
  }

  const unique = [];
  for (const name of filtered) {
    if (!unique.includes(name)) {
      unique.push(name);
    }
  }
  return unique.join(', ');
}

function needsPeopleHint(questionKey) {
  return (
    questionKey === 'contentLead' ||
    questionKey === 'coordination' ||
    questionKey === 'owner' ||
    questionKey === 'assignee'
  );
}

function isSystemNotionUser(name) {
  return NOTION_SYSTEM_USER_NAMES.has(name?.trim().toLowerCase());
}

function canSkipQuestion(question) {
  return Boolean(question) && question.allowSkip !== false;
}

function isSkipAnswer(input) {
  return typeof input === 'string' && input.trim().toLowerCase() === SKIP_KEYWORD;
}

function buildActionId(questionKey, index) {
  return `${questionKey}_option_${index}`;
}

function toRichText(value) {
  const text = (value ?? '').trim();
  if (!text) {
    return [];
  }
  return [
    {
      type: 'text',
      text: { content: text },
    },
  ];
}

function buildMultiSelectValues(rawValue) {
  if (!rawValue) {
    return [];
  }
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
let graphTokenCache = null;

async function ensureOnedriveFolder(folderName, options = {}) {
  if (!folderName) {
    return null;
  }

  const baseUrl = options.baseUrl || process.env.ONEDRIVE_BASE_URL || 'https://onedrive-placeholder.local/folders';
  const graphConfig = {
    clientId: process.env.ONEDRIVE_CLIENT_ID?.trim(),
    clientSecret: process.env.ONEDRIVE_CLIENT_SECRET?.trim(),
    tenantId: process.env.ONEDRIVE_TENANT_ID?.trim(),
    driveId: process.env.ONEDRIVE_DRIVE_ID?.trim(),
    parentPath: options.parentPath ?? process.env.ONEDRIVE_PARENT_PATH?.trim(),
  };

  if (!graphConfig.clientId || !graphConfig.clientSecret || !graphConfig.tenantId || !graphConfig.driveId) {
    const placeholderUrl = buildPlaceholderUrl(baseUrl, folderName);
    console.warn('OneDrive Graph config incomplete. Using placeholder URL.', {
      missing: Object.entries(graphConfig)
        .filter(([key, value]) => !value && key !== 'parentPath')
        .map(([key]) => key),
    });
    return placeholderUrl;
  }

  try {
    const token = await getGraphAccessToken(graphConfig);
    const folder = await createGraphFolder({
      driveId: graphConfig.driveId,
      folderName,
      parentPath: graphConfig.parentPath,
      token,
    });
    const shareUrl = await ensureGraphShareLink({
      driveId: graphConfig.driveId,
      itemId: folder?.id,
      token,
    }).catch((shareError) => {
      console.warn('Failed to create OneDrive share link, falling back to webUrl.', shareError);
      return null;
    });

    const resolvedUrl = shareUrl || folder?.webUrl;
    if (resolvedUrl) {
      console.log('OneDrive folder created via Graph API:', resolvedUrl);
      return resolvedUrl;
    }
    throw new Error('Graph response missing both share link and webUrl');
  } catch (error) {
    console.error('Failed to create OneDrive folder via Graph API, falling back to placeholder.', error);
    return buildPlaceholderUrl(baseUrl, folderName);
  }
}

function buildPlaceholderUrl(baseUrl, folderName) {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  return `${normalizedBase}/${encodeURIComponent(folderName)}`;
}

async function getGraphAccessToken(config) {
  const now = Date.now();
  if (graphTokenCache && graphTokenCache.expiresAt > now + 60_000) {
    return graphTokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: GRAPH_SCOPE,
  });

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Graph token request failed (${response.status}): ${details}`);
  }

  const payload = await response.json();
  const expiresIn = Number(payload.expires_in) || 300;
  graphTokenCache = {
    token: payload.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return payload.access_token;
}

async function createGraphFolder({ driveId, folderName, parentPath, token }) {
  const encodedParent = parentPath ? encodeDrivePath(parentPath) : null;
  const path = encodedParent ? `root:/${encodedParent}:/children` : 'root/children';
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/${path}`;
  const body = {
    name: folderName,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'fail',
  };

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 409) {
    // Folder exists -> fetch existing item
    const lookupUrl = buildExistingFolderUrl(driveId, parentPath, folderName);
    response = await fetch(lookupUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Graph folder request failed (${response.status}): ${details}`);
  }

  return response.json();
}

function encodeDrivePath(path) {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildExistingFolderUrl(driveId, parentPath, folderName) {
  const combined = parentPath ? `${parentPath.replace(/\/$/, '')}/${folderName}` : folderName;
  const encoded = encodeDrivePath(combined);
  return `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encoded}:/`;
}

async function ensureGraphShareLink({ driveId, itemId, token }) {
  if (!driveId || !itemId) {
    throw new Error('Missing driveId or itemId for share link creation');
  }

  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`;
  const body = {
    type: 'view',
    scope: 'organization',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Graph share-link request failed (${response.status}): ${details}`);
  }

  const payload = await response.json();
  return payload?.link?.webUrl ?? null;
}

async function sendQuestion(session, client) {
  const questions = session.flow?.questions ?? [];
  const question = questions[session.stepIndex];
  if (!question) {
    return;
  }

  let text = question.prompt;
  if (needsPeopleHint(question.key) && session.peopleHint) {
    text = `${text}\nVerfügbare Personen: ${session.peopleHint}`;
  }
  if (canSkipQuestion(question)) {
    text = `${text}\n${SKIP_HINT_TEXT}`;
  }

  if (question.type === 'button-select' && Array.isArray(question.options)) {
    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
        {
          type: 'actions',
          elements: question.options.map((option, index) => {
            const optionLabel = typeof option === 'string' ? option : option.label;
            const optionValue = typeof option === 'string' ? option : option.value;
            return {
              type: 'button',
              text: { type: 'plain_text', text: optionLabel, emoji: true },
              value: optionValue,
              action_id: buildActionId(question.key, index),
            };
          }),
        },
      ],
    });
    return;
  }

  await client.chat.postMessage({
    channel: session.channel,
    thread_ts: session.threadTs,
    text,
  });
}

async function processAnswer(session, rawAnswer, client, logger) {
  const questions = session.flow?.questions ?? [];
  const question = questions[session.stepIndex];
  if (!question) {
    return;
  }

  if (isSkipAnswer(rawAnswer)) {
    if (!canSkipQuestion(question)) {
      await client.chat.postMessage({
        channel: session.channel,
        thread_ts: session.threadTs,
        text: 'Diese Frage kann ich nicht überspringen – bitte wähle eine der Optionen oder gib einen Wert ein.',
      });
      return;
    }
    session.answers[question.key] = null;
    session.stepIndex += 1;
    if (session.stepIndex < questions.length) {
      await sendQuestion(session, client);
    } else {
      await finalizeSession(session, client, logger);
    }
    return;
  }

  const normalized = question.normalize
    ? question.normalize(rawAnswer)
    : { ok: true, value: rawAnswer };

  if (!normalized.ok) {
    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: normalized.error ?? 'Das konnte ich nicht verarbeiten. Versuche es bitte noch einmal.',
    });
    return;
  }

  if (question.variantSelector) {
    const variantKey = normalized.value;
    const variantFlow = activateVariantFlow(session.flow, variantKey);
    if (!variantFlow) {
      await client.chat.postMessage({
        channel: session.channel,
        thread_ts: session.threadTs,
        text: 'Diesen Akquise-Typ kenne ich nicht. Bitte wähle eine der angezeigten Optionen.',
      });
      return;
    }
    if (!variantFlow.databaseId) {
      await client.chat.postMessage({
        channel: session.channel,
        thread_ts: session.threadTs,
        text: 'Für diesen Akquise-Typ ist noch keine Notion-Datenbank konfiguriert. Bitte setze die passende Umgebungsvariable und versuche es erneut.',
      });
      sessionStore.delete(session.userId);
      return;
    }

    session.answers[question.key] = variantKey;
    session.flow = variantFlow;
    session.stepIndex = 0;
    await sendQuestion(session, client);
    return;
  }

  session.answers[question.key] = normalized.value;
  session.stepIndex += 1;

  if (session.stepIndex < questions.length) {
    await sendQuestion(session, client);
    return;
  }

  await finalizeSession(session, client, logger);
}

async function normalizeFileSharedEvent(event, client, logger) {
  const channel = event.channel_id || event.channel || event.item?.channel;
  const user = event.user_id || event.user;
  if (!channel || !user) {
    return null;
  }

  let files = [];
  if (event.file) {
    files = [event.file];
  } else if (Array.isArray(event.files) && event.files.length) {
    files = event.files;
  } else if (event.file_id) {
    try {
      const info = await client.files.info({ file: event.file_id });
      if (info.file) {
        files = [info.file];
      }
    } catch (error) {
      logger?.error?.('Failed to fetch file info for file_shared event', error);
      return null;
    }
  }

  if (!files.length) {
    return null;
  }

  return {
    channel,
    user,
    files,
    thread_ts: event.message_ts || event.thread_ts,
    ts: event.event_ts || event.ts,
  };
}

async function handleFileShareEvent({ event, client, logger }) {
  try {
    if (!event.channel || !event.user || !Array.isArray(event.files) || !event.files.length) {
      return;
    }

    logger?.debug?.('file_share event detected', {
      channel: event.channel,
      user: event.user,
      fileCount: event.files.length,
    });

    if (!isGraphUploadConfigured()) {
      logger?.debug?.('Skipping OneDrive upload prompt – Graph config incomplete.');
      return;
    }

    if (!notion) {
      logger?.debug?.('Skipping OneDrive upload prompt – Notion client unavailable.');
      return;
    }

    let channelContext = getCachedChannelContext(event.channel);
    if (!channelContext) {
      channelContext = await resolveProjectChannelContext(event.channel, client, logger);
      if (channelContext) {
        cacheChannelContext(event.channel, channelContext);
      }
    }

    if (
      !channelContext ||
      !channelContext.onedriveUrl ||
      channelContext.onedriveUrl.includes('onedrive-placeholder.local')
    ) {
      logger?.debug?.('No valid channel context found for OneDrive upload automation', {
        channel: event.channel,
      });
      return;
    }

    for (const file of event.files) {
      if (!file?.id) {
        continue;
      }

      const cacheKey = `${file.id}:${event.channel}`;
      if (processedFileUploads.has(cacheKey)) {
        continue;
      }
      processedFileUploads.add(cacheKey);
      if (processedFileUploads.size > 5000) {
        processedFileUploads.clear();
      }

      const value = encodeActionValue({
        channelId: event.channel,
        fileId: file.id,
        messageTs: event.ts,
        onedriveUrl: channelContext.onedriveUrl,
        notionPageId: channelContext.notionPageId,
        fileName: file.name || 'Datei',
      });

      const text = `Ich habe die Datei *${file.name || 'ohne Namen'}* gesehen. Soll ich sie im OneDrive-Ordner dieses Projekts speichern?`;
      const blocks = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `${text}\nOrdner: ${channelContext.onedriveUrl}` },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Ja, bitte hochladen', emoji: true },
              style: 'primary',
              action_id: ONEDRIVE_UPLOAD_APPROVE_ACTION,
              value,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Nein', emoji: true },
              action_id: ONEDRIVE_UPLOAD_DECLINE_ACTION,
              value,
            },
          ],
        },
      ];

      await client.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        text,
        thread_ts: event.thread_ts ?? event.ts,
        blocks,
      });
    }
  } catch (error) {
    logger.error('Failed to handle file share event', error);
  }
}

async function finalizeSession(session, client, logger) {
  try {
    const flow = session.flow;
    const notionResult = await createNotionProject(session.answers, session.flow);
    if (notionResult?.title) {
      session.answers.prefixedProjectName = notionResult.title;
      session.answers.projectCode = notionResult.prefix;
    }
    if (notionResult?.channelSlug) {
      session.answers.channelSlug = notionResult.channelSlug;
    }

    const questions = flow?.questions ?? [];
    const summary = questions
      .map(({ label, key }) => {
        const value =
          key === 'projectName'
            ? session.answers.prefixedProjectName ?? session.answers[key]
            : session.answers[key];
        const displayValue =
          typeof value === 'number'
            ? formatNumber(value)
            : value && typeof value === 'string'
              ? value || '—'
              : value ?? '—';
        return `• ${label}: ${displayValue || '—'}`;
      })
      .join('\n');
    const followUp = notionResult?.url ?? 'Ich konnte keine Notion-Seite verlinken. Bitte prüfe die Logs für Details.';

    const heading = flow?.summaryHeading
      ? `Danke! Hier sind die ${flow.summaryHeading}:`
      : 'Danke! Ich habe alle Angaben gesammelt:';
    const messageLines = [heading, summary, ''];

    if (notionResult?.onedriveUrl) {
      messageLines.push(`OneDrive-Ordner: ${notionResult.onedriveUrl}`, '');
    }

    messageLines.push(followUp);

    let flowChannelInfo;
    try {
      if (notionResult?.channelSlug) {
        flowChannelInfo = await ensureFlowChannel({
          client,
          slug: notionResult.channelSlug,
          userId: session.userId,
          logger,
          channelPrefix: flow?.channelPrefix || 'prj',
        });
      }
    } catch (channelError) {
      logger.error('Failed to ensure project channel', channelError);
      messageLines.push(
        '',
        `Hinweis: Der ${flow?.channelLabel ?? 'Projekt-Channel'} konnte nicht erstellt werden. Bitte prüfe meine Slack-Berechtigungen (benötigt \`channels:manage\` und \`channels:read\`).`,
      );
    }

    if (flowChannelInfo?.id) {
      const mention = `<#${flowChannelInfo.id}|${flowChannelInfo.name}>`;
      const infoText = flowChannelInfo.created
        ? `Ich habe den Channel ${mention} erstellt und dich hinzugefügt.`
        : `Channel ${mention} existiert bereits; ich habe dich hinzugefügt (falls nötig).`;
      messageLines.push('', infoText);
      if (flowChannelInfo.created && flowChannelInfo.private === false) {
        messageLines.push(
          '',
          'Hinweis: Private Channels konnten nicht erstellt werden (fehlende Slack-Scopes). Der Channel ist daher öffentlich.',
        );
      }
    }

    if (notionResult?.unresolvedPeople?.length) {
      messageLines.push(
        '',
        'Hinweis: Diese Personen konnte ich nicht automatisch in Notion zuordnen:',
        ...notionResult.unresolvedPeople.map(({ label, value }) => `• ${label}: ${value}`),
      );
    }

    const summaryMessage = messageLines.join('\n');

    await client.chat.postMessage({
      channel: session.channel,
      thread_ts: session.threadTs,
      text: summaryMessage,
    });

    if (flowChannelInfo?.id && (notionResult?.url || notionResult?.onedriveUrl)) {
      await updateProjectChannelDescription({
        client,
        channelId: flowChannelInfo.id,
        notionUrl: notionResult?.url,
        onedriveUrl: notionResult?.onedriveUrl,
        logger,
      });
    }

    if (flowChannelInfo?.id) {
      cacheChannelContext(flowChannelInfo.id, {
        channelName: flowChannelInfo.name,
        notionUrl: notionResult?.url,
        notionPageId: notionResult?.pageId || extractNotionPageIdFromUrl(notionResult?.url),
        onedriveUrl: notionResult?.onedriveUrl,
      });
    }

    if (flowChannelInfo?.created && flowChannelInfo.id) {
      try {
        await client.chat.postMessage({
          channel: flowChannelInfo.id,
          text: summaryMessage,
        });
      } catch (channelMessageError) {
        logger.warn('Failed to post summary in newly created project channel', channelMessageError);
      }
    }
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
}

async function ensureFlowChannel({ client, slug, userId, logger, channelPrefix }) {
  const safePrefix = channelPrefix || 'prj';
  const channelName = `${safePrefix}_${slug}`;
  const membersToInvite = buildProjectChannelMembers(userId);
  const preferredPrivate = true;
  try {
    const { channelId, createdPrivate } = await createSlackChannel({
      client,
      channelName,
      preferredPrivate,
      logger,
    });
    if (channelId) {
      await inviteUsersToChannel(client, channelId, membersToInvite, logger);
    }
    return { id: channelId, name: channelName, created: true, private: createdPrivate };
  } catch (error) {
    if (error.data?.error === 'name_taken') {
      const existing = await findChannelByName(client, channelName);
      if (existing?.id) {
        await inviteUsersToChannel(client, existing.id, membersToInvite, logger);
        return { id: existing.id, name: channelName, created: false };
      }
    }
    throw error;
  }
}

async function createSlackChannel({ client, channelName, preferredPrivate, logger }) {
  const attempts = preferredPrivate ? [true, false] : [false];
  let lastError;
  for (const isPrivate of attempts) {
    try {
      const response = await client.conversations.create({
        name: channelName,
        is_private: isPrivate,
      });
      return { channelId: response.channel?.id, createdPrivate: isPrivate };
    } catch (error) {
      lastError = error;
      const slackError = error.data?.error;
      const canRetryPublic =
        isPrivate &&
        preferredPrivate &&
        ['missing_scope', 'restricted_action', 'not_allowed_token_type'].includes(slackError);
      if (canRetryPublic) {
        logger?.warn?.('Creating private channel failed, retrying as public', {
          channelName,
          error: slackError,
        });
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function findChannelByName(client, name) {
  let cursor;
  do {
    const response = await client.conversations.list({
      limit: 200,
      cursor,
      types: 'public_channel',
    });
    const match = response.channels?.find((channel) => channel.name === name);
    if (match) {
      return match;
    }
    cursor = response.response_metadata?.next_cursor;
  } while (cursor);
  return null;
}

async function updateProjectChannelDescription({ client, channelId, notionUrl, onedriveUrl, logger }) {
  const lines = [];
  if (notionUrl) {
    lines.push(`Notion: ${notionUrl}`);
  }
  if (onedriveUrl) {
    lines.push(`OneDrive: ${onedriveUrl}`);
  }
  if (!lines.length) {
    return;
  }

  const topic = truncateSlackField(lines.join(' | '));
  const purpose = truncateSlackField(lines.join('\n'));

  try {
    await client.conversations.setTopic({ channel: channelId, topic });
  } catch (error) {
    logger?.warn?.('Failed to set channel topic', { channelId, error: error.data?.error });
  }

  try {
    await client.conversations.setPurpose({ channel: channelId, purpose });
  } catch (error) {
    logger?.warn?.('Failed to set channel purpose', { channelId, error: error.data?.error });
  }
}

function truncateSlackField(text, limit = 250) {
  if (!text) {
    return '';
  }
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

async function inviteUsersToChannel(client, channelId, userIds, logger) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueIds.length) {
    return;
  }

  const chunks = chunkArray(uniqueIds, 30);
  for (const chunk of chunks) {
    try {
      await client.conversations.invite({
        channel: channelId,
        users: chunk.join(','),
      });
    } catch (error) {
      const ignoredErrors = ['already_in_channel', 'cant_invite_self', 'not_in_channel'];
      if (!ignoredErrors.includes(error.data?.error)) {
        logger?.warn?.('Failed to invite users to channel', {
          error: error.data?.error,
          channelId,
          users: chunk,
        });
      }
    }
  }
}

function buildProjectChannelMembers(requestingUserId) {
  const combined = [...PROJECT_CHANNEL_EXTRA_MEMBERS];
  if (requestingUserId) {
    combined.push(requestingUserId);
  }
  return combined;
}

function chunkArray(items, size) {
  if (!items.length) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

async function handleOnedriveUploadApproval({ payload, client, logger, userId }) {
  const { channelId, fileId, onedriveUrl, messageTs, fileName } = payload || {};
  if (!channelId || !fileId || !onedriveUrl) {
    throw new Error('Incomplete upload payload');
  }

  if (onedriveUrl.includes('onedrive-placeholder.local')) {
    await postEphemeralSafe(client, channelId, userId, {
      text: 'Für dieses Projekt existiert nur ein Platzhalter-Link. Bitte konfiguriere die OneDrive-Integration und versuche es erneut.',
      thread_ts: messageTs,
    });
    return;
  }

  if (!isGraphUploadConfigured()) {
    await postEphemeralSafe(client, channelId, userId, {
      text: 'Die OneDrive-Integration ist nicht vollständig konfiguriert. Bitte hinterlegt die Graph-Variablen.',
      thread_ts: messageTs,
    });
    return;
  }

  const slackFile = await fetchSlackFileInfo(client, fileId);
  const downloadBuffer = await downloadSlackFile(slackFile);
  const uploadResult = await uploadBufferToOnedrive({
    buffer: downloadBuffer,
    fileName: slackFile.name || fileName || 'Upload',
    folderUrl: onedriveUrl,
    logger,
  });

  const confirmation = uploadResult?.webUrl
    ? `Ich habe *${slackFile.name || fileName || 'die Datei'}* nach OneDrive hochgeladen:\n${uploadResult.webUrl}`
    : `Ich habe *${slackFile.name || fileName || 'die Datei'}* nach OneDrive hochgeladen.`;

  await postEphemeralSafe(client, channelId, userId, {
    text: confirmation,
    thread_ts: messageTs,
  });

  if (messageTs) {
    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `Upload abgeschlossen: ${slackFile.name || fileName || 'Datei'} ist jetzt im OneDrive-Ordner.`,
      });
    } catch (error) {
      logger?.warn?.('Failed to post OneDrive upload confirmation in thread', error);
    }
  }
}

async function fetchSlackFileInfo(client, fileId) {
  const response = await client.files.info({ file: fileId });
  if (!response.file?.url_private_download) {
    throw new Error('Slack file download URL missing');
  }
  return response.file;
}

async function downloadSlackFile(file) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not set');
  }
  const response = await fetch(file.url_private_download, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack file download failed (${response.status}): ${body}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function uploadBufferToOnedrive({ buffer, fileName, folderUrl, logger }) {
  if (!buffer?.length || !fileName || !folderUrl) {
    throw new Error('Missing upload parameters');
  }

  const graphConfig = buildGraphConfig();
  const token = await getGraphAccessToken(graphConfig);
  const folderInfo = await resolveDriveItemFromShareLink(folderUrl, token);
  const envDriveId = graphConfig.driveId;
  const driveId = folderInfo?.parentReference?.driveId || envDriveId;
  const folderId = folderInfo?.id;
  if (!driveId || !folderId) {
    throw new Error('Konnte den OneDrive-Ordner nicht aus dem Link bestimmen.');
  }

  const safeName = sanitizeFilename(fileName);
  if (buffer.length <= SIMPLE_UPLOAD_LIMIT) {
    return simpleGraphUpload({ buffer, driveId, folderId, fileName: safeName, token });
  }
  return chunkedGraphUpload({ buffer, driveId, folderId, fileName: safeName, token, logger });
}

async function simpleGraphUpload({ buffer, driveId, folderId, fileName, token }) {
  const encodedName = encodeURIComponent(fileName);
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodedName}:/content`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Graph upload failed (${response.status}): ${details}`);
  }
  return response.json();
}

async function chunkedGraphUpload({ buffer, driveId, folderId, fileName, token, logger }) {
  const encodedName = encodeURIComponent(fileName);
  const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodedName}:/createUploadSession`;
  const sessionResponse = await fetch(sessionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
      },
    }),
  });
  if (!sessionResponse.ok) {
    const details = await sessionResponse.text();
    throw new Error(`Graph upload session failed (${sessionResponse.status}): ${details}`);
  }
  const sessionPayload = await sessionResponse.json();
  const uploadUrl = sessionPayload?.uploadUrl;
  if (!uploadUrl) {
    throw new Error('Upload session missing uploadUrl');
  }

  let start = 0;
  while (start < buffer.length) {
    const end = Math.min(start + UPLOAD_CHUNK_SIZE, buffer.length);
    const chunk = buffer.slice(start, end);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': chunk.length.toString(),
        'Content-Range': `bytes ${start}-${end - 1}/${buffer.length}`,
      },
      body: chunk,
    });
    if (![200, 201, 202].includes(response.status)) {
      const details = await response.text();
      throw new Error(`Chunk upload failed (${response.status}): ${details}`);
    }
    if (response.status === 200 || response.status === 201) {
      try {
        return await response.json();
      } catch (error) {
        logger?.warn?.('Could not parse final Graph response', error);
        return null;
      }
    }
    start = end;
  }
  return null;
}

async function resolveDriveItemFromShareLink(shareUrl, token) {
  if (!shareUrl) {
    throw new Error('Share link missing');
  }
  const encoded = Buffer.from(shareUrl, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const url = `https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Graph share lookup failed (${response.status}): ${details}`);
  }
  return response.json();
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim() || 'Upload';
}

function buildGraphConfig() {
  return {
    clientId: process.env.ONEDRIVE_CLIENT_ID?.trim(),
    clientSecret: process.env.ONEDRIVE_CLIENT_SECRET?.trim(),
    tenantId: process.env.ONEDRIVE_TENANT_ID?.trim(),
    driveId: process.env.ONEDRIVE_DRIVE_ID?.trim(),
  };
}

function isGraphUploadConfigured() {
  const cfg = buildGraphConfig();
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.tenantId && cfg.driveId);
}

async function resolveProjectChannelContext(channelId, client, logger) {
  const cached = getCachedChannelContext(channelId);
  if (cached) {
    return cached;
  }
  try {
    const info = await client.conversations.info({ channel: channelId });
    const channel = info.channel;
    if (!channel?.name || !channel.name.startsWith(PROJECT_CHANNEL_PREFIX)) {
      return null;
    }

    const combinedMeta = [channel.purpose?.value, channel.topic?.value].filter(Boolean).join('\n');
    const notionUrl = extractLabeledUrl(combinedMeta, 'Notion');
    const pageId = extractNotionPageIdFromUrl(notionUrl);
    if (!pageId) {
      return null;
    }
    const page = await notion.pages.retrieve({ page_id: pageId });
    const onedrivePropertyName = NOTION_PROPERTIES.onedrive;
    const onedriveUrl = extractOnedriveUrlFromPage(page, onedrivePropertyName);
    if (!onedriveUrl) {
      return null;
    }
    const context = {
      channelName: channel.name,
      notionUrl,
      notionPageId: page.id,
      onedriveUrl,
    };
    cacheChannelContext(channelId, context);
    return context;
  } catch (error) {
    if (error.data?.error === 'missing_scope') {
      logger?.warn?.(
        'Missing scope for conversations.info – ensure channels:read and groups:read are granted to the bot.',
      );
      return null;
    }
    logger?.error?.('Failed to resolve project channel context', error);
    return null;
  }
}

function extractOnedriveUrlFromPage(page, propertyName) {
  if (!page?.properties || !propertyName) {
    return '';
  }
  const property = page.properties[propertyName];
  if (!property) {
    return '';
  }
  if (property.type === 'url') {
    return property.url || '';
  }
  if (property.type === 'rich_text') {
    return property.rich_text?.map((item) => item?.plain_text || '').join('').trim() || '';
  }
  if (typeof property.url === 'string') {
    return property.url;
  }
  return '';
}

function extractLabeledUrl(text, label) {
  if (!text || !label) {
    return '';
  }
  const regex = new RegExp(`${label}\\s*:\\s*(https?://\\S+)`, 'i');
  const match = text.match(regex);
  return match ? match[1] : '';
}

function extractNotionPageIdFromUrl(url) {
  if (!url) {
    return '';
  }
  const match = url.match(/[a-f0-9]{32}/i);
  if (!match) {
    return '';
  }
  return formatNotionUuid(match[0]);
}

function formatNotionUuid(raw) {
  if (!raw) {
    return '';
  }
  const hex = raw.replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeActionValue(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeActionValue(value) {
  if (!value) {
    return null;
  }
  try {
    const json = Buffer.from(value, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

async function postEphemeralSafe(client, channel, user, message) {
  if (!client || !channel || !user) {
    return;
  }
  const payload = {
    channel,
    user,
    text: message.text || ' ',
  };
  if (message.thread_ts) {
    payload.thread_ts = message.thread_ts;
  }
  if (message.blocks) {
    payload.blocks = message.blocks;
  }
  try {
    await client.chat.postEphemeral(payload);
  } catch (error) {
    console.warn('Failed to post ephemeral message', safeError(error));
  }
}

function cacheChannelContext(channelId, context) {
  if (!channelId || !context) {
    return;
  }
  channelContextCache.set(channelId, { ...context, cachedAt: Date.now() });
}

function getCachedChannelContext(channelId) {
  if (!channelId) {
    return null;
  }
  const entry = channelContextCache.get(channelId);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAt > CHANNEL_CONTEXT_CACHE_TTL_MS) {
    channelContextCache.delete(channelId);
    return null;
  }
  return entry;
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
