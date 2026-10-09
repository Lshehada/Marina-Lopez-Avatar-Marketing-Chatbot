import crypto from 'node:crypto';
import { z } from 'zod';

import {
  config
} from '../config/index.js';

import {
  findOpenConversationForVisitor
} from '../repositories/conversationRepository.js';

import {
  createAvatarSession
} from '../repositories/avatarSessionRepository.js';

const startAvatarSchema = z.object({
  conversationId: z.string().uuid()
});

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function getApiData(payload) {
  return payload?.data || payload;
}

async function readJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      message:
        text || 'No response body received.'
    };
  }
}

export async function startLiveAvatarSession(
  req,
  res
) {
  const body =
    startAvatarSchema.parse(req.body);

  const visitorCookieId =
    req.cookies?.marina_visitor;

  if (!visitorCookieId) {
    return res.status(401).json({
      error: 'Visitor session was not found.'
    });
  }

  const conversation =
    await findOpenConversationForVisitor({
      conversationId: body.conversationId,
      visitorCookieId
    });

  if (!conversation) {
    return res.status(404).json({
      error: 'Open conversation was not found.'
    });
  }

  /*
   * Create one unique backend key for this avatar session.
   * Only its SHA-256 hash is stored in PostgreSQL.
   */
  const customLlmApiKey =
    crypto.randomBytes(32).toString(
      'base64url'
    );

  const customLlmApiKeyHash =
    sha256(customLlmApiKey);

  /*
   * 1. Store the one-time key in LiveAvatar.
   */
  const secretResponse = await fetch(
    'https://api.liveavatar.com/v1/secrets',
    {
      method: 'POST',

      headers: {
        'X-API-KEY':
          config.LIVEAVATAR_API_KEY,

        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({
        secret_type: 'OPENAI_API_KEY',

        secret_value:
          customLlmApiKey,

        secret_name:
          `marina-${body.conversationId}`
      })
    }
  );

  const secretPayload =
    await readJson(secretResponse);

  if (!secretResponse.ok) {
    console.error(
      'LiveAvatar secret creation failed:',
      secretResponse.status,
      secretPayload
    );

    return res.status(
      secretResponse.status
    ).json({
      error:
        'Could not create the LiveAvatar LLM secret.',

      details: secretPayload
    });
  }

  const secretData =
    getApiData(secretPayload);

  const secretId =
    secretData.id ||
    secretData.secret_id;

  if (!secretId) {
    throw new Error(
      `LiveAvatar did not return a secret ID: ${
        JSON.stringify(secretPayload)
      }`
    );
  }

  /*
   * 2. Configure Marina as the Custom LLM.
   */
  const llmConfigResponse = await fetch(
    'https://api.liveavatar.com/v1/llm-configurations',
    {
      method: 'POST',

      headers: {
        'X-API-KEY':
          config.LIVEAVATAR_API_KEY,

        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({
        display_name:
          `Marina ${body.conversationId}`,

        model_name:
          'marina-backend',

        secret_id:
          secretId,

        base_url:
          config
            .LIVEAVATAR_CUSTOM_LLM_BASE_URL
      })
    }
  );

  const llmConfigPayload =
    await readJson(llmConfigResponse);

  if (!llmConfigResponse.ok) {
    console.error(
      'LiveAvatar LLM configuration failed:',
      llmConfigResponse.status,
      llmConfigPayload
    );

    return res.status(
      llmConfigResponse.status
    ).json({
      error:
        'Could not create the LiveAvatar LLM configuration.',

      details: llmConfigPayload
    });
  }

  const llmConfigData =
    getApiData(llmConfigPayload);

  const llmConfigurationId =
    llmConfigData.id ||
    llmConfigData.llm_configuration_id;

  if (!llmConfigurationId) {
    throw new Error(
      `LiveAvatar did not return an LLM configuration ID: ${
        JSON.stringify(llmConfigPayload)
      }`
    );
  }

  /*
   * 3. Create a FULL Mode session token.
   * The frontend Web SDK will start this session.
   */
  const tokenResponse = await fetch(
    'https://api.liveavatar.com/v1/sessions/token',
    {
      method: 'POST',

      headers: {
        'X-API-KEY':
          config.LIVEAVATAR_API_KEY,

        'Content-Type':
          'application/json'
      },

      body: JSON.stringify({
        mode: 'FULL',

        avatar_id:
          config.LIVEAVATAR_AVATAR_ID,

        llm_configuration_id:
          llmConfigurationId,

        avatar_persona: {
          voice_id:
            config.LIVEAVATAR_VOICE_ID,

          context_id:
            config.LIVEAVATAR_CONTEXT_ID,

          language:
            conversation.primary_language
        },

        video_settings: {
          quality: 'high',
          encoding: 'H264'
        }
      })
    }
  );

  const tokenPayload =
    await readJson(tokenResponse);

  if (!tokenResponse.ok) {
    console.error(
      'LiveAvatar session-token creation failed:',
      tokenResponse.status,
      tokenPayload
    );

    return res.status(
      tokenResponse.status
    ).json({
      error:
        'Could not create the LiveAvatar session token.',

      details: tokenPayload
    });
  }

  const sessionData =
    getApiData(tokenPayload);

  if (
    !sessionData.session_id ||
    !sessionData.session_token
  ) {
    throw new Error(
      `LiveAvatar did not return session credentials: ${
        JSON.stringify(tokenPayload)
      }`
    );
  }

  /*
   * 4. Connect this avatar session to Marina's
   * existing conversation in PostgreSQL.
   */
  await createAvatarSession({
    avatarSessionId:
      sessionData.session_id,

    conversationId:
      body.conversationId,

    customLlmApiKeyHash,

    liveAvatarLlmConfigurationId:
      llmConfigurationId
  });

  /*
   * Return the short-lived token only.
   * The frontend LiveAvatar Web SDK calls start()
   * and connects the avatar video.
   */
  return res.status(201).json({
    liveAvatarSessionId:
      sessionData.session_id,

    sessionToken:
      sessionData.session_token
  });
}