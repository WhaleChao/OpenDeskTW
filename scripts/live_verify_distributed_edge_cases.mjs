import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const port = Number(process.argv[2] || 9232);
const screenshotDirectory =
  process.env.OPENDESK_LIVE_SCREENSHOT_DIR ||
  "/private/tmp/OpenDeskTW-distributed-edge-cases";
const timeoutMs = Number(process.env.OPENDESK_LIVE_TIMEOUT_MS || 60000);
const pluginGuid = "asc.{5CBF7C74-7021-4E8C-93F3-5A6C20260722}";
const fixtureText = "中華民國114年7月25日";
const tableFixtureText = "上訴人即被告";
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
    for (const listener of listeners.get(message.method) || []) {
      listener(message.params || {});
    }
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

async function ensureBlankWordTarget() {
  const deadline = Date.now() + Math.min(timeoutMs, 30000);
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    if (
      targets.some(
        (item) => item.type === "page" && /doctype=word/.test(item.url || ""),
      )
    ) {
      return;
    }
    const startCenter = targets.find(
      (item) =>
        item.type === "page" &&
        /\/login\/index\.html/.test(item.url || "") &&
        item.webSocketDebuggerUrl,
    );
    if (startCenter) {
      const startCenterCdp = await connect(startCenter.webSocketDebuggerUrl);
      try {
        await startCenterCdp.call("Runtime.enable");
        const readiness = await startCenterCdp.call("Runtime.evaluate", {
          expression:
            'typeof window.sdk?.command === "function" ? (window.sdk.command("create:new", "word"), "opened") : "waiting"',
          returnByValue: true,
          userGesture: true,
        });
        if (readiness.result?.value === "opened") return;
      } finally {
        startCenterCdp.close();
      }
    }
    await delay(250);
  }
  throw new Error("ONLYOFFICE 起始中心無法建立空白 Word 測試文件");
}

await ensureBlankWordTarget();
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
    throw new Error(
      result.exceptionDetails.exception?.description || "頁面執行失敗",
    );
  }
  return result.result?.value;
};

