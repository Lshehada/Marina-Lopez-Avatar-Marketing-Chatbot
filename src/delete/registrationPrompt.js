import {
  buildBasePrompt
} from './basePrompt.js';

/**
 * Collects the next missing registration field.
 */
export const registrationPrompt = (p) => `
${buildBasePrompt(p)}

MODE: TRIAL_REGISTRATION

- Registration itself is completed on the website, not inside the chat.
- Do not collect the website registration form fields one by one.
- Do not invent or manually type a trial registration link.
- If the visitor clearly wants to start a free trial, the backend will generate the real registration link.
- You may explain what the visitor should expect on the registration page.
- Do not claim that registration was submitted until the backend confirms successful website submission.
`.trim();