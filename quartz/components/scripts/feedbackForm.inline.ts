// Feedback form - submits via AJAX to /api/feedback
function init() {
  const form = document.getElementById("feedback-form") as HTMLFormElement
  if (!form) return

  form.addEventListener("submit", async (e) => {
    e.preventDefault()

    const submitBtn = document.getElementById("fb-submit") as HTMLButtonElement
    const statusEl = document.getElementById("fb-status") as HTMLDivElement

    const email = (document.getElementById("fb-email") as HTMLInputElement).value
    const name = (document.getElementById("fb-name") as HTMLInputElement).value
    const type = (document.getElementById("fb-type") as HTMLSelectElement).value
    const message = (document.getElementById("fb-message") as HTMLTextAreaElement).value

    if (!email || !type || !message) {
      statusEl.textContent = "Please fill in all required fields."
      statusEl.className = "feedback-status error"
      return
    }

    submitBtn.disabled = true
    submitBtn.textContent = "Sending..."
    statusEl.textContent = ""

    try {
      // Get the API base URL (same origin for the chat API)
      const chatbotEl = document.querySelector("[data-api-url]")
      let apiBase = chatbotEl?.getAttribute("data-api-url") || ""
      // If chatbot API URL is available, derive the base; otherwise use env
      if (apiBase.includes("/api/chat")) {
        apiBase = apiBase.replace("/api/chat", "")
      } else {
        // Fallback: try common locations
        apiBase = window.location.hostname === "localhost"
          ? "http://localhost:3001"
          : "https://open-council-production.up.railway.app"
      }

      const resp = await fetch(`${apiBase}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, type, message }),
      })

      const data = await resp.json()

      if (resp.ok) {
        statusEl.textContent = "Thank you! Your feedback has been submitted."
        statusEl.className = "feedback-status success"
        form.reset()
      } else {
        statusEl.textContent = data.error || "Something went wrong. Please try again."
        statusEl.className = "feedback-status error"
      }
    } catch (err) {
      statusEl.textContent = "Failed to send. Please email info@opencouncil.xyz instead."
      statusEl.className = "feedback-status error"
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = "Send Feedback"
    }
  })
}

document.addEventListener("nav", init)
