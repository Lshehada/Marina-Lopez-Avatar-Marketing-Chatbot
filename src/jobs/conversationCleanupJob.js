import cron from 'node-cron';
import { db } from '../config/database.js';

async function closeInactiveConversations() {
  const result = await db.query(
    `
    UPDATE conversations
    SET
      conversation_status = 'abandoned',
      ended_at = last_activity_at
    WHERE conversation_status = 'open'
      AND last_activity_at <
          NOW() - INTERVAL '30 minutes'
    RETURNING conversation_id
    `
  );

  if (result.rowCount > 0) {
    console.log(
      `Closed ${result.rowCount} inactive conversations.`
    );
  }
}

export function startConversationCleanupJob() {
  closeInactiveConversations().catch((error) => {
    console.error(
      'Initial conversation cleanup failed:',
      error
    );
  });

  cron.schedule('*/5 * * * *', () => {
    closeInactiveConversations().catch((error) => {
      console.error(
        'Conversation cleanup failed:',
        error
      );
    });
  });
}