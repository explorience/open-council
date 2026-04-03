import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/authButton.scss"
// @ts-ignore
import script from "./scripts/authButton.inline"

const AuthButton: QuartzComponent = (_props: QuartzComponentProps) => {
  return (
    <div class="auth-container" id="auth-container">
      {/* Signed out state */}
      <div class="auth-signed-out" id="auth-signed-out">
        <button class="auth-trigger" id="auth-trigger">
          Sign in to sync
        </button>
        <div class="auth-dropdown" id="auth-dropdown" style="display: none">
          <div class="auth-dropdown-header">
            <h4>Sync your watchlist</h4>
            <p>Sign in to save your watchlist across devices and get alerts.</p>
          </div>
          <button class="auth-google-btn" id="auth-google">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
          <div class="auth-divider"><span>or</span></div>
          <form class="auth-email-form" id="auth-email-form">
            <input type="email" placeholder="your@email.com" id="auth-email-input" required />
            <button type="submit" class="auth-email-btn">Send magic link</button>
          </form>
          <p class="auth-email-sent" id="auth-email-sent" style="display: none">
            Check your inbox for a sign-in link.
          </p>
        </div>
      </div>

      {/* Signed in state */}
      <div class="auth-signed-in" id="auth-signed-in" style="display: none">
        <button class="auth-user-btn" id="auth-user-btn">
          <span class="auth-avatar" id="auth-avatar">?</span>
          <span class="auth-user-name" id="auth-user-name"></span>
        </button>
        <div class="auth-user-dropdown" id="auth-user-dropdown" style="display: none">
          <a href="/watchlist" class="auth-menu-item">My Watchlist</a>
          <a href="/alerts" class="auth-menu-item">Alerts</a>
          <button class="auth-menu-item auth-prefs-btn" id="auth-prefs-btn">Alert Preferences</button>
          <hr />
          <button class="auth-menu-item auth-signout" id="auth-signout">Sign out</button>
        </div>
      </div>

      {/* Alert preferences modal */}
      <div class="alert-prefs-modal" id="alert-prefs-modal" style="display: none">
        <div class="alert-prefs-content">
          <div class="alert-prefs-header">
            <h3>Alert Preferences</h3>
            <button class="alert-prefs-close" id="alert-prefs-close" aria-label="Close">&times;</button>
          </div>
          <form id="alert-prefs-form">
            <div class="form-group">
              <label>Get notified via</label>
              <div class="radio-group">
                <label><input type="radio" name="alert-channel" value="email" checked /> Email</label>
                <label><input type="radio" name="alert-channel" value="sms" /> SMS</label>
              </div>
            </div>
            <div class="form-group" id="alert-email-group">
              <label for="alert-email">Email address</label>
              <input type="email" id="alert-email" placeholder="your@email.com" />
            </div>
            <div class="form-group" id="alert-phone-group" style="display: none">
              <label for="alert-phone">Phone number</label>
              <input type="tel" id="alert-phone" placeholder="+1 519 555 0123" />
            </div>
            <div class="form-group">
              <label>How often</label>
              <div class="radio-group">
                <label><input type="radio" name="alert-freq" value="instant" /> Instant</label>
                <label><input type="radio" name="alert-freq" value="daily" checked /> Daily digest</label>
                <label><input type="radio" name="alert-freq" value="weekly" /> Weekly summary</label>
              </div>
            </div>
            <button type="submit" class="alert-prefs-save">Save preferences</button>
          </form>
        </div>
      </div>
    </div>
  )
}

AuthButton.css = style
AuthButton.afterDOMLoaded = script
AuthButton.displayName = "AuthButton"

export default (() => AuthButton) satisfies QuartzComponentConstructor
