import { buildBasePrompt } from './basePrompt.js';

export function technicalPrivacyPrompt(personalization) {
  return `
${buildBasePrompt(personalization)}

CURRENT TOPIC: TECHNICAL DETAILS AND PRIVACY

Answer questions about:
- privacy, GDPR, data handling, and security
- technical setup, integrations, APIs, hosting, and access
- uploaded files and account-related technical questions

Use only the retrieved technical/privacy knowledge.
Never make legal, compliance, security, or technical guarantees
that are not supported by the knowledge base.
`.trim();
}