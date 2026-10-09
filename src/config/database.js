import pg from 'pg';

import {
  config
} from './index.js';


const {
  Pool
} = pg;


export const db =
  new Pool({

    connectionString:
      config.DATABASE_URL
  });


db.on(
  'error',
  (error) => {

    console.error(
      'Unexpected PostgreSQL error:',
      error
    );
  }
);


export async function tx(
  callback
) {

  const client =
    await db.connect();

  try {

    await client.query(
      'BEGIN'
    );

    const result =
      await callback(
        client
      );

    await client.query(
      'COMMIT'
    );

    return result;

  } catch (error) {

    await client.query(
      'ROLLBACK'
    );

    throw error;

  } finally {

    client.release();
  }
}