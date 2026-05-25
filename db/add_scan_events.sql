-- Migration: Add scan_events table for accurate monthly scan tracking
-- This replaces the broken lounge_sessions count approach

CREATE TABLE IF NOT EXISTS scan_events (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_events_user_created ON scan_events (user_id, created_at);
