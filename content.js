(function () {
  "use strict";

  // This instance is local to one ChatGPT tab. Reloading intentionally disables it.
  const SIMPLE_MESSAGE = "devam et";
  const SMART_MESSAGE = [
    "devam et.",
    "",
    "Devam protokolü: Önceki görevin henüz tamamlanmadıysa kaldığın yerden ilerle.",
    "Her cevabının en son satırına, yapılacak iş kaldıysa [[DEVAM:SUR]],",
    "bütün iş tamamlandıysa [[DEVAM:TAMAM]] yaz.",
    "Yalnızca bu iki işaretten birini kullan. Tamamladığın işleri gereksiz yere tekrarlama."
  ].join("\n");
  // Tool calls can pause for several seconds between visible updates.
  const SETTLE_MS = 9000;
  const TICK_MS = 700;
  const state = {
    active: false, phase: "stopped", detail: "Başlatılmadı.",
    count: 0, limit: 20, smart: true, timer: null, token: 0,
    route: null, baseline: null, firstReply: true,
    stopGoneAt: 0, textChangedAt: 0, lastText: "",
    pendingMessage: null, sentAt: 0
  };

  function visible(element) {
    return Boolean(element && element.getClientRects().length);
  }

  function stopVisible() {
    const exact = document.querySelector('[data-testid="stop-button"]');
    if (visible(exact)) return true;
    return [...document.querySelectorAll("button[aria-label]")].some(button =>
      visible(button) && /^(stop|durdur)(?:\b|\s|$)/i.test(button.getAttribute("aria-label") || "")
    ) || hasStopIcon();
  }

  function hasStopIcon() {
    // Some ChatGPT layouts draw the blue square stop button with an unlabeled
    // SVG. Inspect only buttons within this tab's composer, not page-wide SVGs.
    const composer = getPrompt()?.closest?.("form");
    if (!composer) return false;
    return [...composer.querySelectorAll("button")].some(button => {
      if (!visible(button) || button.disabled) return false;
      const rect = button.querySelector?.("svg rect");
      return Boolean(rect &&
        Number(rect.getAttribute("width")) >= 3 &&
        Number(rect.getAttribute("height")) >= 3);
    });
  }

  function finalResponseVisible() {
    // The last assistant turn's final action bar is a stronger completion
    // signal than an absent stop button or text becoming momentarily quiet.
    // Never accept a copy button from a PREVIOUS completed assistant turn.
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    const last = messages[messages.length - 1];
    if (!last) return false;
    const turn = last.closest?.('[data-testid^="conversation-turn"]') || last;
    const buttons = [...turn.querySelectorAll("button")];
    return buttons.some(button => {
      if (!visible(button) || button.disabled) return false;
      const label = [
        button.getAttribute("aria-label") || "",
        button.getAttribute("data-testid") || "",
        button.getAttribute("title") || ""
      ].join(" ").toLowerCase();
      return /copy(?:[- ](?:turn|response|message|button|action))?|kopyala/.test(label);
    });
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
    return (prompt instanceof HTMLTextAreaElement
      ? prompt.value
      : prompt.innerText || prompt.textContent || "").trim();
  }

  // Contenteditable editors can render paragraph boundaries as two newlines
  // (or NBSPs) even when the typed message contains only one. Preserve the
  // original text for sending, but compare normalized visible characters.
  function comparableText(text) {
    return (text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function matchesMessage(prompt, message) {
    return comparableText(promptText(prompt)) === comparableText(message);
  }

  function getSendButton(prompt) {
    // Limit fallback discovery to the composer, not other dialogs or the page.
    const composer = prompt.closest?.("form") ||
      prompt.closest?.('[data-testid="composer"]');
    const selectors = [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      'button[data-testid="composer-send-button"]',
      'button[data-testid="submit-button"]',
      'button[data-testid$="-send-button"]',
      'button[data-testid$="-submit-button"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Gönder"]',
      'button[aria-label="Mesajı gönder"]',
      'button[title="Send"]',
      'button[title="Gönder"]'
    ];
    const eligible = button => visible(button) && !button.disabled &&
      button.getAttribute("aria-disabled") !== "true" &&
      !button.closest?.('[aria-hidden="true"]');

    // Use exact semantic identifiers first, checking every match rather than
    // accidentally returning the first hidden/disabled button.
    for (const selector of selectors) {
      const candidates = [...document.querySelectorAll(selector)].filter(eligible);
      if (candidates.length === 1) {
        if (!composer || composer.contains(candidates[0])) return candidates[0];
      }
    }

    // Recent ChatGPT composers sometimes expose a plain submit button without
    // a send-related test ID or label. Never use a generic page-wide button.
    if (composer) {
      const submits = [...composer.querySelectorAll('button[type="submit"]')]
        .filter(eligible);
      if (submits.length === 1) return submits[0];
    }
    return null;
  }

  function sendButtonDiagnostic(prompt) {
    const composer = prompt.closest?.("form") ||
      prompt.closest?.('[data-testid="composer"]');
    const candidates = composer
      ? [...composer.querySelectorAll("button")]
      : [...document.querySelectorAll('button[data-testid], button[type="submit"]')];
    return candidates.filter(visible).map(button =>
      [
        button.getAttribute("data-testid"),
        button.getAttribute("aria-label"),
        button.getAttribute("type")
      ].filter(Boolean).join("/")
    ).filter(Boolean).slice(-8).join(", ") || "tanımlayıcı yok";
  }

  function route() {
    return location.pathname.match(/^\/c\/[^/]+/)?.[0] || location.pathname;
  }

  function stop(detail) {
    state.active = false;
    state.phase = "stopped";
    state.detail = detail;
    state.token++;
    state.pendingMessage = null;
    clearInterval(state.timer);
    state.timer = null;
  }

  function routeChanged() {
    const current = route();
    if (current === state.route) return false;
    // A newly opened conversation can naturally change / into /c/<id>.
    if (state.route === "/" && current.startsWith("/c/")) {
      state.route = current;
      return false;
    }
    stop("Sohbet değişti; otomatik devam durduruldu.");
    return true;
  }

  function insertMessage(prompt, message) {
    prompt.focus();
    if (prompt instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) return false;
      setter.call(prompt, message);
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // ChatGPT's rich-text composer can normalize newlines asynchronously.
      // A false execCommand result alone is not evidence that the text was
      // not inserted. Verify the editor separately before any send attempt.
      const inserted = document.execCommand("insertText", false, message);
      if (!inserted && !matchesMessage(prompt, message)) {
        return false;
      }
    }
    return true;
  }

  function marker(text) {
    return text.match(/\[\[DEVAM:(SUR|TAMAM)\]\]\s*$/)?.[1] || null;
  }

  function confirmSend(token, attempt = 0) {
    if (!state.active || state.token !== token ||
        state.phase !== "submitting" || routeChanged()) return;
    const prompt = getPrompt();
    if (!prompt) {
      stop("Gönderim sonrası mesaj kutusu bulunamadı; sonuç doğrulanamadı.");
      return;
    }
    const current = promptText(prompt);
    // Composer clearing or ChatGPT switching into generation is evidence
    // that the click actually submitted the turn; a click alone is not.
    if (!current || stopVisible()) {
      state.count++;
      state.firstReply = false;
      state.pendingMessage = null;
      if (state.count >= state.limit) {
        stop("Tekrar sınırına ulaşıldı (" + state.limit + ").");
      } else {
        state.phase = "awaiting";
        state.detail = "Mesaj gönderildi; yeni yanıt bekleniyor.";
      }
      return;
    }
    if (comparableText(current) !== comparableText(state.pendingMessage)) {
      stop("Gönderim sırasında mesaj kutusu değişti; tekrar gönderilmedi.");
      return;
    }
    if (attempt >= 12) {
      stop("Gönder düğmesine basıldı ancak mesaj kutusu boşalmadı; taslak bırakıldı. Otomatik tekrar denenmedi.");
      return;
    }
    setTimeout(() => confirmSend(token, attempt + 1), 250);
  }

  function sendAfterInput(token, attempt = 0) {
    if (!state.active || state.token !== token || state.phase !== "composing" || routeChanged()) return;
    if (stopVisible() || !finalResponseVisible()) {
      stop("ChatGPT yanıtı henüz tamamlanmamış; gönderim iptal edildi.");
      return;
    }
    const prompt = getPrompt();
    if (!prompt) {
      stop("Mesaj kutusu bulunamadı; gönderim iptal edildi.");
      return;
    }
    if (!matchesMessage(prompt, state.pendingMessage)) {
      if (attempt < 8 && !promptText(prompt)) {
        setTimeout(() => sendAfterInput(token, attempt + 1), 200);
      } else {
        stop("Mesaj kutusundaki metin beklenen devam mesajıyla eşleşmedi; taslak korunarak durduruldu.");
      }
      return;
    }
    const send = getSendButton(prompt);
    if (!send) {
      if (attempt < 8) {
        setTimeout(() => sendAfterInput(token, attempt + 1), 200);
      } else {
        stop("Gönder düğmesi bulunamadı; mesaj kutusunda taslak bırakıldı. Düğmeler: " + sendButtonDiagnostic(prompt));
      }
      return;
    }
    state.baseline = assistantSnapshot();
    state.phase = "submitting";
    state.detail = "Gönder düğmesine basıldı; gönderim doğrulanıyor.";
    state.sentAt = Date.now();
    try {
      send.click();
    } catch {
      stop("Gönder düğmesine tıklanamadı; taslak bırakıldı.");
      return;
    }
    setTimeout(() => confirmSend(token), 250);
  }

  function sendContinuation() {
    if (!state.active || routeChanged() || state.phase === "composing" || stopVisible() || !finalResponseVisible()) return;
    if (state.count >= state.limit) {
      stop("Tekrar sınırına ulaşıldı.");
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
    const message = state.smart ? SMART_MESSAGE : SIMPLE_MESSAGE;
    state.pendingMessage = message;
    state.phase = "composing"; // Consumes this reply before any asynchronous work.
    state.detail = "Devam mesajı hazırlanıyor.";
    if (!insertMessage(prompt, message)) {
      stop("Editör metin ekleme komutunu kabul etmedi; taslak korunarak durduruldu.");
      return;
    }
    const token = state.token;
    setTimeout(() => sendAfterInput(token), 250);
  }

  function onCompletedResponse(snapshot) {
    const decision = marker(snapshot.text);
    if (state.smart) {
      if (decision === "TAMAM") {
        stop("ChatGPT [[DEVAM:TAMAM]] ile işi bitirdiğini bildirdi.");
        return;
      }
      // A manually started conversation has not received our protocol yet.
      // Only this first reply is allowed to lack the marker.
      if (decision !== "SUR" && !state.firstReply) {
        stop("Devam işareti bulunamadı; kontrolsüz döngü önlendi.");
        return;
      }
    }
    sendContinuation();
  }

  function tick() {
    if (!state.active || routeChanged()) return;
    const generating = stopVisible();
    const now = Date.now();

    if (state.phase === "waiting" || state.phase === "awaiting") {
      const snapshot = assistantSnapshot();
      const changed = state.phase === "awaiting" &&
        state.baseline &&
        (snapshot.count > state.baseline.count ||
         (snapshot.count === state.baseline.count && snapshot.text !== state.baseline.text));
      if (!generating && !changed) {
        // Detect a send button that did not actually dispatch a user turn.
        if (state.phase === "awaiting" && now - state.sentAt > 60000) {
          stop("Yeni yanıt başlamadı; devam gönderimi doğrulanamadı.");
        }
        return;
      }
      const wasWaiting = state.phase === "waiting";
      state.phase = generating ? "generating" : "settling";
      state.stopGoneAt = now;
      state.textChangedAt = now;
      state.lastText = snapshot.text;
      if (wasWaiting) state.baseline = snapshot;
      state.detail = generating ? "ChatGPT yanıt üretiyor." : "Yanıt kontrol ediliyor.";
      return;
    }

    if (state.phase === "generating") {
      if (generating) return;
      state.phase = "settling";
      state.stopGoneAt = now;
      state.textChangedAt = now;
      state.lastText = assistantSnapshot().text;
      state.detail = "Son yanıt ve araçların tamamlanması doğrulanıyor.";
      return;
    }

    if (state.phase !== "settling") return;
    if (generating) {
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
    if (!finalResponseVisible()) {
      state.detail = "Düşünme/araç aşaması veya son yanıt devam ediyor; bitiş araçları bekleniyor.";
      return;
    }
    if (!lastTurnIsAssistant() || !snapshot.text ||
        (state.baseline && snapshot.count <= state.baseline.count &&
         snapshot.text === state.baseline.text)) {
      stop("Yeni bir asistan yanıtı doğrulanamadı.");
      return;
    }
    onCompletedResponse(snapshot);
  }

  function status() {
    return {
      active: state.active, phase: state.phase, detail: state.detail,
      count: state.count, limit: state.limit, smart: state.smart
    };
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
      const mode = message.mode === "now" ? "now" : message.mode === "wait" ? "wait" : null;
      if (!mode) {
        reply({ error: "Başlatma modu geçersiz." });
        return;
      }
      // Do not replace an active run or its in-flight send with a second one.
      if (state.active) {
        reply({ error: "Bu sekmede zaten aktif. Önce Durdur'a bas." });
        return;
      }
      const generating = stopVisible();
      const snapshot = assistantSnapshot();
      if (mode === "now" && !generating && (!lastTurnIsAssistant() || !snapshot.text)) {
        reply({ error: "Devam ettirilecek tamamlanmış bir asistan yanıtı bulunamadı." });
        return;
      }
      state.active = true;
      state.phase = "waiting";
      state.detail = "Bir sonraki yanıt bekleniyor.";
      state.count = 0;
      state.limit = limit;
      state.smart = message.smart !== false;
      state.route = route();
      state.baseline = snapshot;
      state.firstReply = true;
      state.pendingMessage = null;
      state.token++;
      if (generating) {
        state.phase = "generating";
        state.detail = "Mevcut ChatGPT yanıtının bitmesi bekleniyor.";
      }
      state.timer = setInterval(tick, TICK_MS);
      if (mode === "now" && !generating) {
        state.phase = "settling";
        state.stopGoneAt = Date.now();
        state.textChangedAt = Date.now();
        state.lastText = snapshot.text;
        // Already completed response: do not require a newer assistant message.
        state.baseline = null;
        state.detail = "Tamamlanmış yanıt kontrol ediliyor.";
      }
      reply(status());
    }
  });
})();