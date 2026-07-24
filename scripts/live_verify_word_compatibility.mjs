import assert from "node:assert/strict";

const port = Number(process.argv[2] || 9231);
const timeoutMs = Number(process.env.OPENDESK_LIVE_TIMEOUT_MS || 30000);
const pluginGuid = "asc.{5CBF7C74-7021-4E8C-93F3-5A6C20260722}";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const target = targets.find(
      (item) => item.type === "page" && /doctype=word/.test(item.url || ""),
    );
    if (target?.webSocketDebuggerUrl) return target;
    await delay(250);
  }
  throw new Error("找不到 ONLYOFFICE Word 遠端除錯頁面");
}

function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        async call(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((callResolve, callReject) => {
            pending.set(id, { resolve: callResolve, reject: callReject });
          });
        },
        on(method, listener) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(listener);
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}

async function main() {
  const target = await waitForTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  const contexts = new Map();
  cdp.on("Runtime.executionContextCreated", ({ context }) => {
    if (context?.auxData?.isDefault) contexts.set(context.id, context);
  });
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
    contexts.delete(executionContextId);
  });
  cdp.on("Runtime.executionContextsCleared", () => contexts.clear());

  const evaluate = async (expression, contextId) => {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      contextId,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "頁面執行失敗");
    }
    return result.result?.value;
  };

  try {
    await cdp.call("Runtime.enable");
    await cdp.call("Page.enable");
    const deadline = Date.now() + timeoutMs;
    let pluginContextId;
    let editorContextId;
    let editorStatus;
    while (Date.now() < deadline && (!pluginContextId || !editorContextId)) {
      for (const [contextId] of contexts) {
        let status;
        try {
          status = await evaluate(`({
            href: location.href,
            title: document.title,
            language: new URL(location.href).searchParams.get("lang"),
            guid: window.Asc?.plugin?.guid || "",
            shortcutInstalled: Boolean(window.__OpenDeskTwWordShortcuts?.handler),
            text: document.body?.innerText || ""
          })`, contextId);
        } catch (_) {
          continue;
        }
        if (status.guid === pluginGuid) pluginContextId = contextId;
        if (status.shortcutInstalled) {
          editorContextId = contextId;
          editorStatus = status;
        }
      }
      if (!pluginContextId || !editorContextId) await delay(250);
    }
    assert.ok(pluginContextId, "找不到繁中工具的執行環境");
    assert.ok(editorContextId, "Word 相容快捷鍵監聽器未安裝");
    assert.equal(new URL(target.url).searchParams.get("lang"), "zh-TW");

    const homeMagiInDom = await evaluate(
      `document.body?.innerHTML?.includes("opendesk-home-magi-summary") || false`,
      editorContextId,
    );
    const visibleActions = {
      distributed: editorStatus.text.includes("分散對齊"),
      pairs: editorStatus.text.includes("智慧補齊"),
      fonts: editorStatus.text.includes("台灣字型"),
      renumber: editorStatus.text.includes("標題重編"),
      magi: /MAGI\s*摘要/.test(editorStatus.text) || homeMagiInDom,
      simplifiedAi:
        editorStatus.text.includes("聊天机器人") || editorStatus.text.includes("翻译"),
    };
    assert.deepEqual(visibleActions, {
      distributed: true,
      pairs: true,
      fonts: true,
      renumber: true,
      magi: true,
      simplifiedAi: false,
    });

    const readCurrentParagraph = () =>
      evaluate(`new Promise((resolve) => {
        Asc.plugin.callCommand(function () {
          const document = Api.GetDocument();
          const paragraph = document.GetCurrentParagraph();
          return {
            line: paragraph?.GetSpacingLineValue?.(),
            lineRule: paragraph?.GetSpacingLineRule?.(),
            style: paragraph?.GetStyle?.()?.GetName?.() || "",
            tracked: document.IsTrackRevisions()
          };
        }, false, false, resolve);
      })`, pluginContextId);

    const readParagraphs = () =>
      evaluate(`new Promise((resolve) => {
        Asc.plugin.callCommand(function () {
          return Api.GetDocument().GetAllParagraphs().map(function (paragraph) {
            return paragraph.GetText();
          });
        }, false, false, resolve);
      })`, pluginContextId);

    const press = async ({ key, code, virtualKeyCode, modifiers }) => {
      await evaluate(
        `new Promise((resolve) => Asc.plugin.executeMethod("FocusEditor", [], resolve))`,
        pluginContextId,
      );
      await evaluate(
        `document.dispatchEvent(new KeyboardEvent("keydown", {
          key: ${JSON.stringify(key)},
          code: ${JSON.stringify(code)},
          ctrlKey: ${Boolean(modifiers & 2)},
          metaKey: ${Boolean(modifiers & 4)},
          altKey: ${Boolean(modifiers & 1)},
          shiftKey: ${Boolean(modifiers & 8)},
          bubbles: true,
          cancelable: true
        }))`,
        editorContextId,
      );
      await delay(350);
    };

    await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = document.GetCurrentParagraph();
        const normal = document.GetStyle("Normal");
        if (normal) paragraph.SetStyle(normal);
        paragraph.SetSpacingLine(240, "auto");
        document.SetTrackRevisions(false);
        return true;
      }, false, true, resolve);
    })`, pluginContextId);
    const before = await readCurrentParagraph();
    assert.equal(before.line, 240);
    assert.equal(before.lineRule, "auto");
    await press({ key: "5", code: "Digit5", virtualKeyCode: 53, modifiers: 4 });
    const afterLineSpacing = await readCurrentParagraph();
    assert.equal(afterLineSpacing.line, 360);
    assert.equal(afterLineSpacing.lineRule, "auto");

    const distributedBefore = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = Api.CreateParagraph();
        paragraph.AddText("分散對齊實際寬度LIVE");
        document.Push(paragraph);
        const range = paragraph.GetRange(0, paragraph.GetText().length);
        range.Select();
        paragraph.SetSpacing(0);
        paragraph.SetJc("left");
        document.ForceRecalculate();
        const layout = paragraph.Paragraph.Lines[0].Ranges[0];
        return {
          text: paragraph.GetText(),
          width: layout.XEnd - layout.X,
          occupied: layout.W
        };
      }, false, true, resolve);
    })`, pluginContextId);
    assert.ok(
      distributedBefore.width - distributedBefore.occupied > 1,
      "分散對齊測試文字原本就已填滿行寬，無法驗證",
    );
    await press({ key: "j", code: "KeyJ", virtualKeyCode: 74, modifiers: 12 });
    const distributedAfter = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraph = Api.GetDocument().GetAllParagraphs().find(function (item) {
          return item.GetText().includes("分散對齊實際寬度LIVE");
        });
        const layout = paragraph.Paragraph.Lines[0].Ranges[0];
        const firstCharacter = paragraph.GetRange(0, 1);
        return {
          width: layout.XEnd - layout.X,
          occupied: layout.W,
          spacing: firstCharacter.GetTextPr().GetSpacing(),
          alignment: paragraph.GetParaPr().GetJc()
        };
      }, false, false, resolve);
    })`, pluginContextId);
    assert.ok(distributedAfter.spacing > 0, "分散對齊沒有寫入逐字平均字距");
    assert.ok(
      Math.abs(distributedAfter.width - distributedAfter.occupied) < 0.8,
      `分散後文字未填滿行寬：${JSON.stringify(distributedAfter)}`,
    );
    assert.equal(distributedAfter.alignment, "left");

    const fontFixture = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = Api.CreateParagraph();
        paragraph.AddText("新細明體LIVE");
        document.Push(paragraph);
        paragraph.GetRange(0, paragraph.GetText().length).Select();
        return true;
      }, false, true, resolve);
    })`, pluginContextId);
    assert.equal(fontFixture, true);
    await evaluate(
      `window.__OpenDeskTwWordShortcuts.applyTraditionalFont("PMingLiU")`,
      editorContextId,
    );
    await delay(500);
    const pmingliu = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraph = Api.GetDocument().GetAllParagraphs().find(function (item) {
          return item.GetText().includes("新細明體LIVE");
        });
        const textPr = paragraph.GetRange(0, paragraph.GetText().length).GetTextPr();
        return {
          ascii: textPr.GetFontFamily("ascii"),
          eastAsia: textPr.GetFontFamily("eastAsia")
        };
      }, false, false, resolve);
    })`, pluginContextId);
    assert.equal(pmingliu.ascii, "PMingLiU");
    assert.equal(pmingliu.eastAsia, "PMingLiU");

    await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = Api.CreateParagraph();
        paragraph.AddText("他說「外層『內層。");
        document.Push(paragraph);
        document.MoveCursorToEnd();
        return true;
      }, false, true, resolve);
    })`, pluginContextId);
    await press({ key: '"', code: "Quote", virtualKeyCode: 222, modifiers: 8 });
    let smartQuoteText = (await readParagraphs()).at(-1);
    assert.equal(smartQuoteText, "他說「外層『內層。』");
    await press({ key: '"', code: "Quote", virtualKeyCode: 222, modifiers: 8 });
    smartQuoteText = (await readParagraphs()).at(-1);
    assert.equal(smartQuoteText, "他說「外層『內層。』」");

    await press({ key: "1", code: "Digit1", virtualKeyCode: 49, modifiers: 5 });
    const afterHeading = await readCurrentParagraph();
    assert.match(afterHeading.style, /Heading 1|標題 1/i);

    const formatFixture = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const source = Api.CreateParagraph();
        source.AddText("格式來源LIVE");
        document.Push(source);
        const target = Api.CreateParagraph();
        target.AddText("格式目標LIVE");
        document.Push(target);
        const sourceRange = source.GetRange(0, source.GetText().length);
        sourceRange.SetBold(true);
        sourceRange.Select();
        return true;
      }, false, true, resolve);
    })`, pluginContextId);
    assert.equal(formatFixture, true);
    await press({ key: "c", code: "KeyC", virtualKeyCode: 67, modifiers: 5 });
    await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraphs = Api.GetDocument().GetAllParagraphs();
        const target = paragraphs.find(function (paragraph) {
          return paragraph.GetText().includes("格式目標LIVE");
        });
        target.GetRange(0, target.GetText().length).Select();
        return true;
      }, false, false, resolve);
    })`, pluginContextId);
    await press({ key: "v", code: "KeyV", virtualKeyCode: 86, modifiers: 5 });
    const formatCopyPaste = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraphs = Api.GetDocument().GetAllParagraphs();
        const target = paragraphs.find(function (paragraph) {
          return paragraph.GetText().includes("格式目標LIVE");
        });
        const range = target.GetRange(0, target.GetText().length);
        return { bold: range.GetTextPr().GetBold(), text: range.GetText() };
      }, false, false, resolve);
    })`, pluginContextId);
    assert.equal(formatCopyPaste.bold, true, "⌘⌥C／⌘⌥V 未把粗體格式套到目標文字");

    const seededHeading = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraphs = document.GetAllParagraphs();
        for (let index = 0; index < paragraphs.length; index += 1) {
          const text = paragraphs[index].GetText();
          const match = text.match(/^\\s*([壹貳參肆伍陸柒捌玖拾佰]+)、/);
          if (!match) continue;
          const start = match[0].indexOf(match[1]);
          const range = paragraphs[index].GetRange(start, start + match[1].length);
          if (!range) continue;
          range.Delete();
          const insertion = paragraphs[index].GetRange(start, start);
          if (!insertion || !insertion.AddText("玖", "before")) continue;
          return { index: index, original: text, seeded: paragraphs[index].GetText() };
        }
        const paragraph = Api.CreateParagraph();
        paragraph.AddText("玖、LIVE 標題重編驗證");
        document.Push(paragraph);
        const updated = document.GetAllParagraphs();
        const addedIndex = updated.findIndex(function (item) {
          return item.GetText().includes("玖、LIVE 標題重編驗證");
        });
        return {
          index: addedIndex,
          original: "",
          seeded: addedIndex >= 0 ? updated[addedIndex].GetText() : ""
        };
      }, false, true, resolve);
    })`, pluginContextId);
    assert.ok(seededHeading, "LIVE 文件找不到可測試的「壹、」層級標題");
    assert.match(seededHeading.seeded, /^\s*玖、/);
    const headingsBefore = await readParagraphs();
    await press({ key: "r", code: "KeyR", virtualKeyCode: 82, modifiers: 13 });
    const headingsAfter = await readParagraphs();
    const changed = headingsAfter.filter((value, index) => value !== headingsBefore[index]).length;
    assert.ok(changed > 0, "標題重編快捷鍵沒有改動任何段落");
    for (let index = 0; index < headingsBefore.length; index += 1) {
      if (/本文.*壹、一、（一）/.test(headingsBefore[index])) {
        assert.equal(headingsAfter[index], headingsBefore[index], "內文中的標題範例不應被改動");
      }
    }
    assert.notEqual(
      headingsAfter[seededHeading.index],
      headingsBefore[seededHeading.index],
      "故意改錯的「玖、」標題應被重新編回正確序號",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          title: target.title,
          language: "zh-TW",
          toolbar: visibleActions,
          lineSpacing: { before, after: afterLineSpacing },
          distributedAlignment: { before: distributedBefore, after: distributedAfter },
          traditionalFont: pmingliu,
          smartQuotes: smartQuoteText,
          headingStyle: afterHeading.style,
          formatCopyPaste,
          renumberedParagraphs: changed,
        },
        null,
        2,
      ),
    );
  } finally {
    cdp.close();
  }
}

await main();