try {
  await cdp.call("Runtime.enable");
  await cdp.call("Page.enable");
  const deadline = Date.now() + timeoutMs;
  let pluginContextId;
  let editorContextId;
  while (Date.now() < deadline && (!pluginContextId || !editorContextId)) {
    for (const [contextId] of contexts) {
      try {
        const status = await evaluate(
          `({
            guid: window.Asc?.plugin?.guid || "",
            shortcutInstalled: Boolean(window.__OpenDeskTwWordShortcuts?.handler)
          })`,
          contextId,
        );
        if (status.guid === pluginGuid) pluginContextId = contextId;
        if (status.shortcutInstalled) editorContextId = contextId;
      } catch (_) {
        // 跨來源或正在初始化的 context 會在下一輪再讀。
      }
    }
    if (!pluginContextId || !editorContextId) await delay(250);
  }
  assert.ok(pluginContextId, "找不到 2.0.4 繁中工具執行環境");
  assert.ok(editorContextId, "找不到 Word 相容快捷鍵監聽器");

  const blankBefore = await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraph = Api.GetDocument().GetCurrentParagraph();
        return {
          text: paragraph?.GetText?.() || "",
          paraId: paragraph?.GetParaId?.() || 0
        };
      }, false, false, resolve);
    })`,
    pluginContextId,
  );
  assert.equal(blankBefore.text.trim(), "", "LIVE 文件起始段落必須是空白");

  await evaluate(
    `window.__OpenDeskTwWordShortcuts.applyDistributedAlignment()`,
    editorContextId,
  );
  await delay(400);
  const blankDiagnostic = await evaluate(
    `window.__OpenDeskTwDistributedLayout || null`,
    pluginContextId,
  );
  const blankAfter = await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const paragraph = Api.GetDocument().GetCurrentParagraph();
        return {
          paraId: paragraph?.GetParaId?.() || 0,
          text: paragraph?.GetText?.() || ""
        };
      }, false, false, resolve);
    })`,
    pluginContextId,
  );
  assert.ok(
    !blankDiagnostic?.error,
    `空白未命名文件仍發生 ParaId 錯誤：${JSON.stringify(blankDiagnostic)}`,
  );
  assert.equal(
    typeof blankAfter.paraId,
    "number",
    `空白段落 ID 不是數字：${JSON.stringify(blankAfter)}`,
  );
  assert.ok(blankAfter.paraId > 0, "空白段落沒有配置非零數字 ID");

  // 關閉「沒有至少兩個字元」的預期提示，不影響後續同一文件測試。
  await evaluate(
    `(() => {
      const button = Array.from(document.querySelectorAll("button"))
        .find((item) => /確定|OK/i.test(item.textContent || ""));
      button?.click();
      return Boolean(button);
    })()`,
    editorContextId,
  );
  await delay(200);

  await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = document.GetCurrentParagraph();
        paragraph.AddText(${JSON.stringify(fixtureText)});
        paragraph.GetRange(0, paragraph.GetText().length).Select();
        document.ForceRecalculate?.();
        return paragraph.GetText();
      }, false, true, resolve);
    })`,
    pluginContextId,
  );
  await evaluate(
    `window.__OpenDeskTwWordShortcuts.applyDistributedAlignment()`,
    editorContextId,
  );
  await delay(750);

  const mixedDiagnostic = await evaluate(
    `window.__OpenDeskTwDistributedLayout || null`,
    pluginContextId,
  );
  const mixedLayout = await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = document.GetAllParagraphs().find(function (item) {
          return item.GetText().trim() === ${JSON.stringify(fixtureText)};
        });
        document.ForceRecalculate?.();
        const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId?.());
        const lines = nativeParagraph?.Lines || nativeParagraph?.Xb || [];
        const line = lines[0];
        const range = (line?.Ranges || line?.Of || [])[0];
        return {
          text: paragraph.GetText(),
          paraId: paragraph.GetParaId?.(),
          lines: lines.length,
          nativeAlignment: nativeParagraph?.fa?.ye,
          available: range
            ? Number(range.XEnd ?? range.tB) - Number(range.X ?? range.ha)
            : null,
          occupied: range ? Number(range.W ?? range.Da) : null
        };
      }, false, false, resolve);
    })`,
    pluginContextId,
  );
  assert.ok(
    !mixedDiagnostic?.error,
    `混合民國日期分散對齊失敗：${JSON.stringify(mixedDiagnostic)}`,
  );
  assert.equal(mixedLayout.text.trim(), fixtureText);
  assert.equal(
    mixedLayout.lines,
    1,
    `最後一字仍被擠到下一行：${JSON.stringify({
      mixedLayout,
      mixedDiagnostic,
    })}`,
  );
  assert.equal(mixedLayout.nativeAlignment, 4);
  assert.ok(
    Number.isFinite(mixedLayout.available) &&
      Number.isFinite(mixedLayout.occupied) &&
      mixedLayout.occupied <= mixedLayout.available &&
      mixedLayout.available - mixedLayout.occupied <=
        Math.max(1, mixedLayout.available * 0.05),
    `文字沒有安全攤滿單行可用寬度：${JSON.stringify(mixedLayout)}`,
  );

  await mkdir(screenshotDirectory, { recursive: true });
  const capture = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const screenshotPath = `${screenshotDirectory}/mixed-date-single-line.png`;
  await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));

  const tableCreated = await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const table = document.CreateTable?.(1, 2);
        if (!table) return { ok: false, reason: "CreateTable unavailable" };
        table.SetWidth?.("twips", 6000);
        const labelCell = table.GetCell?.(0, 0);
        const valueCell = table.GetCell?.(0, 1);
        labelCell?.SetWidth?.("twips", 2200);
        valueCell?.SetWidth?.("twips", 3800);
        const paragraph = labelCell?.GetContent?.().GetElement?.(0);
        paragraph?.AddText?.(${JSON.stringify(tableFixtureText)});
        document.Push?.(table);
        const text = paragraph?.GetText?.() || "";
        paragraph
          ?.GetRange?.(0, Array.from(${JSON.stringify(tableFixtureText)}).length)
          ?.Select?.();
        document.ForceRecalculate?.();
        return {
          ok: Boolean(paragraph),
          text: text.trim(),
          inTable: Boolean(paragraph?.GetParentTableCell?.())
        };
      }, false, true, resolve);
    })`,
    pluginContextId,
  );
  assert.deepEqual(
    tableCreated,
    { ok: true, text: tableFixtureText, inTable: true },
    `無法建立窄欄 LIVE 表格：${JSON.stringify(tableCreated)}`,
  );

  await evaluate(
    `window.__OpenDeskTwWordShortcuts.applyDistributedAlignment()`,
    editorContextId,
  );
  await delay(1000);
  const tableDiagnostic = await evaluate(
    `window.__OpenDeskTwDistributedLayout || null`,
    pluginContextId,
  );
  const tableLayout = await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = document.GetAllParagraphs().find(function (item) {
          return item.GetText().trim() === ${JSON.stringify(tableFixtureText)};
        });
        document.ForceRecalculate?.();
        const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId?.());
        const lines = nativeParagraph?.Lines || nativeParagraph?.Xb || [];
        const firstRange = (lines[0]?.Ranges || lines[0]?.Of || [])[0];
        return {
          text: paragraph?.GetText?.() || "",
          lines: lines.length,
          nativeAlignment: nativeParagraph?.fa?.ye,
          leftAlignment: AscCommon?.align_Left,
          inTable: Boolean(paragraph?.GetParentTableCell?.()),
          occupied: firstRange
            ? Number(firstRange.W ?? firstRange.Da)
            : null
        };
      }, false, false, resolve);
    })`,
    pluginContextId,
  );
  assert.ok(
    !tableDiagnostic?.error,
    `窄欄表格分散對齊失敗：${JSON.stringify(tableDiagnostic)}`,
  );
  assert.equal(tableDiagnostic?.implementation, "word-layout-ranges-v4");
  assert.equal(tableDiagnostic?.tableParagraphs, 1);
  assert.equal(tableLayout.text.trim(), tableFixtureText);
  assert.equal(tableLayout.inTable, true);
  assert.equal(
    tableLayout.lines,
    1,
    `表格文字仍被推出下一行：${JSON.stringify({
      tableLayout,
      tableDiagnostic,
    })}`,
  );
  assert.equal(
    tableLayout.nativeAlignment,
    tableLayout.leftAlignment,
    "表格內仍重複套用 ONLYOFFICE 核心 distribute",
  );
  assert.notEqual(
    tableLayout.nativeAlignment,
    4,
    "表格內不得使用 ONLYOFFICE 核心 distribute(4)",
  );
  assert.ok(
    tableDiagnostic.spacings?.some((spacing) => spacing > 0),
    `表格未產生依欄寬計算的動態字距：${JSON.stringify(tableDiagnostic)}`,
  );

  const stableToken = `stable-${Date.now()}`;
  await evaluate(
    `(() => {
      window.__OpenDeskTwDistributedLayout.liveStableToken =
        ${JSON.stringify(stableToken)};
      return true;
    })()`,
    pluginContextId,
  );
  const refreshHook = await evaluate(
    `({
      mode: window.__OpenDeskTwDistributedLayoutHook?.mode || "",
      keyupMode:
        window.__OpenDeskTwDistributedLayoutHook?.keyupMode || "",
      legacyFullRefreshInstalled: Boolean(
        window.__OpenDeskTwDistributedLayoutHook?.keyup
      )
    })`,
    editorContextId,
  );
  assert.equal(refreshHook.mode, "resize-and-layout-drag-only");
  assert.equal(refreshHook.keyupMode, "in-place-current-paragraph");
  assert.equal(refreshHook.legacyFullRefreshInstalled, false);

  const typedLayoutBeforeKeyup = await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = document.GetAllParagraphs().find(function (item) {
          return item.GetText().trim().startsWith(
            ${JSON.stringify(tableFixtureText)}
          );
        });
        paragraph?.AddText?.("甲");
        document.ForceRecalculate?.();
        const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId?.());
        return {
          text: paragraph?.GetText?.().trim() || "",
          lines: (nativeParagraph?.Lines || nativeParagraph?.Xb || []).length
        };
      }, false, true, resolve);
    })`,
    pluginContextId,
  );
  await evaluate(
    `(() => {
      document.dispatchEvent(new KeyboardEvent("keyup", {
        key: "甲",
        code: "KeyA",
        bubbles: true
      }));
      document.dispatchEvent(new PointerEvent("pointerup", {
        clientX: 10,
        clientY: 10,
        bubbles: true
      }));
      return true;
    })()`,
    editorContextId,
  );
  await delay(750);
  const typedLayoutAfterKeyup = await evaluate(
    `new Promise((resolve) => {
      Asc.plugin.callCommand(function () {
        const document = Api.GetDocument();
        const paragraph = document.GetAllParagraphs().find(function (item) {
          return item.GetText().trim().startsWith(
            ${JSON.stringify(tableFixtureText)}
          );
        });
        const nativeParagraph = AscCommon?.Ne?.Ug?.(paragraph.GetInternalId?.());
        return {
          text: paragraph?.GetText?.().trim() || "",
          lines: (nativeParagraph?.Lines || nativeParagraph?.Xb || []).length
        };
      }, false, true, resolve);
    })`,
    pluginContextId,
  );
  const typingStability = await evaluate(
    `({
      token:
        window.__OpenDeskTwDistributedLayout?.liveStableToken || "",
      implementation:
        window.__OpenDeskTwDistributedLayout?.implementation || "",
      typing:
        window.__OpenDeskTwDistributedTyping || null
    })`,
    pluginContextId,
  );
  assert.equal(
    typingStability.token,
    stableToken,
    "普通打字或點擊後仍重新建立排版結果，會造成畫面抖動",
  );
  assert.equal(
    typedLayoutAfterKeyup.lines,
    1,
    "分散段落輸入新字後必須原地重算字距並維持單行",
  );
  assert.equal(typingStability.typing?.applied, true);
  assert.equal(
    typingStability.typing?.method,
    "in-place-current-paragraph",
  );

  const tableCapture = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const tableScreenshotPath =
    `${screenshotDirectory}/table-cell-distributed-single-line.png`;
  await writeFile(
    tableScreenshotPath,
    Buffer.from(tableCapture.data, "base64"),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: "2.8.5 / plugin 2.0.4",
        blank: {
          before: blankBefore,
          after: blankAfter,
          diagnostic: blankDiagnostic,
        },
        mixedDate: {
          layout: mixedLayout,
          diagnostic: mixedDiagnostic,
        },
        tableCell: {
          layout: tableLayout,
          diagnostic: tableDiagnostic,
          refreshHook,
          typedLayoutBeforeKeyup,
          typedLayoutAfterKeyup,
          typingStability,
        },
        screenshots: {
          mixedDate: screenshotPath,
          tableCell: tableScreenshotPath,
        },
      },
      null,
      2,
    ),
  );
} finally {
  cdp.close();
}
