BEGIN;

-- gen_random_uuid() is provided by pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- ENUM TYPES
-- Purpose: Constrain important workflow and status fields to valid values.
-- ============================================================================

CREATE TYPE language_code AS ENUM ('en', 'it', 'es', 'de', 'fr');
CREATE TYPE token_status AS ENUM ('active', 'disabled', 'expired');
CREATE TYPE lead_source_type AS ENUM ('sdr', 'website');
CREATE TYPE lead_status_type AS ENUM (
  'known_lead', 'engaged_lead', 'qualified_lead', 'trial_requested',
  'trial_started', 'customer', 'inactive', 'lost'
);
CREATE TYPE trial_status_type AS ENUM (
  'not_offered', 'offered', 'requested', 'in_progress', 'submitted',
  'started', 'expired', 'converted', 'declined', 'cancelled'
);
CREATE TYPE campaign_source_type AS ENUM ('upload', 'url');
CREATE TYPE campaign_status_type AS ENUM (
  'submitted', 'processing', 'ready', 'failed', 'cancelled'
);
CREATE TYPE preferred_offer_type AS ENUM ( 'Standard' , 'Special' );
CREATE TYPE conversation_status_type AS ENUM ('open', 'completed', 'abandoned', 'transferred');
CREATE TYPE sender_role_type AS ENUM ('visitor', 'assistant', 'system', 'human_agent');
CREATE TYPE message_classification_type AS ENUM (
  'welcome',
  'general',
  'product',
  'pricing',
  'trial',
  'registration',
  'objection',
  'support',
  'game',
  'history'
);
CREATE TYPE campaign_status_type AS ENUM (
  'submitted',
  'processing',
  'completed',
  'failed'
);
-- ============================================================================
-- UPDATED-AT TRIGGER FUNCTION
-- Purpose: Automatically refresh updated_at whenever a row is modified.
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SDR COMPANIES
-- Purpose: Stores target, prospect, customer, and competitor companies known to
-- the SDR and marketing systems.
-- ============================================================================

