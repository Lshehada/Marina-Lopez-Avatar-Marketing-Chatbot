import { z } from 'zod';

import {
  findSdrIdentity,
  startSession
} from '../services/identityService.js';

import {
  welcomeMessage
} from '../services/chatService.js';

import {
  analyzeConversation
} from '../services/conversationAnalysisService.js';

import {
  getVisitorMetadata
} from '../utils/visitorMetaData.js';

import {
  config
} from '../config/index.js';

import {
  requestConversationClose,
  continueConversation,
  closeConversation,
  updateConversationOutcome
} from '../repositories/conversationRepository.js';

import {
  saveMessage
} from '../repositories/messageRepository.js';

const supportedLanguages = [
  'en',
  'de',
  'it',
  'es',
  'fr'
];

const sessionSchema =
  z.object({
    token: z
      .string()
      .trim()
      .min(1)
      .optional(),

    language: z
      .enum(
        supportedLanguages
      )
      .default('en'),

    landingPage: z
      .string()
      .trim()
      .optional(),

    referrer: z
      .string()
      .trim()
      .optional(),

    source: z
      .string()
      .trim()
      .default('website'),

    utmSource: z
      .string()
      .trim()
      .optional(),

    utmMedium: z
      .string()
      .trim()
      .optional(),

    utmCampaign: z
      .string()
      .trim()
      .optional(),

    utmContent: z
      .string()
      .trim()
      .optional(),

    utmTerm: z
      .string()
      .trim()
      .optional()
  });

const closingSchema =
  z.object({
    conversationId: z
      .string()
      .uuid(),

    language: z
      .enum(
        supportedLanguages
      )
      .default('en')
  });

const conversationActionSchema =
  z.object({
    conversationId: z
      .string()
      .uuid()
  });

const closeQuestions = {
  en: 'Are you finished, or would you like to continue chatting?',

  de: 'Sind Sie fertig, oder möchten Sie das Gespräch fortsetzen?',

  it: 'Hai terminato o vuoi continuare la conversazione?',

  es: '¿Has terminado o quieres continuar la conversación?',

  fr: 'Avez-vous terminé ou souhaitez-vous continuer la conversation ?'
};

const resumedMessages = {
  en: 'Great, we can continue. How else can I help you?',

  de: 'Sehr gut, wir können fortfahren. Wie kann ich Ihnen noch helfen?',

  it: 'Perfetto, possiamo continuare. Come posso aiutarti ancora?',

  es: 'Perfecto, podemos continuar. ¿En qué más puedo ayudarte?',

  fr: 'Parfait, nous pouvons continuer. Comment puis-je encore vous aider ?'
};

const completedMessages = {
  en: 'Thank you for chatting with Marina. This conversation is now closed.',

  de: 'Vielen Dank für das Gespräch mit Marina. Dieses Gespräch ist jetzt beendet.',

  it: 'Grazie per aver parlato con Marina. Questa conversazione è ora chiusa.',

  es: 'Gracias por conversar con Marina. Esta conversación ya está cerrada.',

  fr: 'Merci d’avoir échangé avec Marina. Cette conversation est maintenant terminée.'
};

const abandonedMessages = {
  en: 'This conversation was closed because there was no response.',

  de: 'Dieses Gespräch wurde geschlossen, da keine Antwort eingegangen ist.',

  it: 'Questa conversazione è stata chiusa perché non è stata ricevuta alcuna risposta.',

  es: 'Esta conversación se cerró porque no se recibió ninguna respuesta.',

  fr: 'Cette conversation a été fermée car aucune réponse n’a été reçue.'
};

function getLanguageMessage(
  messages,
  language
) {
  return (
    messages[language] ||
    messages.en
  );
}

export async function startChatSession(
  req,
  res
) {
  const body =
    sessionSchema.parse(
      req.body
    );

  const sdr =
    await findSdrIdentity(
      body.token
    );

  const metadata =
  await getVisitorMetadata(
    req,
    body
  );

  const session =
    await startSession({
      cookieId:
        req.cookies
          ?.marina_visitor,

      metadata,

      sdr,

      language:
        body.language
    });

  res.cookie(
    'marina_visitor',
    session.visitorCookie,
    {
      httpOnly: true,

      sameSite: 'lax',

      secure:
        process.env.NODE_ENV ===
        'production',

      maxAge:
        config.COOKIE_MAX_AGE_DAYS *
        24 *
        60 *
        60 *
        1000
    }
  );

  const conversationId =
    session.conversation
      .conversation_id;

  const language =
    session.conversation
      .language ||
    body.language;

  const welcome =
    await welcomeMessage(
      conversationId
    );

  /*
   * Save the welcome message in the conversation history.
   *
   * Remove this block only when your identity/session service
   * already stores the welcome message.
   */
  await saveMessage({
    conversationId,
    senderRole: 'assistant',
    text: welcome,
    language,
    intent: 'welcome',
    promptMode: 'welcome'
  });

  return res.status(201).json({
    conversationId,

    identified:
      Boolean(sdr),

    language,

    welcome
  });
}

