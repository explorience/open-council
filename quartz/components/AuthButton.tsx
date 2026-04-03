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
