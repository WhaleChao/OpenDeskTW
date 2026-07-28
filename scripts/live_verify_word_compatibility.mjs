import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

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
  const screenshotDirectory = process.env.OPENDESK_LIVE_SCREENSHOT_DIR;
  const captureScreenshot = async (name) => {
    if (!screenshotDirectory) return undefined;
    await mkdir(screenshotDirectory, { recursive: true });
    const capture = await cdp.call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const path = `${screenshotDirectory}/${name}.png`;
    await writeFile(path, Buffer.from(capture.data, "base64"));
    return path;
  };
  const forceLocalSave = async (editorContextId) => {
    const started = await evaluate(
      `(() => {
        if (typeof window.DesktopOfflineAppDocumentStartSave !== "function") {
          return false;
        }
        window.DesktopOfflineAppDocumentStartSave(false);
        return true;
      })()`,
      editorContextId,
    );
    assert.equal(started, true, "ONLYOFFICE 沒有提供本機文件儲存入口");
    await delay(3000);
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
            fontActionInstalled:
              typeof window.__OpenDeskTwWordShortcuts?.applyTraditionalFont === "function",
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
      distributed: /文字等距分布|分散對齊/.test(editorStatus.text),
      pairs: editorStatus.text.includes("智慧補齊"),
      fonts: editorStatus.fontActionInstalled,
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

    // 同一份文件重開時，先驗證持久標記已把文件核心還原為 distribute=4。
    await delay(750);
    const restoredDistribution = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const customProperties = document.GetCustomProperties?.();
        const stored = customProperties?.Get?.("OpenDeskTW.DistributedParagraphs") || "";
        let markers = [];
        try {
          markers = stored ? JSON.parse(stored) : [];
        } catch (_error) {
          markers = [];
        }
        const markerIds = new Set(markers.map(function (marker) {
          return marker?.id;
        }).filter(Boolean));
        const matches = document.GetAllParagraphs().filter(function (paragraph) {
          return markerIds.has(paragraph.GetParaId?.());
        }).map(function (paragraph) {
          const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId?.());
          return {
            id: paragraph.GetParaId?.() || "",
            text: paragraph.GetText?.() || "",
            nativeAlignment: nativeParagraph?.fa?.ye
          };
        });
        return { markerCount: markers.length, matches };
      }, false, false, resolve);
    })`, pluginContextId);
    if (restoredDistribution.markerCount > 0) {
      assert.equal(
        restoredDistribution.matches.length,
        restoredDistribution.markerCount,
        `分散對齊持久標記沒有對應到全部段落：${JSON.stringify(restoredDistribution)}`,
      );
      assert.ok(
        restoredDistribution.matches.every((item) => item.nativeAlignment === 4),
        `文件重開後沒有還原 distribute=4：${JSON.stringify(restoredDistribution)}`,
      );
    }

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

    const distributedFixture = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = Api.CreateParagraph();
        paragraph.AddText("甲乙丙丁");
        document.Push(paragraph);
        const range = paragraph.GetRange(0, paragraph.GetText().length);
        range.Select();
        return { text: paragraph.GetText() };
      }, false, true, resolve);
    })`, pluginContextId);
    assert.equal(distributedFixture.text.trimEnd(), "甲乙丙丁");
    await evaluate(`window.Asc.editor.put_PrAlign(1)`, editorContextId);
    await delay(500);
    const distributedBefore = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        try {
          const document = Api.GetDocument();
          const paragraph = document.GetCurrentParagraph();
          document.ForceRecalculate?.();
          const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId?.());
          const layoutRange =
            (nativeParagraph?.Lines || nativeParagraph?.Xb)?.[0];
          const measuredRange =
            (layoutRange?.Ranges || layoutRange?.Of)?.[0];
          return {
            text: paragraph.GetText(),
            publicAlignment: paragraph.GetParaPr().GetJc(),
            layout: measuredRange ? {
              available:
                Number(measuredRange.XEnd ?? measuredRange.tB) -
                Number(measuredRange.X ?? measuredRange.ha),
              occupied: Number(measuredRange.W ?? measuredRange.Da)
            } : null
          };
        } catch (error) {
          return { error: String(error), stack: error?.stack || "" };
        }
      }, false, false, resolve);
    })`, pluginContextId);
    assert.ok(
      distributedBefore && !distributedBefore.error,
      `無法讀取文字等距分布 LIVE 版面：${JSON.stringify(distributedBefore)}`,
    );
    assert.notEqual(distributedBefore.publicAlignment, "distribute");
    const distributedBeforeScreenshot = await captureScreenshot(
      "distributed-alignment-before",
    );
    await evaluate(
      `window.__OpenDeskTwWordShortcuts.applyDistributedAlignment()`,
      editorContextId,
    );
    await delay(750);
    const distributedDiagnostic = await evaluate(
      `window.__OpenDeskTwDistributedLayout || null`,
      pluginContextId,
    );
    const distributedAfter = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraphs = document.GetAllParagraphs();
        const paragraph = paragraphs.slice().reverse().find(function (item) {
          return item.GetText().trim() === "甲乙丙丁";
        });
        const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId());
        document.ForceRecalculate?.();
        const layoutLine =
          (nativeParagraph?.Lines || nativeParagraph?.Xb)?.[0];
        const layoutRange =
          (layoutLine?.Ranges || layoutLine?.Of)?.[0];
        return {
          paraId: paragraph.GetParaId?.(),
          publicAlignment: paragraph.GetParaPr().GetJc(),
          nativeAlignment: nativeParagraph?.fa?.ye,
          layout: layoutRange ? {
            available:
              Number(layoutRange.XEnd ?? layoutRange.tB) -
              Number(layoutRange.X ?? layoutRange.ha),
            occupied: Number(layoutRange.W ?? layoutRange.Da)
          } : null
        };
      }, false, false, resolve);
    })`, pluginContextId);
    assert.equal(
      distributedAfter.nativeAlignment,
      4,
      `文字等距分布沒有套用文件核心的 distribute=4：${JSON.stringify({ distributedBefore, distributedAfter })}`,
    );
    assert.equal(
      distributedDiagnostic?.method,
      "word-paragraph-width",
      `沒有使用 Word 段落實際寬度演算法：${JSON.stringify(distributedDiagnostic)}`,
    );
    assert.ok(
      distributedDiagnostic?.appliedRanges >= 1 &&
        distributedDiagnostic?.spacings?.[0] > 0,
      `沒有產生依版面量測的動態字距：${JSON.stringify(distributedDiagnostic)}`,
    );
    assert.ok(
      distributedAfter.layout &&
        Math.abs(
          distributedAfter.layout.available - distributedAfter.layout.occupied,
        ) <= Math.max(1, distributedAfter.layout.available * 0.05),
      `文字沒有真正攤滿當下可用寬度：${JSON.stringify({ distributedBefore, distributedAfter, distributedDiagnostic })}`,
    );

    // 同一段改變右縮排後，必須依新的段落寬度重算，而不是重用固定字距。
    await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraphs = Api.GetDocument().GetAllParagraphs();
        const paragraph = paragraphs.slice().reverse().find(function (item) {
          return item.GetText().trim() === "甲乙丙丁";
        });
        paragraph.SetIndRight(1440);
        paragraph.GetRange(0, paragraph.GetText().length).Select();
        return true;
      }, false, true, resolve);
    })`, pluginContextId);
    await evaluate(
      `window.__OpenDeskTwWordShortcuts.applyDistributedAlignment()`,
      editorContextId,
    );
    await delay(750);
    const distributedAfterResize = await evaluate(
      `window.__OpenDeskTwDistributedLayout || null`,
      pluginContextId,
    );
    const distributedResizeLayout = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraph = Api.GetDocument().GetAllParagraphs().slice().reverse().find(function (item) {
          return item.GetText().trim() === "甲乙丙丁";
        });
        const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId());
        Api.GetDocument().ForceRecalculate?.();
        const line = (nativeParagraph?.Lines || nativeParagraph?.Xb)?.[0];
        const range = (line?.Ranges || line?.Of)?.[0];
        return range ? {
          available:
            Number(range.XEnd ?? range.tB) -
            Number(range.X ?? range.ha),
          occupied: Number(range.W ?? range.Da),
          lines: (nativeParagraph?.Lines || nativeParagraph?.Xb)?.length || 0
        } : null;
      }, false, false, resolve);
    })`, pluginContextId);
    assert.ok(
      distributedAfterResize?.spacings?.[0] > 0 &&
        distributedAfterResize.spacings[0] !==
          distributedDiagnostic.spacings[0],
      `段落寬度改變後仍使用固定字距：${JSON.stringify({ before: distributedDiagnostic, resized: distributedAfterResize })}`,
    );
    assert.ok(
      distributedAfterResize?.implementation === "word-layout-ranges-v2" &&
        distributedAfterResize.preclearedRuns >= 1,
      `沒有載入會先完成清除再量測的 1.9.3 實作：${JSON.stringify(distributedAfterResize)}`,
    );
    assert.ok(
      distributedAfterResize.widths?.[0]?.available <
        distributedDiagnostic.widths?.[0]?.available,
      `右縮排後沒有量測到較窄的實際可用寬度：${JSON.stringify({ before: distributedDiagnostic, resized: distributedAfterResize })}`,
    );
    assert.ok(
      distributedResizeLayout &&
        Math.abs(
          distributedResizeLayout.available -
            distributedResizeLayout.occupied,
        ) <= Math.max(1, distributedResizeLayout.available * 0.05),
      `縮排改變後文字沒有重新攤滿新寬度：${JSON.stringify({ layout: distributedResizeLayout, diagnostic: distributedAfterResize })}`,
    );
    const distributedAfterScreenshot = await captureScreenshot(
      "distributed-alignment-after",
    );
    await forceLocalSave(editorContextId);
    let distributedOoxml;

    const installedFonts = await evaluate(
      `new Promise((resolve) => Asc.plugin.executeMethod("GetFontList", [], resolve))`,
      pluginContextId,
    );
    const installedFontNames = (installedFonts || []).flatMap((font) =>
      typeof font === "string"
        ? [font]
        : [font?.name, font?.Name, font?.family, font?.Family, font?.m_wsFontName],
    );
    assert.ok(
      installedFontNames.includes("PMingLiU"),
      `ONLYOFFICE 字型清單仍找不到新細明體 PMingLiU：${JSON.stringify((installedFonts || []).slice(0, 12))}`,
    );
    assert.ok(
      installedFontNames.includes("MingLiU"),
      "ONLYOFFICE 字型清單仍找不到細明體 MingLiU",
    );

    const fontFixture = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = Api.CreateParagraph();
        paragraph.AddText("新細明體LIVE");
        document.Push(paragraph);
        paragraph.GetRange(0, "新細明體LIVE".length).Select();
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
        const paragraph = Api.GetDocument().GetCurrentParagraph();
        const textPr = paragraph.GetRange(0, "新細明體LIVE".length).GetTextPr();
        return {
          family: textPr.GetFontFamily(),
          eastAsia: textPr.GetFontFamily("eastAsia")
        };
      }, false, false, resolve);
    })`, pluginContextId);
    assert.equal(
      pmingliu.family,
      "PMingLiU",
      `新細明體沒有真正套用到選取文字：${JSON.stringify(pmingliu)}`,
    );
    assert.equal(
      pmingliu.eastAsia,
      "PMingLiU",
      `新細明體沒有套用到中文字型槽：${JSON.stringify(pmingliu)}`,
    );
    await forceLocalSave(editorContextId);
    const liveDocumentPath = process.env.OPENDESK_LIVE_DOCUMENT_PATH;
    if (liveDocumentPath && process.platform === "darwin") {
      await delay(3500);
      const documentXml = execFileSync(
        "/usr/bin/unzip",
        ["-p", liveDocumentPath, "word/document.xml"],
        { encoding: "utf8" },
      );
      const paraId =
        typeof distributedAfter.paraId === "number"
          ? distributedAfter.paraId.toString(16).padStart(8, "0").toUpperCase()
          : String(distributedAfter.paraId || "").padStart(8, "0").toUpperCase();
      const paragraph = documentXml.match(
        new RegExp(
          `<w:p[^>]*w14:paraId=["']${paraId}["'][^>]*>.*?</w:p>`,
          "s",
        ),
      )?.[0];
      assert.ok(paragraph, `DOCX 找不到分散對齊段落 ${paraId}`);
      assert.match(
        paragraph,
        /<w:jc\b[^>]*\bw:val=["']distribute["'][^>]*\/?>/,
        `DOCX 沒有寫入 Word 標準 distribute：${paragraph}`,
      );
      for (const spacing of distributedAfterResize.spacings || []) {
        if (process.env.OPENDESK_LIVE_LEGACY_BRIDGE !== "1") {
          assert.doesNotMatch(
            paragraph,
            new RegExp(`<w:spacing\\b[^>]*\\bw:val=["']${spacing}["']`),
            `DOCX 不可把 ONLYOFFICE 畫面用字距 ${spacing} 寫死：${paragraph}`,
          );
        }
      }
      distributedOoxml = {
        paraId,
        standardDistribute: true,
        transientSpacingRemoved:
          process.env.OPENDESK_LIVE_LEGACY_BRIDGE !== "1",
      };
    }

    await evaluate(
      `new Promise((resolve) => Asc.plugin.executeMethod("FocusEditor", [], resolve))`,
      pluginContextId,
    );
    await evaluate(
      `new Promise((resolve) => Asc.plugin.executeMethod(
        "InputText",
        ["【智慧引號LIVE】他說「外層『內層。"],
        resolve
      ))`,
      pluginContextId,
    );
    await delay(350);
    await press({ key: '"', code: "Quote", virtualKeyCode: 222, modifiers: 8 });
    let smartQuoteText = (await readParagraphs()).find((value) =>
      value.includes("【智慧引號LIVE】"),
    );
    assert.ok(smartQuoteText?.includes("【智慧引號LIVE】他說「外層『內層。』"));
    await press({ key: '"', code: "Quote", virtualKeyCode: 222, modifiers: 8 });
    smartQuoteText = (await readParagraphs()).find((value) =>
      value.includes("【智慧引號LIVE】"),
    );
    assert.ok(smartQuoteText?.includes("【智慧引號LIVE】他說「外層『內層。』」"));

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
    await press({ key: "c", code: "KeyC", virtualKeyCode: 67, modifiers: 12 });
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
    await press({ key: "v", code: "KeyV", virtualKeyCode: 86, modifiers: 12 });
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
    assert.equal(
      formatCopyPaste.bold,
      true,
      "macOS Command+Shift+C／Command+Shift+V 未把粗體格式套到目標文字",
    );

    const seededHeading = await evaluate(`new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraphs = document.GetAllParagraphs();
        for (let index = 0; index < paragraphs.length; index += 1) {
          const text = paragraphs[index].GetText();
          // 自動編號的顯示標籤也會出現在 GetText()，但不是可直接改寫的本文。
          if (text.includes("\\t")) continue;
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
          distributedAlignment: {
            restoredOnOpen: restoredDistribution,
            before: distributedBefore,
            after: distributedAfter,
            dynamicLayout: distributedDiagnostic,
            afterRightIndent: distributedAfterResize,
            resizedLayout: distributedResizeLayout,
            ooxml: distributedOoxml,
            screenshots: {
              before: distributedBeforeScreenshot,
              after: distributedAfterScreenshot,
            },
          },
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
