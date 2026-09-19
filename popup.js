(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const start = $("start");
  const stop = $("stop");
  const limit = $("limit");
  const stateLabel = $("state");
  const detail = $("detail");
  const count = $("count");
  const indicator = $("indicator");
  let tabId = null;
  let busy = false;
  let initialized = false;

  function unavailable(message) {
    stateLabel.textContent = "Kullanılamıyor";
    detail.textContent = message;
    indicator.classList.remove("active");
    start.disabled = true;
    stop.disabled = true;
  }

  function render(status) {
    if (status.error) {
      detail.textContent = status.error;
      return;
    }
    if (!initialized) {
      limit.value = status.limit;
      initialized = true;
    }
    const labels = {
      stopped: "Kapalı",
      waiting: "Etkin · bekliyor",
      generating: "Yanıt üretiliyor",
      settling: "Yanıt kontrol ediliyor",
      composing: "Devam gönderiliyor"
    };
    stateLabel.textContent = labels[status.phase] || "Etkin";
    detail.textContent = status.detail;
    count.textContent = "Gönderilen: " + status.count + " / " + status.limit;
    indicator.classList.toggle("active", status.active);
    start.disabled = busy || status.active;
    stop.disabled = busy || !status.active;
    limit.disabled = busy || status.active;
  }

  async function message(type, extra = {}) {
    if (tabId === null) throw new Error("ChatGPT sekmesi bulunamadı.");
    return chrome.tabs.sendMessage(tabId, { type, ...extra });
  }

  async function refresh() {
    if (busy || tabId === null) return;
    try {
      render(await message("DEVAM_STATUS"));
    } catch {
      unavailable("Eklentiyi yükledikten sonra ChatGPT sekmesini yenile.");
    }
  }

  async function action(type, extra = {}) {
    busy = true;
    start.disabled = true;
    stop.disabled = true;
    try {
      const response = await message(type, extra);
      render(response);
    } catch {
      unavailable("ChatGPT sekmesiyle bağlantı kurulamadı. Sekmeyi yenile.");
    } finally {
      busy = false;
      await refresh();
    }
  }

  start.addEventListener("click", () => {
    const value = Number(limit.value);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      detail.textContent = "Tekrar sınırı 1 ile 100 arasında tam sayı olmalı.";
      return;
    }
    action("DEVAM_START", { limit: value });
  });
  stop.addEventListener("click", () => action("DEVAM_STOP"));

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || new URL(tab.url).hostname !== "chatgpt.com" ||
          new URL(tab.url).protocol !== "https:") {
        unavailable("Önce chatgpt.com üzerinde bir sohbet sekmesi aç.");
        return;
      }
      tabId = tab.id;
      await refresh();
      setInterval(refresh, 1000);
    } catch {
      unavailable("Aktif Chrome sekmesi okunamadı.");
    }
  })();
})();
