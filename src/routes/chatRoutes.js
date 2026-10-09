import { Router } from 'express';
import {
  sendMessage,
  saveEmail
} from '../controllers/chatController.js';
import { asyncHandler } from '../middleware/validate.js';

const router = Router();

router.post('/message', asyncHandler(sendMessage));
router.post('/email', asyncHandler(saveEmail));

export default router;