import { isAvatarStopCommand } from '../../public/Js/avatar-controls.js';
import crypto from 'node:crypto';

import {
  answerMessage
} from '../services/chatService.js';

import {
  findActiveAvatarSessionByKeyHash
} from '../repositories/avatarSessionRepository.js';

function getBearerToken(req) {
  const value = req.headers.authorization || '';

  if (!value.startsWith('Bearer ')) {
    return null;
  }

  return value.slice('Bearer '.length);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function getLatestUserMessage(messages = []) {
  const userMessages = messages.filter(
    (message) => message.role === 'user'
  );

  return userMessages.at(-1)?.content?.trim() || null;
}

export async function liveAvatarChatCompletions(
  req,
  res
) {
  const receivedKey = getBearerToken(req);

  if (!receivedKey) {
    return res.status(401).json({
      error: {
        message: 'Unauthorized',
        type: 'authentication_error'
      }
    });
  }

  const avatarSession =
    await findActiveAvatarSessionByKeyHash(
      sha256(receivedKey)
    );

  if (!avatarSession) {
    return res.status(401).json({
      error: {
        message: 'Unauthorized',
        type: 'authentication_error'
      }
    });
  }

  const visitorMessage =
    getLatestUserMessage(req.body.messages);

  if (!visitorMessage) {
    return res.status(400).json({
      error: {
        message: 'A user message is required.',
        type: 'invalid_request_error'
      }
    });
  }

  // A stop command must not generate another spoken answer.
  const result = isAvatarStopCommand(visitorMessage)
    ? { answer: '' }
    : await answerMessage(avatarSession.conversation_id, visitorMessage);

  const id = `chatcmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const model = req.body.model || 'marina-liveavatar';
  const answer = String(result.answer || '');

  if (req.body.stream === true) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendChunk = (delta, finishReason = null) => {
      res.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta,
            finish_reason: finishReason
          }
        ]
      })}\n\n`);
    };

    // Wrap the bot's completed answer in the stream format HeyGen requests.
    sendChunk({ role: 'assistant', content: '' });
    sendChunk({ content: answer });
    sendChunk({}, 'stop');
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  return res.json({
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: answer
        },
        finish_reason: 'stop'
      }
    ]
  });
}
