import {
  Router
} from 'express';

import {
  submitTrialRegistration
} from '../controllers/trialController.js';

import {
  asyncHandler
} from '../middleware/validate.js';


const router =
  Router();


router.post(
  '/submitted',
  asyncHandler(
    submitTrialRegistration
  )
);


export default router;