// Prefill questions - click to send to chatbot

document.addEventListener("nav", () => {
  const prefillContainer = document.querySelector(".prefill-questions") as HTMLElement
  if (!prefillContainer) return

  const chips = prefillContainer.querySelectorAll(".prefill-chip")

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const question = (chip as HTMLElement).dataset.question
      if (!question) return

      // Find the chatbot
      const chatbot = document.querySelector(".chatbot") as HTMLElement
      const chatContainer = chatbot?.querySelector(".chatbot-container") as HTMLElement
      const chatInput = chatbot?.querySelector(".chatbot-input") as HTMLTextAreaElement
      const chatSendBtn = chatbot?.querySelector(".chatbot-send") as HTMLButtonElement

      if (chatContainer && chatInput && chatSendBtn) {
        // Show the chatbot
        chatContainer.style.display = "flex"

        // Set the question and send
        chatInput.value = question
        chatSendBtn.click()
      } else {
        // Fallback: try the homepage hero's chat input (HomepageHero.tsx
        // renders id="hero-chat-input" class="chat-input" and
        // class="chat-send-btn" — this used to look for a class named
        // "hero-chat-input"/"hero-chat-send", which never existed, so this
        // branch was silently dead on the homepage).
        const heroInput = document.querySelector("#hero-chat-input") as HTMLTextAreaElement
        const heroSendBtn = document.querySelector(".chat-send-btn") as HTMLButtonElement

        if (heroInput && heroSendBtn) {
          heroInput.value = question
          heroSendBtn.click()
        }
      }
    })
  })
})
