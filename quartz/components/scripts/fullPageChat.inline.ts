// Full Page Chat - For non-homepage pages
// A full-viewport chat overlay that can be triggered from any page

import { Marked } from "marked"

interface Message {
  role: "user" | "assistant"
  content: string
}

// Chat history persists across open/close cycles
const chatHistory: Message[] = []

// Configure marked for chat-friendly rendering
const marked = new Marked({
  breaks: true,
  gfm: true,
})

// Custom renderer to add target="_blank" to links
const renderer = {
  link({ href, title, text }: { href: string; title?: string | null | undefined; text: string }) {
    const titleAttr = title ? ` title="${title}"` : ""
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener">${text}</a>`
  },
}
marked.use({ renderer })

function renderMarkdown(content: string): string {
  return marked.parse(content) as string
}

function createMessageElement(role: "user" | "assistant", content: string): HTMLElement {
  const messageDiv = document.createElement("div")
  messageDiv.className = `fpc-message ${role}`

  const contentDiv = document.createElement("div")
  contentDiv.className = "fpc-message-content"
  contentDiv.innerHTML = renderMarkdown(content)
  messageDiv.appendChild(contentDiv)

  return messageDiv
}

function createLoadingElement(): HTMLElement {
  const messageDiv = document.createElement("div")
  messageDiv.className = "fpc-message assistant"

  const contentDiv = document.createElement("div")
  contentDiv.className = "fpc-message-content"

  const loadingDiv = document.createElement("div")
  loadingDiv.className = "fpc-loading"
  loadingDiv.setAttribute("role", "status")
  loadingDiv.setAttribute("aria-label", "Loading response")
  loadingDiv.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>'

  contentDiv.appendChild(loadingDiv)
  messageDiv.appendChild(contentDiv)

  return messageDiv
}

function scrollToBottom(container: HTMLElement) {
  container.scrollTop = container.scrollHeight
}

function autoResize(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto"
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px"
}

// Copy functionality
function copyToClipboard(text: string, button: HTMLButtonElement) {
  navigator.clipboard.writeText(text).then(() => {
    button.classList.add("copied")

    // Announce to screen readers
    const announcement = document.createElement("div")
    announcement.setAttribute("role", "status")
    announcement.setAttribute("aria-live", "polite")
    announcement.className = "sr-only"
    announcement.textContent = "Copied to clipboard"
    document.body.appendChild(announcement)

    setTimeout(() => {
      button.classList.remove("copied")
      announcement.remove()
    }, 2000)
  }).catch(err => {
    console.error("Failed to copy:", err)
  })
}

function getLastExchange(): string {
  if (chatHistory.length < 2) return ""

  const lastUserMsg = [...chatHistory].reverse().find(m => m.role === "user")
  const lastAssistantMsg = [...chatHistory].reverse().find(m => m.role === "assistant")

  if (!lastUserMsg || !lastAssistantMsg) return ""

  return `Q: ${lastUserMsg.content}\n\nA: ${lastAssistantMsg.content}`
}

function getAllMessages(): string {
  return chatHistory.map(m => {
    const prefix = m.role === "user" ? "Q:" : "A:"
    return `${prefix} ${m.content}`
  }).join("\n\n")
}

