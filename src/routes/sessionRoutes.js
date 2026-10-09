import { Router } from 'express';

import {
  startChatSession,
  askBeforeClosing,
  resumeChatSession,
  endChatSession,
  abandonChatSession
} from '../controllers/sessionController.js';

import {
  asyncHandler
} from '../middleware/validate.js';

const router = Router();

router.post(
  '/',
  asyncHandler(startChatSession)
);

router.post(
  '/closing-check',
  asyncHandler(askBeforeClosing)
);

router.post(
  '/continue',
  asyncHandler(resumeChatSession)
);

router.post(
  '/end',
  asyncHandler(endChatSession)
);

router.post(
  '/abandon',
  asyncHandler(abandonChatSession)
);

export default router;