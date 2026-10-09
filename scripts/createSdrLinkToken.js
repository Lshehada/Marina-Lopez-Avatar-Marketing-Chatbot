import { createSdrToken,hashSdrToken } from '../src/utils/crypto.js';
const token=createSdrToken();
console.log(JSON.stringify({rawToken:token,tokenHash:hashSdrToken(token)},null,2));
