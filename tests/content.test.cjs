"use strict";

// Run locally with: node tests/content.test.cjs
// This mock tests the state machine, not ChatGPT's live DOM or Chrome rendering.
function runSuite(content) {
  new Function(content);
  const results = [];

  function tab(options = {}) {
    let now = 0, messageListener, interval, queued = [], generating = false;
    let pathname = "/c/example";
    const sent = [];
    const composer = {
      contains(button) { return button === send; },
      querySelectorAll(selector) {
        if (selector === 'button[type="submit"]' && options.buttonType === "submit") return [send];
        if (selector === "button") return options.missingSend ? [] : [send];
        return [];
      }
    };
    const prompt = {
      innerText: "", focus() {}, getClientRects() { return [1]; },
      closest(selector) { return selector === "form" ? composer : null; }
    };
    const stop = { getClientRects() { return generating ? [1] : []; } };
    let finalActions = true;
    const copy = {
      disabled: false,
      getClientRects() { return [1]; },
      getAttribute(name) { return name === "aria-label" ? "Copy" : null; }
    };
    function assistant(text) {
      return {
        innerText: text,
        getAttribute() { return "assistant"; },
        closest() { return this; },
        querySelectorAll(selector) {
          return selector === "button" && finalActions ? [copy] : [];
        }
      };
    }
    const turns = [assistant("Eski yanıt")];
    const send = {
      disabled: false, getClientRects() { return [1]; },
      closest() { return null; },
      getAttribute(name) {
        if (name === "data-testid") return options.testId ?? "send-button";
        if (name === "type") return options.buttonType ?? "button";
        return null;
      },
      click() {
        if (options.noopClick) return;
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

        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-message-author-role="assistant"]') {
          return turns.filter(turn => turn.getAttribute() === "assistant");
        }
        if (selector === "[data-message-author-role]") return turns;
        if (options.missingSend) return [];
        const id = options.testId ?? "send-button";
        if (selector === 'button[data-testid="' + id + '"]') return [send];
        if (selector === 'button[data-testid$="-send-button"]' && id.endsWith("-send-button")) return [send];
        if (selector === 'button[data-testid$="-submit-button"]' && id.endsWith("-submit-button")) return [send];
        if (selector === "button[data-testid], button[type=\"submit\"]") return [send];
        return [];
      },
      execCommand(_command, _ui, value) {
        const rendered = options.extraParagraphBreaks
          ? value.replace(/\\n/g, "\\n\\n")
          : value;
        if (options.delayedEditor) queued.push(() => { prompt.innerText = rendered; });
        else prompt.innerText = rendered;
        return !options.falseInsertResult;
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
        for (let i = 0; queued.length && i < 100; i++) {
          const tasks = queued;
          queued = [];
          tasks.forEach(task => task());
        }
        if (queued.length) throw new Error("Test callback queue did not settle");
      },
      generating(value) { generating = value; },
      finalActions(value) { finalActions = value; },
      reply(value) {
        turns.push(assistant(value));
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
    t.advance(10000); t.advance(2100);
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
    t.advance(10000); t.advance(2100);
    t.flush();
    if (t.sent.length !== 2) return false;
    t.generating(true);
    t.advance(700);
    t.reply("Tamamlandı.\n[[DEVAM:TAMAM]]");
    t.generating(false);
    t.advance(700);
    t.advance(10000); t.advance(2100);
    return t.sent.length === 2 && !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Wait mode ignores historical replies", () => {
    t.message("DEVAM_START", { mode: "wait", limit: 3, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 0;
  });
  check("Wait mode bootstraps first unmarked reply", () => {
    t.generating(true);
    t.advance(700);
    t.reply("Yeni cevap");
    t.generating(false);
    t.advance(700);
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1;
  });

  t = tab();
  check("Does not overwrite a user's draft", () => {
    t.prompt.innerText = "benim taslağım";
    t.message("DEVAM_START", { mode: "now", limit: 3, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 0 &&
      t.prompt.innerText === "benim taslağım" &&
      !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Simple mode sends literal devam et and obeys limit", () => {
    t.message("DEVAM_START", { mode: "now", limit: 1, smart: false });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent[0] === "devam et" && !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Other tabs remain stopped", () => {
    const other = tab();
    t.message("DEVAM_START", { mode: "now", limit: 1, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1 &&
      other.sent.length === 0 &&
      !other.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Missing marker after protocol stops safely", () => {
    t.message("DEVAM_START", { mode: "now", limit: 3, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    t.generating(true);
    t.advance(700);
    t.reply("İşaret unutuldu");
    t.generating(false);
    t.advance(700);
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1 && !t.message("DEVAM_STATUS").active;
  });

  t = tab();
  check("Starting during generation waits for completion", () => {
    t.generating(true);
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.advance(10000); t.advance(2100);
    return t.sent.length === 0;
  });

  t = tab();
  check("Conversation navigation stops automatic replies", () => {
    t.message("DEVAM_START", { mode: "now", limit: 3, smart: true });
    t.navigate("/c/another");
    t.advance(700);
    return !t.message("DEVAM_STATUS").active;
  });

  t = tab({ testId: "composer-submit-button", buttonType: "submit" });
  check("New ChatGPT composer submit button sends", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: false });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1 && t.sent[0] === "devam et";
  });

  t = tab({ testId: "unlabelled-control", buttonType: "submit" });
  check("Unique composer submit fallback sends", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: false });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1;
  });

  t = tab({ missingSend: true });
  check("Unknown button leaves unsent draft with diagnostics", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.advance(10000); t.advance(2100);
    for (let i = 0; i < 10; i++) t.flush();
    return t.sent.length === 0 &&
      t.prompt.innerText.includes("Devam protokolü") &&
      !t.message("DEVAM_STATUS").active &&
      t.message("DEVAM_STATUS").detail.includes("Gönder düğmesi bulunamadı");
  });

  t = tab({ noopClick: true });
  check("Inert click preserves draft and does not increment count", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    const state = t.message("DEVAM_STATUS");
    return t.sent.length === 0 && state.count === 0 &&
      !state.active && state.detail.includes("mesaj kutusu boşalmadı") &&
      t.prompt.innerText.includes("Devam protokolü");
  });

  t = tab({ extraParagraphBreaks: true });
  check("Rich text with doubled paragraph breaks sends", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1 && t.sent[0].includes("Devam protokolü");
  });

  t = tab({ delayedEditor: true });
  check("Asynchronous composer input sends after update", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1;
  });

  t = tab({ falseInsertResult: true, extraParagraphBreaks: true });
  check("False insertText return does not reject inserted text", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.advance(10000); t.advance(2100);
    t.flush();
    return t.sent.length === 1;
  });

  t = tab();
  check("Thinking pause without final controls cannot send", () => {
    t.message("DEVAM_START", { mode: "wait", limit: 3, smart: true });
    t.generating(true);
    t.finalActions(false);
    t.advance(700);
    t.reply("Araçların çalışması devam ediyor");
    t.generating(false);
    t.advance(700);
    t.advance(20000);
    t.flush();
    return t.sent.length === 0 &&
      t.message("DEVAM_STATUS").active;
  });

  check("Sends only after final actions appear and settle again", () => {
    t.finalActions(true);
    t.advance(700);
    t.advance(2100);
    t.flush();
    return t.sent.length === 1;
  });

  t = tab();
  check("Stop button visible throughout prevents premature send", () => {
    t.message("DEVAM_START", { mode: "now", limit: 2, smart: true });
    t.generating(true);
    t.advance(22000);
    t.flush();
    return t.sent.length === 0;
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
