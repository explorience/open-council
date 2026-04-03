-- Open Council: Watchlist & Alerts Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL)

-- Watchlist items (synced from localStorage when user signs in)
create table if not exists public.watchlist (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  slug text not null,
  title text not null,
  date_added timestamptz default now() not null,
  last_checked timestamptz default now() not null,
  created_at timestamptz default now() not null,
  
  constraint watchlist_user_slug_unique unique (user_id, slug)
);

-- Alert preferences (how users want to be notified)
create table if not exists public.alert_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  channel text check (channel in ('email', 'sms')) default 'email' not null,
  frequency text check (frequency in ('instant', 'daily', 'weekly')) default 'daily' not null,
  email text,
  phone text,
  committees text[], -- filter by committee slug prefixes
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Alert history (sent notifications, for dedup and display)
create table if not exists public.alert_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  slug text not null,
  title text not null,
  alert_type text not null, -- 'new_meeting', 'vote_update', 'topic_change'
  sent_via text, -- 'email', 'sms', 'web'
  sent_at timestamptz default now() not null,
  read_at timestamptz
);

-- User profiles (minimal, auto-populated from auth)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Indexes
create index if not exists idx_watchlist_user_id on public.watchlist(user_id);
create index if not exists idx_watchlist_slug on public.watchlist(slug);
create index if not exists idx_alert_history_user_id on public.alert_history(user_id);
create index if not exists idx_alert_history_sent_at on public.alert_history(sent_at desc);

-- Row Level Security (RLS)
alter table public.watchlist enable row level security;
alter table public.alert_preferences enable row level security;
alter table public.alert_history enable row level security;
alter table public.profiles enable row level security;

-- Users can only access their own data
create policy "Users can view own watchlist" on public.watchlist
  for select using (auth.uid() = user_id);

create policy "Users can insert own watchlist" on public.watchlist
  for insert with check (auth.uid() = user_id);

create policy "Users can update own watchlist" on public.watchlist
  for update using (auth.uid() = user_id);

create policy "Users can delete own watchlist" on public.watchlist
  for delete using (auth.uid() = user_id);

create policy "Users can view own alert prefs" on public.alert_preferences
  for select using (auth.uid() = user_id);

create policy "Users can manage own alert prefs" on public.alert_preferences
  for all using (auth.uid() = user_id);

create policy "Users can view own alert history" on public.alert_history
  for select using (auth.uid() = user_id);

create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