document.addEventListener("nav", () => {
  const chat = document.querySelector(".full-page-chat") as HTMLElement
  if (!chat) return

  const apiUrl = chat.dataset.apiUrl || "https://open-council-production.up.railway.app"

  // Elements
  const input = chat.querySelector(".fpc-input") as HTMLTextAreaElement
  const sendBtn = chat.querySelector(".fpc-send-btn") as HTMLButtonElement
  const backBtn = chat.querySelector(".fpc-back-btn") as HTMLButtonElement
  const messagesContainer = chat.querySelector(".fpc-messages") as HTMLElement
  const copyLastBtn = chat.querySelector(".fpc-copy-last") as HTMLButtonElement
  const copyAllBtn = chat.querySelector(".fpc-copy-all") as HTMLButtonElement

  // Chat trigger button in header
  const triggerBtn = document.querySelector(".chat-trigger-btn") as HTMLButtonElement

  let isStreaming = false
  let previousFocus: HTMLElement | null = null

  // Open chat
  function openChat() {
    previousFocus = document.activeElement as HTMLElement
    chat.style.display = "flex"
    document.body.style.overflow = "hidden"

    setTimeout(() => {
      input?.focus()
      scrollToBottom(messagesContainer)
    }, 100)

    // Announce to screen readers
    const announcement = document.createElement("div")
    announcement.setAttribute("role", "status")
    announcement.setAttribute("aria-live", "polite")
    announcement.className = "sr-only"
    announcement.textContent = "Chat opened. Type your question."
    document.body.appendChild(announcement)
    setTimeout(() => announcement.remove(), 1000)
  }

  // Close chat
  function closeChat() {
    chat.style.display = "none"
    document.body.style.overflow = ""

    // Return focus to trigger button or previous focus
    setTimeout(() => {
      if (previousFocus && document.body.contains(previousFocus)) {
        previousFocus.focus()
      } else if (triggerBtn) {
        triggerBtn.focus()
      }
    }, 100)
  }

  // Send message
  async function sendMessage(message: string) {
    if (!message.trim() || isStreaming) return

    // Remove the welcome message on first user message
    const welcomeMessage = messagesContainer.querySelector(".fpc-message.assistant")
    if (welcomeMessage && chatHistory.length === 0) {
      welcomeMessage.remove()
    }

    // Add user message
    const userMessage = createMessageElement("user", message)
    messagesContainer.appendChild(userMessage)
    scrollToBottom(messagesContainer)
    chatHistory.push({ role: "user", content: message })

    // Clear and disable input
    input.value = ""
    input.style.height = "auto"
    input.disabled = true
    sendBtn.disabled = true
    isStreaming = true

    // Show loading
    const loadingElement = createLoadingElement()
    messagesContainer.appendChild(loadingElement)
    scrollToBottom(messagesContainer)

    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: chatHistory.slice(0, -1),
        }),
      })

      loadingElement.remove()

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // Create assistant message element
      const assistantMessage = createMessageElement("assistant", "")
      messagesContainer.appendChild(assistantMessage)
      const contentDiv = assistantMessage.querySelector(".fpc-message-content") as HTMLElement

      // Stream the response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullResponse = ""

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split("\n")

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6))

                if (data.error) {
                  contentDiv.innerHTML = `<p style="color: var(--tertiary);">Error: ${data.error}</p>`
                  break
                }

                if (data.content) {
                  fullResponse += data.content
                  contentDiv.innerHTML = renderMarkdown(fullResponse)
                  scrollToBottom(messagesContainer)
                }

                if (data.done) {
                  chatHistory.push({ role: "assistant", content: fullResponse })
                  break
                }
              } catch (e) {
                console.error("Error parsing SSE data:", e)
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error)

      if (loadingElement.parentElement) {
        loadingElement.remove()
      }

      const errorMessage = createMessageElement(
        "assistant",
        "Sorry, I encountered an error connecting to the server. Please try again.",
      )
      messagesContainer.appendChild(errorMessage)
    } finally {
      input.disabled = false
      sendBtn.disabled = false
      isStreaming = false
      input.focus()
      scrollToBottom(messagesContainer)
    }
  }

  // Event listeners
  triggerBtn?.addEventListener("click", () => {
    openChat()
  })

  sendBtn?.addEventListener("click", () => {
    sendMessage(input.value)
  })

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input.value)
    }
  })

  input?.addEventListener("input", () => {
    autoResize(input)
  })

  backBtn?.addEventListener("click", () => {
    if (!isStreaming) {
      closeChat()
    }
  })

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chat.style.display === "flex" && !isStreaming) {
      closeChat()
    }
  })

  // Copy buttons
  copyLastBtn?.addEventListener("click", () => {
    const text = getLastExchange()
    if (text) {
      copyToClipboard(text, copyLastBtn)
    }
  })

  copyAllBtn?.addEventListener("click", () => {
    const text = getAllMessages()
    if (text) {
      copyToClipboard(text, copyAllBtn)
    }
  })
})
