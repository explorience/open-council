/**
 * Supabase client for Open Council
 * 
 * Progressive enhancement: works with localStorage when no Supabase configured,
 * syncs to Supabase when user is authenticated.
 * 
 * Config is injected at build time via quartz.config.ts or read from meta tags.
 */

declare global {
  interface Window {
    __OC_SUPABASE_URL?: string
    __OC_SUPABASE_ANON_KEY?: string
  }
}

interface SupabaseAuth {
  signInWithOAuth(opts: { provider: string; options?: { redirectTo?: string } }): Promise<any>
  signInWithOtp(opts: { email: string; options?: { emailRedirectTo?: string } }): Promise<any>
  signOut(): Promise<any>
  getSession(): Promise<{ data: { session: any } }>
  onAuthStateChange(cb: (event: string, session: any) => void): { data: { subscription: { unsubscribe: () => void } } }
  getUser(): Promise<{ data: { user: any } }>
}

interface SupabaseClient {
  auth: SupabaseAuth
  from(table: string): any
  rpc(fn: string, params?: any): Promise<any>
}

let _client: SupabaseClient | null = null
let _clientPromise: Promise<SupabaseClient | null> | null = null

function getConfig(): { url: string; anonKey: string } | null {
  // Check window globals first (set by inline config)
  const url = window.__OC_SUPABASE_URL 
    || document.querySelector<HTMLMetaElement>('meta[name="supabase-url"]')?.content
  const anonKey = window.__OC_SUPABASE_ANON_KEY 
    || document.querySelector<HTMLMetaElement>('meta[name="supabase-anon-key"]')?.content

  if (url && anonKey) return { url, anonKey }
  return null
}

async function loadSupabaseLib(): Promise<any> {
  // Dynamic import from CDN - keeps bundle size zero when not using Supabase
  const script = document.createElement("script")
  script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"
  
  return new Promise((resolve, reject) => {
    script.onload = () => {
      const sb = (window as any).supabase
      if (sb?.createClient) resolve(sb)
      else reject(new Error("Supabase lib loaded but createClient not found"))
    }
    script.onerror = () => reject(new Error("Failed to load Supabase"))
    document.head.appendChild(script)
  })
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (_client) return _client
  if (_clientPromise) return _clientPromise

  _clientPromise = (async () => {
    const config = getConfig()
    if (!config) return null

    try {
      const lib = await loadSupabaseLib()
      _client = lib.createClient(config.url, config.anonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
      return _client
    } catch (e) {
      console.warn("[OC] Supabase unavailable, using localStorage only:", e)
      return null
    }
  })()

  return _clientPromise
}

// Auth helpers
export async function signInWithGoogle() {
  const client = await getSupabaseClient()
  if (!client) return null
  return client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/watchlist" },
  })
}

export async function signInWithMagicLink(email: string) {
  const client = await getSupabaseClient()
  if (!client) return null
  return client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + "/watchlist" },
  })
}

export async function signOut() {
  const client = await getSupabaseClient()
  if (!client) return
  return client.auth.signOut()
}

export async function getCurrentUser() {
  const client = await getSupabaseClient()
  if (!client) return null
  const { data } = await client.auth.getUser()
  return data.user
}

export async function getSession() {
  const client = await getSupabaseClient()
  if (!client) return null
  const { data } = await client.auth.getSession()
  return data.session
}

// Watchlist sync
export interface WatchItem {
  slug: string
  title: string
  dateAdded: string
  lastChecked: string
}

const STORAGE_KEY = "oc-watchlist"

export function getLocalWatchlist(): WatchItem[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch {
    return []
  }
}

export function saveLocalWatchlist(items: WatchItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export async function syncWatchlistToSupabase(): Promise<boolean> {
  const client = await getSupabaseClient()
  if (!client) return false

  const user = await getCurrentUser()
  if (!user) return false

  const localItems = getLocalWatchlist()
  if (localItems.length === 0) return true

  // Upsert local items to Supabase
  const rows = localItems.map((item) => ({
    user_id: user.id,
    slug: item.slug,
    title: item.title,
    date_added: item.dateAdded,
    last_checked: item.lastChecked,
  }))

  const { error } = await client
    .from("watchlist")
    .upsert(rows, { onConflict: "user_id,slug" })

  if (error) {
    console.error("[OC] Failed to sync watchlist:", error)
    return false
  }
  return true
}

export async function fetchWatchlistFromSupabase(): Promise<WatchItem[]> {
  const client = await getSupabaseClient()
  if (!client) return getLocalWatchlist()

  const user = await getCurrentUser()
  if (!user) return getLocalWatchlist()

  const { data, error } = await client
    .from("watchlist")
    .select("slug, title, date_added, last_checked")
    .eq("user_id", user.id)
    .order("date_added", { ascending: false })

  if (error || !data) return getLocalWatchlist()

  const items: WatchItem[] = data.map((row: any) => ({
    slug: row.slug,
    title: row.title,
    dateAdded: row.date_added,
    lastChecked: row.last_checked,
  }))

  // Merge: remote wins for items that exist in both
  const localItems = getLocalWatchlist()
  const remoteSlugs = new Set(items.map((i) => i.slug))
  const localOnly = localItems.filter((i) => !remoteSlugs.has(i.slug))

  const merged = [...items, ...localOnly]
  saveLocalWatchlist(merged)
  return merged
}

export async function addWatchItem(slug: string, title: string): Promise<void> {
  const item: WatchItem = {
    slug,
    title,
    dateAdded: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
  }

  // Always save locally
  const local = getLocalWatchlist()
  if (!local.some((i) => i.slug === slug)) {
    local.push(item)
    saveLocalWatchlist(local)
  }

  // Try to save to Supabase
  const client = await getSupabaseClient()
  const user = await getCurrentUser()
  if (client && user) {
    await client.from("watchlist").upsert({
      user_id: user.id,
      slug: item.slug,
      title: item.title,
      date_added: item.dateAdded,
      last_checked: item.lastChecked,
    }, { onConflict: "user_id,slug" })
  }

  window.dispatchEvent(new CustomEvent("oc-watchlist-changed"))
}

export async function removeWatchItem(slug: string): Promise<void> {
  // Remove locally
  const local = getLocalWatchlist().filter((i) => i.slug !== slug)
  saveLocalWatchlist(local)

  // Remove from Supabase
  const client = await getSupabaseClient()
  const user = await getCurrentUser()
  if (client && user) {
    await client.from("watchlist").delete().eq("user_id", user.id).eq("slug", slug)
  }

  window.dispatchEvent(new CustomEvent("oc-watchlist-changed"))
}

export function isWatching(slug: string): boolean {
  return getLocalWatchlist().some((i) => i.slug === slug)
}

// Alert preferences
export interface AlertPreference {
  channel: "email" | "sms"
  frequency: "instant" | "daily" | "weekly"
  email?: string
  phone?: string
  committees?: string[]
}

export async function saveAlertPreference(pref: AlertPreference): Promise<boolean> {
  const client = await getSupabaseClient()
  const user = await getCurrentUser()
  if (!client || !user) return false

  const { error } = await client.from("alert_preferences").upsert({
    user_id: user.id,
    channel: pref.channel,
    frequency: pref.frequency,
    email: pref.email,
    phone: pref.phone,
    committees: pref.committees,
  }, { onConflict: "user_id" })

  return !error
}

export async function getAlertPreference(): Promise<AlertPreference | null> {
  const client = await getSupabaseClient()
  const user = await getCurrentUser()
  if (!client || !user) return null

  const { data } = await client
    .from("alert_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single()

  return data
}
