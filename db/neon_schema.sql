-- SOCIAL CONTENT TOOL - NEON.TECH SCHEMA (PostgreSQL)

-- 1. NEXTAUTH TABLES
CREATE TABLE IF NOT EXISTS accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_token text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires timestamp with time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text,
  email text UNIQUE,
  email_verified timestamp with time zone,
  image text,
  password text, -- Added for credentials auth
  subscription_tier text DEFAULT 'free',
  credits_remaining integer DEFAULT 10,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier text NOT NULL,
  token text NOT NULL UNIQUE,
  expires timestamp with time zone NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- 2. APPLICATION TABLES

-- Ads (Inspiration Library)
CREATE TABLE IF NOT EXISTS ads (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  niche text,
  video_url text NOT NULL,
  thumbnail_url text,
  views_count text,
  likes_count text,
  comments_count text,
  platform text DEFAULT 'tiktok',
  is_verified boolean DEFAULT false,
  visual_dna jsonb,
  analysis jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Scripts (Generated content)
CREATE TABLE IF NOT EXISTS scripts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title text,
  script_content jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Lounge Sessions (Creative Director)
CREATE TABLE IF NOT EXISTS lounge_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title text,
  video_url text,
  dna jsonb,
  messages jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Add tracking columns to users if needed beyond subscription
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_scripts integer DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_pins integer DEFAULT 0;
