(function () {
  "use strict";

  // All state belongs to this one ChatGPT tab. A reload intentionally turns it off.
  const MESSAGE = "devam et";
  const SETTLE_MS = 3500;
  const TICK_MS = 700;
  const state = {
    active: false, phase: "stopped", detail: "Başlatılmadı.",
    count: 0, limit: 20, timer: null, token: 0,
    route: null, baseline: null, stopGoneAt: 0,
    textChangedAt: 0, lastText: ""
  };

  function visible(element) {
    return Boolean(element && element.getClientRects().length);
  }

  function stopVisible() {
    const exact = document.querySelector('[data-testid="stop-button"]');
    if (visible(exact)) return true;
    return [...document.querySelectorAll("button[aria-label]")].some(button =>
      visible(button) && /^(stop|durdur)(?:\\b|\\s|$)/i.test(button.getAttribute("aria-label") || "")
    );
  }

  function assistantSnapshot() {
    const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const last = messages[messages.length - 1];
    return { count: messages.length, text: (last?.innerText || last?.textContent || "").trim() };
  }

  function lastTurnIsAssistant() {
    const turns = document.querySelectorAll("[data-message-author-role]");
    return turns.length > 0 &&
      turns[turns.length - 1].getAttribute("data-message-author-role") === "assistant";
  }

  function getPrompt() {
    const selectors = [
      '#prompt-textarea[contenteditable="true"]',
      '[data-testid="composer-input"] [contenteditable="true"]',
      'textarea#prompt-textarea',
      'textarea[data-testid="composer-input"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (visible(element)) return element;
    }
    return null;
  }

  function promptText(prompt) {
    return (prompt instanceof HTMLTextAreaElement ? prompt.value : prompt.innerText || prompt.textContent || "").trim();
  }

  function getSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Gönder"]',
      'button[aria-label="Mesajı gönder"]'
    ];
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true") return button;
    }
    return null;
  }

  function route() {
    return location.pathname.match(/^\\/c\\/[^/]+/)?.[0] || location.pathname;
  }

  function stop(detail) {
    state.active = false;
    state.phase = "stopped";
    state.detail = detail;
    state.token++;
    clearInterval(state.timer);
    state.timer = null;
  }

  function routeChanged() {
    const current = route();
    if (current === state.route) return false;
    // A new conversation naturally changes / into /c/<id>.
    if (state.route === "/" && current.startsWith("/c/")) {
      state.route = current;
      return false;
    }
    stop("Sohbet değişti; otomatik devam durduruldu.");
    return true;
  }

  function insertMessage(prompt) {
    prompt.focus();
    if (prompt instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(prompt, MESSAGE);
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // Chromium's editing command goes through contenteditable's native input path.
      // Direct innerHTML assignment is intentionally avoided (React/ProseMirror).
      if (!document.execCommand("insertText", false, MESSAGE)) return false;
    }
    return promptText(prompt) === MESSAGE;
  }

  function sendAfterInput(token, attempt = 0) {
    if (!state.active || state.token !== token || state.phase !== "composing" || routeChanged()) return;
    if (stopVisible()) {
      stop("Yanıt yeniden üretime geçti; gönderim iptal edildi.");
      return;
    }
    const prompt = getPrompt();
    if (!prompt || promptText(prompt) !== MESSAGE) {
      stop("Mesaj kutusu değişti; güvenlik için durduruldu.");
      return;
    }
    const send = getSendButton();
    if (!send) {
      if (attempt < 8) {
        setTimeout(() => sendAfterInput(token, attempt + 1), 200);
      } else {
        stop("Gönder düğmesi bulunamadı. Taslak gönderilmedi.");
      }
      return;
    }
    send.click();
    state.count++;
    if (state.count >= state.limit) {
      stop("Tekrar sınırına ulaşıldı (" + state.limit + ").");
    } else {
      state.phase = "waiting";
      state.detail = "Devam gönderildi; yeni yanıt bekleniyor.";
      state.baseline = null;
    }
  }

  function tick() {
    if (!state.active || routeChanged()) return;
    const isGenerating = stopVisible();
    const now = Date.now();

    if (state.phase === "waiting") {
      if (!isGenerating) return; // Never react to historical/completed answers.
      state.baseline = assistantSnapshot();
      state.phase = "generating";
      state.detail = "ChatGPT yanıt üretiyor.";
      return;
    }

    if (state.phase === "generating") {
      if (isGenerating) return;
      state.phase = "settling";
      state.stopGoneAt = now;
      state.textChangedAt = now;
      state.lastText = assistantSnapshot().text;
      state.detail = "Yanıtın tamamlanması doğrulanıyor.";
      return;
    }

    if (state.phase !== "settling") return;
    if (isGenerating) {
      state.phase = "generating";
      state.detail = "ChatGPT yanıt üretiyor.";
      return;
    }
    const snapshot = assistantSnapshot();
    if (snapshot.text !== state.lastText) {
      state.lastText = snapshot.text;
      state.textChangedAt = now;
      return;
    }
    if (now - state.stopGoneAt < SETTLE_MS || now - state.textChangedAt < SETTLE_MS) return;
    if (!lastTurnIsAssistant() || !snapshot.text ||
        (snapshot.count <= state.baseline.count && snapshot.text === state.baseline.text)) {
      stop("Yeni bir asistan yanıtı doğrulanamadı.");
      return;
    }
    const prompt = getPrompt();
    if (!prompt) {
      stop("Mesaj kutusu bulunamadı; gönderim yapılmadı.");
      return;
    }
    if (promptText(prompt)) {
      stop("Mesaj kutusunda kendi taslağın var; üzerine yazılmadı.");
      return;
    }
    if (state.count >= state.limit) {
      stop("Tekrar sınırına ulaşıldı.");
      return;
    }
    // Mark this response consumed before any async work; prevents duplicate sends.
    state.phase = "composing";
    state.detail = "Devam mesajı hazırlanıyor.";
    if (!insertMessage(prompt)) {
      stop("Mesaj kutusuna güvenilir biçimde yazılamadı.");
      return;
    }
    const token = state.token;
    setTimeout(() => sendAfterInput(token), 250);
  }

  function status() {
    return { active: state.active, phase: state.phase, detail: state.detail,
      count: state.count, limit: state.limit };
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === "DEVAM_STATUS") {
      reply(status());
    } else if (message?.type === "DEVAM_STOP") {
      stop("Elle durduruldu.");
      reply(status());
    } else if (message?.type === "DEVAM_START") {
      const limit = Number(message.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        reply({ error: "Tekrar sınırı 1–100 arasında olmalı." });
        return;
      }
      if (state.active) stop("Yeniden başlatılıyor.");
      state.active = true;
      state.phase = "waiting";
      state.detail = "Bir sonraki yanıtın başlaması bekleniyor.";
      state.count = 0;
      state.limit = limit;
      state.route = route();
      state.baseline = null;
      // A user may start the extension during a generation already in progress.
      if (stopVisible()) {
        state.baseline = assistantSnapshot();
        state.phase = "generating";
        state.detail = "ChatGPT yanıt üretiyor.";
      }
      state.timer = setInterval(tick, TICK_MS);
      reply(status());
    }
  });
})();
