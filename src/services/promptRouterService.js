import {
  clientInfoPrompt,
  gameInfoPrompt,
  technicalPrivacyPrompt,
  enerwhizzOverviewPrompt
} from '../prompts/index.js';

const modeConfig = {
  client_info: {
    prompt: clientInfoPrompt,
    category: 'client'
  },
  game_info: {
    prompt: gameInfoPrompt,
    category: 'game'
  },
  technical_privacy: {
    prompt: technicalPrivacyPrompt,
    category: 'technical_privacy'
  },
  overview: {
    prompt: enerwhizzOverviewPrompt,
    category: 'overview'
  }
};

function buildRoutingContext({
  personalization = {},
  recentMessages = [],
  conversationSummary = ''
}) {
  return [
    personalization.main_interest,
    personalization.company_need,
    personalization.company_focus,
    personalization.area_of_interest,
    conversationSummary,
    ...recentMessages.map((message) => message.message_text)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function selectPrompt({
  message,
  personalization,
  recentMessages,
  conversationSummary
}) {
  const currentMessage = message.toLowerCase();

  const context = buildRoutingContext({
    personalization,
    recentMessages,
    conversationSummary
  });

  const technicalPattern =
    /privacy|gdpr|data|security|technical|api|integration|hosting|account|login|upload|file|datenschutz|sicherheit|daten|tecnico|privacy|sicurezza|datos|seguridad/i;

  const gamePattern =
    /game|quiz|player|play|league|score|ranking|reward|etcoin|gioco|giocatore|spiel|spieler|juego|jugador/i;

  const clientPattern =
    /client|company|business|marketing|campaign|pricing|price|plan|subscription|trial|pdf|lead|customer|azienda|cliente|unternehmen|kunde|empresa|precio/i;

  let mode = 'overview';

  // First use the current message.
  if (technicalPattern.test(currentMessage)) {
    mode = 'technical_privacy';
  } else if (gamePattern.test(currentMessage)) {
    mode = 'game_info';
  } else if (clientPattern.test(currentMessage)) {
    mode = 'client_info';
  }

  // Then resolve short or unclear follow-up questions using context.
  else if (technicalPattern.test(context)) {
    mode = 'technical_privacy';
  } else if (gamePattern.test(context)) {
    mode = 'game_info';
  } else if (clientPattern.test(context)) {
    mode = 'client_info';
  }

  const selected = modeConfig[mode];

  return {
    mode,
    instructions: selected.prompt(personalization),
    knowledgeCategory: selected.category
  };
}