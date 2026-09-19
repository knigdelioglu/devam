(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const start = $("start");
  const wait = $("wait");
  const stop = $("stop");
  const limit = $("limit");
  const smart = $("smart");
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
    wait.disabled = true;
    stop.disabled = true;
    limit.disabled = true;
    smart.disabled = true;
  }

  function render(status) {
    if (status.error) {
      detail.textContent = status.error;
      return;
    }
    if (!initialized) {
      limit.value = status.limit;
      smart.checked = status.smart;
      initialized = true;
    }
    const labels = {
      stopped: "Kapalı",
      waiting: "Etkin · bekliyor",
      awaiting: "Yeni yanıt bekleniyor",
      generating: "Yanıt üretiliyor",
      settling: "Yanıt kontrol ediliyor",
      composing: "Devam hazırlanıyor",
      submitting: "Gönderim doğrulanıyor"
    };
    stateLabel.textContent = labels[status.phase] || "Etkin";
    detail.textContent = status.detail;
    count.textContent = "Gönderilen: " + status.count + " / " + status.limit;
    indicator.classList.toggle("active", status.active);
    start.disabled = busy || status.active;
    wait.disabled = busy || status.active;
    stop.disabled = busy || !status.active;
    limit.disabled = busy || status.active;
    smart.disabled = busy || status.active;
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
      unavailable("Eklentiyi güncelledikten sonra ChatGPT sekmesini yenile.");
    }
  }

  async function action(type, extra = {}) {
    busy = true;
    start.disabled = true;
    wait.disabled = true;
    stop.disabled = true;
    try {
      render(await message(type, extra));
    } catch {
      unavailable("ChatGPT sekmesiyle bağlantı kurulamadı. Sekmeyi yenile.");
    } finally {
      busy = false;
      await refresh();
    }
  }

  function begin(mode) {
    const value = Number(limit.value);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      detail.textContent = "Tekrar sınırı 1 ile 100 arasında tam sayı olmalı.";
      return;
    }
    action("DEVAM_START", { mode, limit: value, smart: smart.checked });
  }

  start.addEventListener("click", () => begin("now"));
  wait.addEventListener("click", () => begin("wait"));
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
