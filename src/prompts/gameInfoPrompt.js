import { buildBasePrompt } from './basePrompt.js';

export function gameInfoPrompt(personalization) {
  return `
${buildBasePrompt(personalization)}

CURRENT TOPIC: GAME INFORMATION

Answer player-facing questions about:
- the EnerWhizz game
- quizzes and participation
- scoring, rankings, leagues, rewards, and ETCoins
- how a player can take part

Use only the retrieved game knowledge.
Do not give business-sales details unless needed for the answer.
`.trim();
}