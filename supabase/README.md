# Supabase Setup for Open Council

## Quick Start

1. **Create a Supabase project** at [supabase.com](https://supabase.com)
   - Name: `open-council`
   - Region: US East (closest to Railway)

2. **Run the migration**
   - Go to SQL Editor in your Supabase dashboard
   - Paste the contents of `migrations/001_watchlist_and_alerts.sql`
   - Run it

3. **Enable Google OAuth** (optional but recommended)
   - Go to Authentication > Providers > Google
   - Enable it
   - Add your Google OAuth client ID and secret
   - Set redirect URL to `https://opencouncil.xyz/watchlist`

4. **Configure the site**
   Add these to your build environment (Railway):
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   ```

   Or add meta tags to `quartz/components/Head.tsx`:
   ```html
   <meta name="supabase-url" content="https://your-project.supabase.co" />
   <meta name="supabase-anon-key" content="your-anon-key" />
   ```

5. **Add site URL in Supabase**
   - Go to Authentication > URL Configuration
   - Set Site URL to `https://opencouncil.xyz`
   - Add `https://opencouncil.xyz/**` to Redirect URLs

## Progressive Enhancement

The system works **without Supabase**:
- WatchButton uses localStorage (no account needed)
- WatchlistPage reads from localStorage
- AlertsFeed reads from content index

**With Supabase**, users get:
- Cross-device sync
- Email/SMS alerts
- Persistent watchlists

The Supabase JS client is loaded from CDN only when configured, keeping the base bundle size at zero.

## Tables

| Table | Purpose |
|-------|---------|
| `watchlist` | User's watched topics/meetings |
| `alert_preferences` | Notification channel + frequency |
| `alert_history` | Sent notifications (dedup/display) |
| `profiles` | Minimal user info from auth |

All tables have Row Level Security - users can only see their own data.

## Edge Functions (Future)

For sending actual email/SMS alerts, you'll need Supabase Edge Functions:
- `send-daily-digest` - cron job, sends daily alert emails
- `send-instant-alert` - triggered by DB changes, sends immediate notifications
- Uses Resend (email) or Twilio (SMS)