CREATE TABLE sdr_companies (
    sdr_company_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    company_name TEXT NOT NULL,
    company_website TEXT,
    company_focus TEXT,
    company_location TEXT,

    competitor_company_id UUID NULL
        REFERENCES sdr_companies(sdr_company_id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT company_not_own_competitor
        CHECK (
            competitor_company_id IS NULL
            OR competitor_company_id <> sdr_company_id
        )
);


-- ============================================================================
-- SDR CONTACTS
-- Purpose: Stores known contacts associated with SDR companies and secure-link
-- identification. Store only the token hash, never the raw token.
-- ============================================================================

CREATE TRIGGER trg_sdr_companies_updated_at
BEFORE UPDATE ON sdr_companies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sdr_contacts (
  sdr_contact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sdr_company_id UUID NOT NULL
    REFERENCES sdr_companies(sdr_company_id) ON DELETE CASCADE,
  contact_person_name TEXT NOT NULL,
  contact_person_email TEXT NOT NULL,
  contact_person_phone TEXT,
  preferred_language language_code NOT NULL DEFAULT 'en',
  area_of_interest TEXT,
  unique_link_token_hash TEXT NOT NULL UNIQUE,
  token_status token_status NOT NULL DEFAULT 'active',
  marketing_email_sent_at TIMESTAMPTZ,
  unique_link_first_opened_at TIMESTAMPTZ,
  unique_link_last_opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sdr_contacts_email_unique
  ON sdr_contacts (lower(contact_person_email));
CREATE INDEX sdr_contacts_company_idx
  ON sdr_contacts (sdr_company_id);

CREATE TRIGGER trg_sdr_contacts_updated_at
BEFORE UPDATE ON sdr_contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- VISITORS
-- Purpose: Stores browser/device-level identities before or after a visitor is
-- converted into a lead. A visitor may have many conversations.
-- ============================================================================

CREATE TABLE visitors (
  visitor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cookie_id UUID NOT NULL UNIQUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_source TEXT,
  latest_source TEXT,
  referrer TEXT,
  landing_page TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  country TEXT,
  language language_code,
  browser TEXT,
  device_type TEXT,
  is_returning_visitor BOOLEAN NOT NULL DEFAULT false,
  is_sdr_identified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT visitors_seen_time_check CHECK (last_seen_at >= first_seen_at)
);

CREATE INDEX visitors_last_seen_idx ON visitors (last_seen_at DESC);
CREATE INDEX visitors_utm_campaign_idx ON visitors (utm_campaign) WHERE utm_campaign IS NOT NULL;

CREATE TRIGGER trg_visitors_updated_at
BEFORE UPDATE ON visitors
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- LEADS
-- Purpose: Stores the current sales profile and current state of an identified
-- visitor or SDR contact. Historical changes belong in lead_events.
-- ============================================================================

CREATE TABLE leads (
  lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id UUID UNIQUE
    REFERENCES visitors(visitor_id) ON DELETE SET NULL,
  sdr_contact_id UUID UNIQUE
    REFERENCES sdr_contacts(sdr_contact_id) ON DELETE SET NULL,
  sdr_company_id UUID
    REFERENCES sdr_companies(sdr_company_id) ON DELETE SET NULL,
  source_type lead_source_type NOT NULL,
  contact_name TEXT,
  email TEXT,
  email_domain TEXT,
  is_business_email BOOLEAN,
  email_captured_at TIMESTAMPTZ,
  email_capture_reason TEXT,
  company_name TEXT,
  country TEXT,
  language language_code,
  main_interest TEXT,
  company_need TEXT,
  pain_points TEXT,
  main_objection TEXT,
  preferred_offer preferred_offer_type,
  lead_status lead_status_type NOT NULL DEFAULT 'known_lead',
  conversation_summary TEXT,
  last_interaction_at TIMESTAMPTZ,
  next_best_action TEXT,
  free_trial_status trial_status_type NOT NULL DEFAULT 'not_offered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_identity_check CHECK (
    visitor_id IS NOT NULL OR sdr_contact_id IS NOT NULL OR email IS NOT NULL
  )
);

CREATE UNIQUE INDEX leads_email_unique
  ON leads (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX leads_status_idx
  ON leads (lead_status, last_interaction_at DESC);
CREATE INDEX leads_company_idx
  ON leads (sdr_company_id);

CREATE TRIGGER trg_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- CONVERSATIONS
-- Purpose: Stores one chat session. Attribution is copied onto every session so
-- campaign performance remains historically accurate even if visitor data later
-- changes. One visitor can have many conversations.
-- ============================================================================

CREATE TABLE conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  visitor_id UUID NOT NULL
    REFERENCES visitors(visitor_id) ON DELETE CASCADE,

  lead_id UUID
    REFERENCES leads(lead_id) ON DELETE SET NULL,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  ended_at TIMESTAMPTZ,

  primary_language language_code NOT NULL,

  languages_used language_code[] NOT NULL DEFAULT ARRAY[]::language_code[],

  source TEXT,
  referrer TEXT,
  landing_page TEXT,

  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,

  detected_intent TEXT,

  conversation_stage TEXT NOT NULL DEFAULT 'welcome',

  conversation_summary TEXT,

  interests_discovered JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_discovered JSONB NOT NULL DEFAULT '[]'::jsonb,
  objections_discovered JSONB NOT NULL DEFAULT '[]'::jsonb,

  next_best_action TEXT,
  conversation_outcome TEXT,

  conversation_status conversation_status_type
    NOT NULL DEFAULT 'open',

  summary_updated_at TIMESTAMPTZ,

  CONSTRAINT conversations_time_check
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX conversations_visitor_idx ON conversations (visitor_id, started_at DESC);
CREATE INDEX conversations_lead_idx ON conversations (lead_id, started_at DESC);
CREATE INDEX conversations_status_idx ON conversations (conversation_status, started_at DESC);
CREATE INDEX conversations_campaign_idx ON conversations (utm_campaign, started_at DESC)
  WHERE utm_campaign IS NOT NULL;
CREATE INDEX conversations_last_activity_idx ON conversations (last_activity_at DESC);


-- ============================================================================
-- AVATAR SESSIONS
-- Purpose: Links one LiveAvatar session to one existing Marina conversation.
-- The custom LLM API key is stored only as a SHA-256 hash.
-- ============================================================================

CREATE TABLE avatar_sessions (
  avatar_session_id TEXT PRIMARY KEY,

  conversation_id UUID NOT NULL
    REFERENCES conversations(conversation_id) ON DELETE CASCADE,

  provider TEXT NOT NULL DEFAULT 'liveavatar',

  custom_llm_api_key_hash TEXT NOT NULL UNIQUE,

  liveavatar_llm_configuration_id TEXT NOT NULL,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  ended_at TIMESTAMPTZ,

  end_reason TEXT
);

CREATE INDEX avatar_sessions_conversation_idx
  ON avatar_sessions (conversation_id, started_at DESC);

CREATE INDEX avatar_sessions_active_key_idx
  ON avatar_sessions (custom_llm_api_key_hash)
  WHERE ended_at IS NULL;


-- ============================================================================
-- MESSAGES
-- Purpose: Stores every visitor, Marina, system, and human-agent message, plus
-- AI request metadata. Knowledge citations are normalized separately.
-- ============================================================================

CREATE TABLE messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL
    REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  sender_role sender_role_type NOT NULL,
  message_text TEXT NOT NULL,
  language language_code NOT NULL,
  message_classification message_classification_type,
  intent TEXT,
  model_used TEXT,
  token_count INTEGER CHECK (token_count IS NULL OR token_count >= 0),
  response_time_ms INTEGER CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  prompt_mode TEXT,
  openai_response_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
CREATE INDEX messages_prompt_mode_idx ON messages (prompt_mode) WHERE prompt_mode IS NOT NULL;
CREATE INDEX messages_openai_response_idx ON messages (openai_response_id)
  WHERE openai_response_id IS NOT NULL;

-- ============================================================================
-- TRIAL REGISTRATIONS
-- Purpose: Stores structured free-trial registration progress and results.
-- This replaces the old trial_registration_data JSON-only design.
-- ============================================================================

CREATE TABLE trial_registrations (
  trial_registration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_id UUID NOT NULL
    REFERENCES leads(lead_id)
    ON DELETE CASCADE,

  conversation_id UUID
    REFERENCES conversations(conversation_id)
    ON DELETE SET NULL,

  sdr_contact_id UUID
    REFERENCES sdr_contacts(sdr_contact_id)
    ON DELETE SET NULL,

  trial_first_requested_at TIMESTAMPTZ
    NOT NULL DEFAULT now(),

  trial_last_requested_at TIMESTAMPTZ
    NOT NULL DEFAULT now(),

  trial_status trial_status_type
    NOT NULL DEFAULT 'requested',

  trial_status_submission_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,

  expires_at TIMESTAMPTZ,

  converted_at TIMESTAMPTZ,

  cancelled_at TIMESTAMPTZ,

  trial_link TEXT NOT NULL,

  CONSTRAINT trial_submission_time_check
    CHECK (
      trial_status_submission_at IS NULL
      OR trial_status_submission_at >= trial_first_requested_at
    ),

  CONSTRAINT trial_started_time_check
    CHECK (
      started_at IS NULL
      OR started_at >= trial_first_requested_at
    ),

  CONSTRAINT trial_expiry_time_check
    CHECK (
      expires_at IS NULL
      OR (started_at IS NOT NULL AND expires_at >= started_at)
    ),

  CONSTRAINT trial_conversion_time_check
    CHECK (
      converted_at IS NULL
      OR (started_at IS NOT NULL AND converted_at >= started_at)
    ),

  CONSTRAINT trial_cancellation_time_check
    CHECK (
      cancelled_at IS NULL
      OR cancelled_at >= trial_first_requested_at
    )
);

CREATE INDEX trial_registrations_lead_idx
ON trial_registrations (
  lead_id,
  trial_last_requested_at DESC
);

CREATE INDEX trial_registrations_status_idx
ON trial_registrations (
  trial_status,
  trial_last_requested_at DESC
);

CREATE INDEX trial_registrations_conversation_idx
ON trial_registrations (
  conversation_id
);

CREATE UNIQUE INDEX trial_one_open_request_per_lead
ON trial_registrations (lead_id)
WHERE trial_status IN (
  'requested',
  'in_progress'
);

-- ============================================================================
-- CAMPAIGNS
-- Purpose: Stores the campaign submitted by the free-trial registration form.
-- Uploaded PDFs belong in object/file storage; source_storage_key records their
-- durable location instead of storing large binary files in PostgreSQL.
-- ============================================================================

CREATE TABLE campaigns (
  campaign_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  trial_registration_id UUID NOT NULL UNIQUE
    REFERENCES trial_registrations(trial_registration_id)
    ON DELETE CASCADE,
  country VARCHAR(2) NOT NULL
    CHECK (country = lower(country)),

  quiz_slug VARCHAR(100) NOT NULL
    CHECK (quiz_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),

  registration_email TEXT NOT NULL
    CHECK (registration_email = btrim(registration_email)),

  terms_accepted_at TIMESTAMPTZ NOT NULL,
  campaign_status campaign_status_type NOT NULL DEFAULT 'submitted',
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),


  CONSTRAINT campaign_failure_message_check CHECK (
    campaign_status = 'failed' OR failure_message IS NULL
  )
);

CREATE INDEX campaigns_status_idx
  ON campaigns (campaign_status, created_at DESC);

CREATE INDEX campaigns_country_idx
  ON campaigns (country, created_at DESC);

CREATE INDEX campaigns_email_idx
  ON campaigns (lower(registration_email));

CREATE TRIGGER trg_campaigns_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- KNOWLEDGE DOCUMENTS
-- Purpose: Tracks each source document, such as a Google Drive PDF, and its
-- currently active OpenAI file/vector-store state.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- KNOWLEDGE DOCUMENTS
--
-- One row = one logical document.
--
-- Example:
-- ProductGuide.pdf
--
-- This row survives all replacements/deletions/reuploads.
-- ============================================================



/*
 * ============================================================
 * KNOWLEDGE DOCUMENTS
 * One row = one logical PDF.
 * ============================================================
 */

CREATE TABLE knowledge_documents (

  knowledge_document_id UUID
    PRIMARY KEY
    DEFAULT gen_random_uuid(),

  /*
   * Normalized filename used to recognize the same
   * logical document after re-upload.
   *
   * Example:
   * ProductGuide.pdf -> productguide.pdf
   */
  document_key TEXT
    NOT NULL
    UNIQUE,

  document_name TEXT
    NOT NULL,

  current_version_number INTEGER
    NOT NULL
    DEFAULT 0
    CHECK (
      current_version_number >= 0
    ),

  current_drive_file_id TEXT,

  current_openai_file_id TEXT,

  vector_store_id TEXT,

  is_active BOOLEAN
    NOT NULL
    DEFAULT TRUE,

  last_checked_at TIMESTAMPTZ,

  last_synced_at TIMESTAMPTZ,

  removed_from_source_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL
    DEFAULT now(),

  updated_at TIMESTAMPTZ
    NOT NULL
    DEFAULT now()
);


/*
 * ============================================================
 * KNOWLEDGE DOCUMENT VERSIONS
 *
 * Every historical version stays here.
 * ============================================================
 */

CREATE TABLE knowledge_document_versions (

  knowledge_document_version_id UUID
    PRIMARY KEY
    DEFAULT gen_random_uuid(),

  knowledge_document_id UUID
    NOT NULL
    REFERENCES knowledge_documents(
      knowledge_document_id
    )
    ON DELETE CASCADE,

  version_number INTEGER
    NOT NULL
    CHECK (
      version_number > 0
    ),

  /*
   * Google Drive ID when this version was active.
   */
  source_drive_file_id TEXT,

  original_filename TEXT
    NOT NULL,

  /*
   * Information about archived Drive copy.
   */
  archived_drive_file_id TEXT,

  archived_filename TEXT,
  document_version_key TEXT,
  /*
   * SHA-256 of PDF contents.
   */
  source_checksum CHAR(64)
    NOT NULL
    CHECK (
      source_checksum ~
      '^[0-9a-f]{64}$'
    ),

  source_size_bytes BIGINT
    CHECK (
      source_size_bytes IS NULL
      OR source_size_bytes >= 0
    ),

  source_modified_at TIMESTAMPTZ,

  openai_file_id TEXT,

  vector_store_id TEXT,

  version_status TEXT
    NOT NULL
    CHECK (
      version_status IN (
        'active',
        'retired',
        'deleted',
        'failed'
      )
    ),

  retired_reason TEXT,

  drive_status TEXT
    NOT NULL
    DEFAULT 'active_folder'
    CHECK (
      drive_status IN (
        'active_folder',
        'archived',
        'permanently_deleted',
        'missing'
      )
    ),

  openai_status TEXT
    NOT NULL
    DEFAULT 'not_uploaded'
    CHECK (
      openai_status IN (
        'not_uploaded',
        'active',
        'removed',
        'failed'
      )
    ),

  indexed_at TIMESTAMPTZ,

  archived_at TIMESTAMPTZ,

  retired_at TIMESTAMPTZ,
  permanently_deleted TIMESTAMPTZ,

  deleted_at TIMESTAMPTZ,

  removed_from_openai_at TIMESTAMPTZ,

  failure_message TEXT,

  created_at TIMESTAMPTZ
    NOT NULL
    DEFAULT now(),

  UNIQUE (
    knowledge_document_id,
    version_number
  )
);


/*
 * Only one ACTIVE version for each logical document.
 */
CREATE UNIQUE INDEX
knowledge_one_active_version_per_document
ON knowledge_document_versions (
  knowledge_document_id
)
WHERE version_status = 'active';


CREATE INDEX
knowledge_versions_document_idx
ON knowledge_document_versions (
  knowledge_document_id,
  version_number DESC
);


CREATE INDEX
knowledge_versions_status_idx
ON knowledge_document_versions (
  version_status
);


CREATE INDEX
knowledge_versions_openai_file_idx
ON knowledge_document_versions (
  openai_file_id
)
WHERE openai_file_id IS NOT NULL;


/*
 * ============================================================
 * KNOWLEDGE SYNC EVENTS
 *
 * Optional audit history.
 * ============================================================
 */

CREATE TABLE knowledge_sync_events (

  knowledge_sync_event_id UUID
    PRIMARY KEY
    DEFAULT gen_random_uuid(),

  knowledge_document_id UUID
    REFERENCES knowledge_documents(
      knowledge_document_id
    )
    ON DELETE SET NULL,

  knowledge_document_version_id UUID
    REFERENCES knowledge_document_versions(
      knowledge_document_version_id
    )
    ON DELETE SET NULL,

  event_type TEXT
    NOT NULL,

  drive_file_id TEXT,

  openai_file_id TEXT,

  details JSONB,

  created_at TIMESTAMPTZ
    NOT NULL
    DEFAULT now()
);


CREATE INDEX
knowledge_sync_events_document_idx
ON knowledge_sync_events (
  knowledge_document_id,
  created_at DESC
);


/*
 * ============================================================
 * MESSAGE KNOWLEDGE SOURCES
 *
 * IMPORTANT:
 * The knowledge IDs are UUID because the new knowledge
 * tables use UUID primary keys.
 * ============================================================
 */

CREATE TABLE message_knowledge_sources (

  message_knowledge_source_id
    BIGSERIAL PRIMARY KEY,

  message_id UUID NOT NULL
    REFERENCES messages(message_id)
    ON DELETE CASCADE,

  knowledge_document_id UUID NOT NULL
    REFERENCES knowledge_documents(
      knowledge_document_id
    )
    ON DELETE RESTRICT,

  knowledge_document_version_id UUID
    REFERENCES knowledge_document_versions(
      knowledge_document_version_id
    )
    ON DELETE SET NULL,

  openai_file_id TEXT NOT NULL,

  citation_label TEXT,

  citation_text TEXT,

  citation_index INTEGER
    CHECK (
      citation_index IS NULL
      OR citation_index >= 0
    ),

  relevance_score NUMERIC(6,5)
    CHECK (
      relevance_score IS NULL
      OR relevance_score BETWEEN 0 AND 1
    ),

  rank_position INTEGER
    CHECK (
      rank_position IS NULL
      OR rank_position > 0
    ),

  created_at TIMESTAMPTZ
    NOT NULL
    DEFAULT now(),

  CONSTRAINT
    message_knowledge_source_unique

    UNIQUE (
      message_id,
      openai_file_id
    )
);


CREATE INDEX
message_knowledge_sources_message_idx
ON message_knowledge_sources (
  message_id,
  rank_position
);


CREATE INDEX
message_knowledge_sources_document_idx
ON message_knowledge_sources (
  knowledge_document_id,
  created_at DESC
);


/*
 * updated_at trigger.
 *
 * You already have set_updated_at(), but CREATE OR REPLACE
 * makes this safe.
 */
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER
trg_knowledge_documents_updated_at
BEFORE UPDATE
ON knowledge_documents
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


