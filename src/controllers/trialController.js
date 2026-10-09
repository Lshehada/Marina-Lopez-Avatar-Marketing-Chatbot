import { z } from 'zod';

import {
  markTrialSubmitted
} from '../services/trialService.js';


const submissionSchema =
  z.object({
    trialRegistrationId:
      z.string().uuid()
  });


export async function submitTrialRegistration(
  req,
  res
) {
  const body =
    submissionSchema.parse(
      req.body
    );

  const trial =
    await markTrialSubmitted(
      body.trialRegistrationId
    );

  return res.json({
    success: true,

    trialRegistrationId:
      trial.trial_registration_id,

    trialStatus:
      trial.trial_status,

    trialStatusSubmissionAt:
      trial.trial_status_submission_at
  });
}