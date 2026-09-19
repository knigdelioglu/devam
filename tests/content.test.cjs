"use strict";

// Run locally with: node tests/content.test.cjs
// This mock tests the state machine, not ChatGPT's live DOM or Chrome rendering.
function runSuite(content) {
  new Function(content);
  const results = [];

  function tab() {
    let now = 0, messageListener, interval, queued = [], generating = false;
    let pathname = "/c/example";
    const sent = [];
    const prompt = { innerText: "", focus() {}, getClientRects() { return [1]; } };
    const stop = { getClientRects() { return generating ? [1] : []; } };
    const turns = [
      { innerText: "Eski yanıt", getAttribute() { return "assistant"; } }
    ];
    const send = {
      disabled: false, getClientRects() { return [1]; },
      getAttribute() { return null; },
      click() {
        sent.push(prompt.innerText);
        turns.push({
          innerText: prompt.innerText, getAttribute() { return "user"; }
        });
        prompt.innerText = "";
      }
    };
    const doc = {
      querySelector(selector) {
        if (selector === '[data-testid="stop-button"]') return stop;
        if (selector === '#prompt-textarea[contenteditable="true"]') return prompt;
        if (selector === 'button[data-testid="send-button"]') return send;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-message-author-role="assistant"]') {
          return turns.filter(turn => turn.getAttribute() === "assistant");
        }
        if (selector === "[data-message-author-role]") return turns;
        return [];
      },
      execCommand(_command, _ui, value) {
        prompt.innerText = value;
        return true;
      }
    };
    const location = { get pathname() { return pathname; } };
    const chrome = { runtime: { onMessage: {
      addListener(listener) { messageListener = listener; }
    } } };
    new Function(
      "chrome", "document", "location", "HTMLTextAreaElement",
      "Date", "setInterval", "clearInterval", "setTimeout", "Event", content
    )(
      chrome, doc, location, class {}, { now() { return now; } },
      callback => { interval = callback; return 1; },
      () => { interval = null; },
      callback => queued.push(callback),
      class {}
    );
    return {
      sent, prompt,
      message(type, extra = {}) {
        let response;
        messageListener({ type, ...extra }, null, value => { response = value; });
        return response;
      },
      advance(ms) { now += ms; interval?.(); },
      flush() {
        const tasks = queued;
        queued = [];
        tasks.forEach(task => task());
      },
      generating(value) { generating = value; },
      reply(value) {
        turns.push({ innerText: value, getAttribute() { return "assistant"; } });
      },
      navigate(path) { pathname = path; }
    };
  }

  function check(name, fn) {
    try {
      if (!fn()) throw new Error("Assertion failed");
      results.push({ name, pass: true });
    } catch (error) {
      results.push({ name, pass: false, error: String(error) });
    }
  }

  let t = tab();
  check("Rejects invalid start mode", () =>
    Boolean(t.message("DEVAM_START", { mode: "invalid", limit: 20 }).error));

  t = tab();
  check("Resumes an already completed reply", () => {
    t.message("DEVAM_START", { mode: "now", limit: 3, smart: true });
    t.advance(3600);
    t.flush();
    return t.sent.length === 1 &&
      t.sent[0].includes("[[DEVAM:SUR]]") &&
      t.message("DEVAM_STATUS").phase === "awaiting";
  });
  check("SUR continues and TAMAM stops smart mode", () => {
    t.generating(true);
    t.advance(700);
    t.reply("Daha iş var.\n[[DEVAM:SUR]]");
    t.generating(false);
    t.advance(700);
    t.advance(3600);
    t.flush();
    if (t.sent.length !== 2) return false;
    t.generating(true);
    t.advance(700);
    t.reply("Tamamlandı.\n[[DEVAM:TAMAM]]");
    t.generating(false);
    t.advance(700);
    t.advance(3600);
    return t.sent.length === 2 && !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Wait mode ignores historical replies", () => {
    t.message("DEVAM_START", { mode: "wait", limit: 3, smart: true });
    t.advance(3600);
    t.flush();
    return t.sent.length === 0;
  });
  check("Wait mode bootstraps first unmarked reply", () => {
    t.generating(true);
    t.advance(700);
    t.reply("Yeni cevap");
    t.generating(false);
    t.advance(700);
    t.advance(3600);
    t.flush();
    return t.sent.length === 1;
  });

  t = tab();
  check("Does not overwrite a user's draft", () => {
    t.prompt.innerText = "benim taslağım";
    t.message("DEVAM_START", { mode: "now", limit: 3, smart: true });
    t.advance(3600);
    t.flush();
    return t.sent.length === 0 &&
      t.prompt.innerText === "benim taslağım" &&
      !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Simple mode sends literal devam et and obeys limit", () => {
    t.message("DEVAM_START", { mode: "now", limit: 1, smart: false });
    t.advance(3600);
    t.flush();
    return t.sent[0] === "devam et" && !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Other tabs remain stopped", () => {
    const other = tab();
    t.message("DEVAM_START", { mode: "now", limit: 1, smart: true });
    t.advance(3600);
    t.flush();
    return t.sent.length === 1 &&
      other.sent.length === 0 &&
      !other.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Missing marker after protocol stops safely", () => {
    t.message("DEVAM_START", { mode: "now", limit: 3, smart: true });
    t.advance(3600);
    t.flush();
    t.generating(true);
    t.advance(700);
    t.reply("İşaret unutuldu");
    t.generating(false);
    t.advance(700);
    t.advance(3600);
    t.flush();
    return t.sent.length === 1 && !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Starting during generation waits for completion", () => {
    t.generating(true);
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.advance(3600);
    return t.sent.length === 0;
  });

  t = tab();
  check("Conversation navigation stops automatic replies", () => {
    t.message("DEVAM_START", { mode: "now", limit: 3, smart: true });
    t.navigate("/c/another");
    t.advance(700);
    return !t.message("DEVAM_STATUS").active;
  });

  return results;
}

if (typeof require === "function" && require.main === module) {
  const fs = require("node:fs");
  const path = require("node:path");
  const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const results = runSuite(content);
  for (const result of results) {
    console.log((result.pass ? "PASS " : "FAIL ") + result.name +
      (result.error ? " — " + result.error : ""));
  }
  if (results.some(result => !result.pass)) process.exitCode = 1;
}

if (typeof module !== "undefined") module.exports = { runSuite };
