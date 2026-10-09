import OpenAI from 'openai';
import { config } from './index.js';

export const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
