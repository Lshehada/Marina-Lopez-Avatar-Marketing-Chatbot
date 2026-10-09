import cron from 'node-cron';
import { config } from '../config/index.js';
import { syncKnowledge } from '../services/knowledgeSyncService.js';

export function startKnowledgeSyncJob() {
  // Synchronize once at startup, then follow the cron expression from .env.
  syncKnowledge('startup').catch(error => console.error('Startup knowledge sync failed:', error));

  cron.schedule(config.KNOWLEDGE_SYNC_CRON, () => {
    syncKnowledge('scheduled').catch(error => console.error('Scheduled knowledge sync failed:', error));
  });
}
