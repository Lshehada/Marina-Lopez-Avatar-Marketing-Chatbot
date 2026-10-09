import { openai } from '../config/openai.js';
import { config } from '../config/index.js';

import {
  getVisitorHistory
} from '../repositories/messageRepository.js';

import {
  updateConversationAnalysis
} from '../repositories/conversationRepository.js';

import {
  updateLeadFromConversationAnalysis
} from '../repositories/leadRepository.js';

function buildTranscript(messages) {
  return messages
    .map((message) => {
      const speaker =
        message.sender_role === 'visitor'
          ? 'Visitor'
          : message.sender_role === 'assistant'
            ? 'Marina'
            : message.sender_role;

      return `${speaker}: ${message.message_text}`;
    })
    .join('\n');
}

function safeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 20);
}

function safeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text = String(value).trim();

  return text || null;
}

export async function analyzeConversation(
  conversationId
) {
  const messages =
    await getVisitorHistory(
      conversationId
    );

  if (!messages.length) {
    return null;
  }

  const transcript =
    buildTranscript(messages);

  try {
    const response =
      await openai.responses.create({
        model: config.OPENAI_MODEL,

        instructions: `
You analyze a sales and support chatbot conversation.

Return valid JSON only.

Use exactly this structure:

{
  "summary": "Brief factual summary",
  "interests": ["interest"],
  "needs": ["need"],
  "objections": ["objection"],
  "nextBestAction": "Recommended next action or null",
  "outcome": "outcome code"
}

Rules:

- Do not invent information.
- Use only information explicitly present in the transcript.
- Keep arrays empty when nothing was discovered.
- Keep the summary to a maximum of 25 words and one short sentence only.
- Include only the visitor’s goal, main need, or next relevant step.
- Do not include greetings, email discussions, internal system actions, or repeated free-trial offers.
- nextBestAction must be practical and short.
- Return null for nextBestAction when no action is needed.

Allowed outcome codes:

- information_provided
- product_interest
- pricing_interest
- trial_interest
- trial_requested
- registration_started
- registration_completed
- email_captured
- demo_requested
- human_follow_up_requested
- support_resolved
- objection_unresolved
- not_interested
- abandoned
- no_clear_outcome
        `.trim(),

        input: transcript,

        text: {
          format: {
            type: 'json_schema',
            name: 'conversation_analysis',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                summary: {
                  type: 'string'
                },

                interests: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                },

                needs: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                },

                objections: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                },

                nextBestAction: {
                  type: [
                    'string',
                    'null'
                  ]
                },

                outcome: {
                  type: 'string',
                  enum: [
                    'information_provided',
                    'product_interest',
                    'pricing_interest',
                    'trial_interest',
                    'trial_requested',
                    'registration_started',
                    'registration_completed',
                    'email_captured',
                    'demo_requested',
                    'human_follow_up_requested',
                    'support_resolved',
                    'objection_unresolved',
                    'not_interested',
                    'abandoned',
                    'no_clear_outcome'
                  ]
                }
              },

              required: [
                'summary',
                'interests',
                'needs',
                'objections',
                'nextBestAction',
                'outcome'
              ],

              additionalProperties: false
            }
          }
        },

        store: false
      });

    const analysis =
      JSON.parse(response.output_text);

    const normalizedAnalysis = {
      conversationId,

      summary:
        safeText(analysis.summary),

      interests:
        safeArray(analysis.interests),

      needs:
        safeArray(analysis.needs),

      objections:
        safeArray(analysis.objections),

      nextBestAction:
        safeText(
          analysis.nextBestAction
        ),

      outcome:
        safeText(analysis.outcome) ||
        'no_clear_outcome'
    };

    const conversation =
      await updateConversationAnalysis(
        normalizedAnalysis
      );

    await updateLeadFromConversationAnalysis({
      conversationId,

      summary:
        safeText(analysis.summary),

      interests:
        safeArray(analysis.interests),

      needs:
        safeArray(analysis.needs),

      objections:
        safeArray(analysis.objections),

      nextBestAction:
        safeText(
          analysis.nextBestAction
        )
    });

    return conversation;

  } catch (error) {
    /*
     * Analysis failure must not break the visitor's chat.
     */
    console.error(
      'Conversation analysis failed:',
      error
    );

    return null;
  }
}