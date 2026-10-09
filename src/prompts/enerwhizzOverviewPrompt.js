import { buildBasePrompt } from './basePrompt.js';

export function enerwhizzOverviewPrompt(personalization) {
  return `
${buildBasePrompt(personalization)}

CURRENT TOPIC: ENERWHIZZ OVERVIEW

Give a clear high-level explanation of:
- what EnerWhizz is
- who it is for
- its main value and purpose
- general product or company information

Use retrieved knowledge for factual claims.
If the visitor asks a more specific game, client, or technical question,
answer it briefly and naturally guide them to that topic.
`.trim();
}