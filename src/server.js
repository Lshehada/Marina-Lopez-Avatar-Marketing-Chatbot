import { app } from './app.js';
import { config } from './config/index.js';
import { startKnowledgeSyncJob } from './jobs/knowledgeSyncJob.js';
import { startConversationCleanupJob} from './jobs/conversationCleanupJob.js';

app.listen(config.PORT, () => {
  console.log(`Marina is running at ${config.APP_BASE_URL}`);
});

startKnowledgeSyncJob();
startConversationCleanupJob();
