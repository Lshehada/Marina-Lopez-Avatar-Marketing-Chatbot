import { Router } from 'express';

import {
  asyncHandler
} from '../middleware/validate.js';

import {
  startLiveAvatarSession
} from '../controllers/liveAvatarController.js';

import {
  liveAvatarChatCompletions
} from '../controllers/liveAvatarLlmController.js';

const router = Router();

router.post(
  '/session',
  asyncHandler(startLiveAvatarSession)
);

router.post(
  '/v1/chat/completions',
  asyncHandler(liveAvatarChatCompletions)
);

export default router;