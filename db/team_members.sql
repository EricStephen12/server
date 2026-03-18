-- Team Members table for Agency plan
CREATE TABLE IF NOT EXISTS team_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_email text NOT NULL,
  member_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role text DEFAULT 'member',
  status text DEFAULT 'pending',
  invited_at timestamp with time zone DEFAULT now(),
  joined_at timestamp with time zone,
  UNIQUE(owner_id, member_email)
);
