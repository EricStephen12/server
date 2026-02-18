-- Create Profiles Table (Linked to Auth Users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  plan_type text default 'free', -- 'free', 'pro', 'agency'
  paddle_customer_id text,
  subscription_status text default 'inactive',
  total_scripts integer default 0,
  total_pins integer default 0,
  total_videos_analyzed integer default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for Profiles
alter table public.profiles enable row level security;

-- Policy: Users can view their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using ( auth.uid() = id );

-- Policy: Users can update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  using ( auth.uid() = id );

-- Enable RLS for Ads
alter table public.ads enable row level security;

-- CRITICAL FIX: Allow public read access to ads
create policy "Ads are viewable by everyone"
  on public.ads for select
  using ( true );

-- Function to handle new user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, plan_type, subscription_status)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    'free',
    'inactive'
  );
  return new;
end;
$$;

-- Trigger the function every time a user is created
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Atomic Increment Function for Stats
create or replace function public.increment_profile_stat(user_id uuid, stat_column text)
returns void
language plpgsql
security definer
as $$
begin
  execute format('update public.profiles set %I = %I + 1 where id = $1', stat_column, stat_column)
  using user_id;
end;
$$;
