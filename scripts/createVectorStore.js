import { openai } from '../src/config/openai.js';
const store=await openai.vectorStores.create({name:'Marina Google Drive Knowledge'});
console.log(store.id);
