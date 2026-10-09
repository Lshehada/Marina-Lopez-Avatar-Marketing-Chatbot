import {
  google
} from 'googleapis';

import {
  googleCredentials
} from './index.js';


const auth =
  new google.auth.GoogleAuth({
    credentials:
      googleCredentials,

    /*
     * Full Drive scope is required because
     * the knowledge-version system moves
     * retired PDFs into Old Versions.
     */
    scopes: [
      'https://www.googleapis.com/auth/drive'
    ]
  });


export const drive =
  google.drive({
    version:
      'v3',

    auth
  });