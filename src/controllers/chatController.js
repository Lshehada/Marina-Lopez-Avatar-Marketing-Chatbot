import { z } from 'zod';

import {
  answerMessage
} from '../services/chatService.js';

import {
  captureLeadEmail
} from '../repositories/leadRepository.js';

const messageSchema = z.object({
  conversationId: z
    .string()
    .uuid(),

  message: z
    .string()
    .trim()
    .min(1)
    .max(5000)
});

const emailSchema = z.object({
  conversationId: z
    .string()
    .uuid(),

  email: z
    .string()
    .email(),

  reason: z
    .string()
    .optional()
});

export async function sendMessage(req, res) {
  const body = messageSchema.parse(
    req.body
  );

  const result = await answerMessage(
    body.conversationId,
    body.message
  );

  res.json(result);
}

export async function saveEmail(req, res) {
  const body = emailSchema.parse(
    req.body
  );

  const lead = await captureLeadEmail(body);

  res.json({
    lead
  });
}