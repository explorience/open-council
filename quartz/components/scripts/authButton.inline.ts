import {
  getSupabaseClient,
  signInWithGoogle,
  signInWithMagicLink,
  signOut,
  getCurrentUser,
  syncWatchlistToSupabase,
  fetchWatchlistFromSupabase,
  saveAlertPreference,
  getAlertPreference,
  saveLocalWatchlist,
} from "./supabase-client"
import type { AlertPreference } from "./supabase-client"

document.addEventListener("nav", async () => {
  const container = document.getElementById("auth-container")
  if (!container) return

  const signedOutEl = document.getElementById("auth-signed-out") as HTMLElement
  const signedInEl = document.getElementById("auth-signed-in") as HTMLElement
  const triggerBtn = document.getElementById("auth-trigger") as HTMLButtonElement
  const dropdown = document.getElementById("auth-dropdown") as HTMLElement
  const googleBtn = document.getElementById("auth-google") as HTMLButtonElement
  const emailForm = document.getElementById("auth-email-form") as HTMLFormElement
  const emailInput = document.getElementById("auth-email-input") as HTMLInputElement
  const emailSent = document.getElementById("auth-email-sent") as HTMLElement
  const userBtn = document.getElementById("auth-user-btn") as HTMLButtonElement
  const userDropdown = document.getElementById("auth-user-dropdown") as HTMLElement
  const avatarEl = document.getElementById("auth-avatar") as HTMLElement
  const nameEl = document.getElementById("auth-user-name") as HTMLElement
  const signoutBtn = document.getElementById("auth-signout") as HTMLButtonElement
  const prefsBtn = document.getElementById("auth-prefs-btn") as HTMLButtonElement
  const prefsModal = document.getElementById("alert-prefs-modal") as HTMLElement
  const prefsClose = document.getElementById("alert-prefs-close") as HTMLButtonElement
  const prefsForm = document.getElementById("alert-prefs-form") as HTMLFormElement

  const client = await getSupabaseClient()
  if (!client) {
    // No Supabase configured - hide auth entirely
    container.style.display = "none"
    return
  }

  function showSignedIn(user: any) {
    signedOutEl.style.display = "none"
    signedInEl.style.display = "flex"
    const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "User"
    nameEl.textContent = name
    avatarEl.textContent = name.charAt(0).toUpperCase()
  }

  function showSignedOut() {
    signedOutEl.style.display = "flex"
    signedInEl.style.display = "none"
    dropdown.style.display = "none"
    userDropdown.style.display = "none"
  }

  // Check current session
  const user = await getCurrentUser()
  if (user) {
    showSignedIn(user)
    // Sync watchlist on load
    const items = await fetchWatchlistFromSupabase()
    saveLocalWatchlist(items)
    window.dispatchEvent(new CustomEvent("oc-watchlist-changed"))
  } else {
    showSignedOut()
  }

  // Auth state changes
  const { data: { subscription } } = client.auth.onAuthStateChange(async (event: string, session: any) => {
    if (event === "SIGNED_IN" && session?.user) {
      showSignedIn(session.user)
      await syncWatchlistToSupabase()
      const items = await fetchWatchlistFromSupabase()
      saveLocalWatchlist(items)
      window.dispatchEvent(new CustomEvent("oc-watchlist-changed"))
    } else if (event === "SIGNED_OUT") {
      showSignedOut()
    }
  })

  // Toggle sign-in dropdown
  function toggleDropdown(e: Event) {
    e.stopPropagation()
    dropdown.style.display = dropdown.style.display === "none" ? "block" : "none"
  }
  triggerBtn?.addEventListener("click", toggleDropdown)

  // Google sign-in
  function handleGoogle() {
    signInWithGoogle()
  }
  googleBtn?.addEventListener("click", handleGoogle)

  // Magic link
  function handleEmailSubmit(e: Event) {
    e.preventDefault()
    const email = emailInput.value.trim()
    if (!email) return
    signInWithMagicLink(email)
    emailForm.style.display = "none"
    emailSent.style.display = "block"
  }
  emailForm?.addEventListener("submit", handleEmailSubmit)

  // User dropdown
  function toggleUserDropdown(e: Event) {
    e.stopPropagation()
    userDropdown.style.display = userDropdown.style.display === "none" ? "block" : "none"
  }
  userBtn?.addEventListener("click", toggleUserDropdown)

  // Sign out
  function handleSignout() {
    signOut()
    showSignedOut()
  }
  signoutBtn?.addEventListener("click", handleSignout)

  // Alert preferences
  function openPrefs() {
    prefsModal.style.display = "flex"
    userDropdown.style.display = "none"
    loadPrefs()
  }
  prefsBtn?.addEventListener("click", openPrefs)

  function closePrefs() {
    prefsModal.style.display = "none"
  }
  prefsClose?.addEventListener("click", closePrefs)

  async function loadPrefs() {
    const pref = await getAlertPreference()
    if (!pref) return
    const channelRadio = prefsForm.querySelector(`input[name="alert-channel"][value="${pref.channel}"]`) as HTMLInputElement
    if (channelRadio) channelRadio.checked = true
    const freqRadio = prefsForm.querySelector(`input[name="alert-freq"][value="${pref.frequency}"]`) as HTMLInputElement
    if (freqRadio) freqRadio.checked = true
    if (pref.email) (document.getElementById("alert-email") as HTMLInputElement).value = pref.email
    if (pref.phone) (document.getElementById("alert-phone") as HTMLInputElement).value = pref.phone
    updateChannelVisibility()
  }

  function updateChannelVisibility() {
    const channel = (prefsForm.querySelector('input[name="alert-channel"]:checked') as HTMLInputElement)?.value
    const emailGroup = document.getElementById("alert-email-group") as HTMLElement
    const phoneGroup = document.getElementById("alert-phone-group") as HTMLElement
    if (channel === "email") {
      emailGroup.style.display = ""
      phoneGroup.style.display = "none"
    } else {
      emailGroup.style.display = "none"
      phoneGroup.style.display = ""
    }
  }

  prefsForm?.querySelectorAll('input[name="alert-channel"]').forEach((radio) => {
    radio.addEventListener("change", updateChannelVisibility)
  })

  async function handlePrefsSubmit(e: Event) {
    e.preventDefault()
    const channel = (prefsForm.querySelector('input[name="alert-channel"]:checked') as HTMLInputElement)?.value as "email" | "sms"
    const frequency = (prefsForm.querySelector('input[name="alert-freq"]:checked') as HTMLInputElement)?.value as "instant" | "daily" | "weekly"
    const email = (document.getElementById("alert-email") as HTMLInputElement)?.value
    const phone = (document.getElementById("alert-phone") as HTMLInputElement)?.value

    const pref: AlertPreference = { channel, frequency, email, phone }
    const saved = await saveAlertPreference(pref)
    if (saved) {
      closePrefs()
    }
  }
  prefsForm?.addEventListener("submit", handlePrefsSubmit)

  // Close dropdowns on outside click
  function closeOnOutsideClick(e: Event) {
    if (!dropdown.contains(e.target as Node) && e.target !== triggerBtn) {
      dropdown.style.display = "none"
    }
    if (!userDropdown.contains(e.target as Node) && e.target !== userBtn) {
      userDropdown.style.display = "none"
    }
  }
  document.addEventListener("click", closeOnOutsideClick)

  window.addCleanup(() => {
    subscription?.unsubscribe()
    triggerBtn?.removeEventListener("click", toggleDropdown)
    googleBtn?.removeEventListener("click", handleGoogle)
    emailForm?.removeEventListener("submit", handleEmailSubmit)
    userBtn?.removeEventListener("click", toggleUserDropdown)
    signoutBtn?.removeEventListener("click", handleSignout)
    prefsBtn?.removeEventListener("click", openPrefs)
    prefsClose?.removeEventListener("click", closePrefs)
    prefsForm?.removeEventListener("submit", handlePrefsSubmit)
    document.removeEventListener("click", closeOnOutsideClick)
  })
})
