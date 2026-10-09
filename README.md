# Marina Lopez — EnerWhizz B2B Marketing Chatbot

Marina Lopez is a multilingual B2B marketing chatbot for the EnerWhizz platform. It helps SDR contacts and new website visitors learn about EnerWhizz, discuss their needs or project ideas, and access a relevant free-trial registration link.

The project also contains an initial HeyGen LiveAvatar proof of concept, intended to let visitors speak with a visual avatar that uses the same Marina backend, database, prompts, knowledge base, and conversation history as the text chatbot.

## Main features

- Multilingual conversations in English, French, German, Italian, and Spanish.
- Personalised visitor handling for known SDR contacts and new visitors.
- PostgreSQL storage for visitors, leads, conversations, messages, and trial-registration data.
- OpenAI-powered responses with prompt routing and File Search knowledge retrieval.
- Google Drive knowledge-base synchronisation and an admin file-management interface.
- Conversation history, internal summaries, lead engagement, email capture, inactivity, and conversation-closing flows.
- Personalised free-trial registration links.
- HeyGen LiveAvatar integration proof of concept.

## Technology stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js and Express
- **Database:** PostgreSQL
- **AI:** OpenAI Responses API and File Search
- **Knowledge source:** Google Drive via a Google Cloud service account
- **Avatar proof of concept:** HeyGen LiveAvatar
- **Local public HTTPS testing:** ngrok

## Project structure

```text
public/             Frontend pages, styles, and browser JavaScript
scripts/            Utility scripts, including knowledge synchronisation tools
sql/schema.sql      PostgreSQL database schema
src/
  config/           Configuration, database, Google, and OpenAI setup
  controllers/      Request handlers
  jobs/             Background jobs
  middleware/       Validation, admin authentication, and error handling
  prompts/          Marina prompt definitions
  repositories/     PostgreSQL data-access functions
  routes/           Express API routes
  services/         Chat, identity, knowledge, prompt routing, and trial logic
  utils/            Shared helper functions
```

## Local setup

### 1. Clone the repository

```bash
git clone https://github.com/Lshehada/Marina-Lopez-Avatar-Marketing-Chatbot.git
cd Marina-Lopez-Avatar-Marketing-Chatbot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create local configuration

Create a local `.env` file. Do **not** commit this file to GitHub.

At minimum, configure your own values for:

```env
NODE_ENV=development
PORT=3000
APP_BASE_URL=http://localhost:3000
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/YOUR_DATABASE
COOKIE_SECRET=YOUR_LONG_RANDOM_SECRET
SDR_LINK_PEPPER=YOUR_LONG_RANDOM_SECRET
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
OPENAI_MODEL=gpt-4.1-mini
OPENAI_VECTOR_STORE_ID=YOUR_VECTOR_STORE_ID
GOOGLE_DRIVE_FOLDER_ID=YOUR_GOOGLE_DRIVE_FOLDER_ID
GOOGLE_DRIVE_OLD_VERSIONS_FOLDER_ID=YOUR_OLD_VERSIONS_FOLDER_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL=YOUR_SERVICE_ACCOUNT_EMAIL
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=YOUR_SERVICE_ACCOUNT_PRIVATE_KEY
```

If testing the avatar proof of concept, also configure your own LiveAvatar values:

```env
LIVEAVATAR_API_KEY=YOUR_LIVEAVATAR_API_KEY
LIVEAVATAR_AVATAR_ID=YOUR_AVATAR_ID
LIVEAVATAR_VOICE_ID=YOUR_VOICE_ID
LIVEAVATAR_CONTEXT_ID=YOUR_CONTEXT_ID
LIVEAVATAR_CUSTOM_LLM_BASE_URL=YOUR_PUBLIC_URL/api/liveavatar/v1
```

### 4. Create the database

Create a PostgreSQL database, then run the schema:

```bash
createdb enerwhizz_marina
psql -d enerwhizz_marina -f sql/schema.sql
```

### 5. Start the application

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Testing LiveAvatar locally

HeyGen needs a public HTTPS address to call the custom LLM endpoint during development. With the server running on port 3000, start ngrok in a second terminal:

```bash
ngrok http 3000
```

Copy the generated HTTPS URL into `APP_BASE_URL`, `FRONTEND_ORIGIN`, and `LIVEAVATAR_CUSTOM_LLM_BASE_URL`, then restart the Node.js server.

## Security

Never commit sensitive files or values. In particular, keep the following local:

- `.env` files
- Google service-account JSON or private-key files
- OpenAI and LiveAvatar API keys
- Database URLs and passwords

The repository `.gitignore` should include:

```gitignore
node_modules/
.env
.env.*
marina-service-account.json
*.pem
*.key
.DS_Store
```

## Current status

The project provides the core Marina Lopez chatbot architecture and a HeyGen LiveAvatar proof of concept. Further work is needed for production deployment, real-user testing, multilingual voice-quality validation, avatar cost and latency evaluation, and free-trial conversion measurement.

