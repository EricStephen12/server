-- Add missing tracking and billing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_videos_analyzed integer DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_customer_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS next_billing_date timestamp with time zone;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