export async function askBeforeClosing(
  req,
  res
) {
  const body =
    closingSchema.parse(
      req.body
    );

  const conversation =
    await requestConversationClose({
      conversationId:
        body.conversationId
    });

  if (!conversation) {
    return res.status(404).json({
      error:
        'Open conversation not found'
    });
  }

  const language =
    conversation.language ||
    body.language ||
    'en';

  const question =
    getLanguageMessage(
      closeQuestions,
      language
    );

  /*
   * Store the closing question as a normal assistant message.
   */
  await saveMessage({
    conversationId:
      body.conversationId,

    senderRole:
      'assistant',

    text:
      question,

    language,

    intent:
      'close_confirmation',

    promptMode:
      'close_confirmation'
  });

  return res.json({
    question,
    language,
    waitingForConfirmation:
      true
  });
}

export async function resumeChatSession(
  req,
  res
) {
  const body =
    conversationActionSchema.parse(
      req.body
    );

  const conversation =
    await continueConversation({
      conversationId:
        body.conversationId
    });

  if (!conversation) {
    return res.status(404).json({
      error:
        'Conversation not found or cannot be resumed'
    });
  }

  const language =
    conversation.language ||
    'en';

  const message =
    getLanguageMessage(
      resumedMessages,
      language
    );

  /*
   * Save Marina's continuation confirmation.
   *
   * Your frontend should not also add the same assistant message,
   * otherwise the message will appear twice.
   */
  await saveMessage({
    conversationId:
      body.conversationId,

    senderRole:
      'assistant',

    text:
      message,

    language,

    intent:
      'continue',

    promptMode:
      'continue'
  });

  return res.json({
    success: true,
    conversation,
    message
  });
}

export async function endChatSession(
  req,
  res
) {
  const body =
    conversationActionSchema.parse(
      req.body
    );

  const conversation =
    await closeConversation({
      conversationId:
        body.conversationId,

      status:
        'completed'
    });

  if (!conversation) {
    return res.status(404).json({
      error:
        'Open conversation not found'
    });
  }

  const language =
    conversation.language ||
    'en';

  const message =
    getLanguageMessage(
      completedMessages,
      language
    );

  await saveMessage({
    conversationId:
      body.conversationId,

    senderRole:
      'assistant',

    text:
      message,

    language,

    intent:
      'conversation_completed',

    promptMode:
      'conversation_completed'
  });

  /*
   * Run the final structured analysis after all messages,
   * including the closing message, have been stored.
   */
  await analyzeConversation(
    body.conversationId
  );

  return res.json({
    success: true,
    conversation,
    message
  });
}

export async function abandonChatSession(
  req,
  res
) {
  const body =
    conversationActionSchema.parse(
      req.body
    );

  const conversation =
    await closeConversation({
      conversationId:
        body.conversationId,

      status:
        'abandoned'
    });

  if (!conversation) {
    return res.status(404).json({
      error:
        'Open conversation not found'
    });
  }

  const language =
    conversation.language ||
    'en';

  const message =
    getLanguageMessage(
      abandonedMessages,
      language
    );

  await saveMessage({
    conversationId:
      body.conversationId,

    senderRole:
      'assistant',

    text:
      message,

    language,

    intent:
      'conversation_abandoned',

    promptMode:
      'conversation_abandoned'
  });

  /*
   * First create the summary, interests, needs, objections,
   * and next action.
   */
  await analyzeConversation(
    body.conversationId
  );

  /*
   * Then force the outcome to abandoned.
   *
   * This is done after analysis so OpenAI cannot replace the
   * abandoned result with another outcome.
   */
  await updateConversationOutcome({
    conversationId:
      body.conversationId,

    outcome:
      'abandoned',

    stage:
      'closed'
  });

  return res.json({
    success: true,
    conversation,
    message
  });
}