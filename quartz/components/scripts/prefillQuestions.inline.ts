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
        // Fallback: try the hero input
        const heroInput = document.querySelector(".hero-chat-input") as HTMLInputElement
        const heroSendBtn = document.querySelector(".hero-chat-send") as HTMLButtonElement

        if (heroInput && heroSendBtn) {
          heroInput.value = question
          heroSendBtn.click()
        }
      }
    })
  })
})
