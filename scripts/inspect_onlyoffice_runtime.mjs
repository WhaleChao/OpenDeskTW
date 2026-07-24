import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const port = Number(process.argv[2] || 9231);
const timeoutMs = Number(process.env.OPENDESK_LIVE_TIMEOUT_MS || 30000);
const targetPattern = process.argv[3] || "doctype=word";
const applyDirect = process.argv.includes("--apply-direct");
const spacingArgument = process.argv.find((item) => item.startsWith("--apply-spacing="));
const applySpacing = spacingArgument ? Number(spacingArgument.split("=")[1]) : null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const target = targets.find(
      (item) => item.type === "page" && (item.url || "").includes(targetPattern),
    );
    if (target?.webSocketDebuggerUrl) return target;
    await delay(250);
  }
  throw new Error(`找不到 ONLYOFFICE 除錯頁面：${targetPattern}`);
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

const target = await waitForTarget();
const cdp = await connect(target.webSocketDebuggerUrl);
const contexts = new Map();
cdp.on("Runtime.executionContextCreated", ({ context }) => contexts.set(context.id, context));
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
  await delay(1000);

  const runtime = [];
  let twPluginContextId;
  let editorContextId;
  for (const [contextId, context] of contexts) {
    let status;
    try {
      status = await evaluate(`({
        href: location.href,
        title: document.title,
        guid: window.Asc?.plugin?.guid || "",
        shortcutInstalled: Boolean(window.__OpenDeskTwWordShortcuts?.handler),
        text: document.body?.innerText || ""
      })`, contextId);
    } catch (_) {
      continue;
    }
    if (status.guid === "asc.{5CBF7C74-7021-4E8C-93F3-5A6C20260722}") {
      twPluginContextId = contextId;
    }
    if (status.shortcutInstalled) editorContextId = contextId;
    runtime.push({
      contextId,
      name: context.name,
      origin: context.origin,
      ...status,
    });
  }

  const bannedTerms = [
    "模板",
    "文档",
    "设置",
    "默认",
    "网络",
    "账号",
    "用户",
    "保存",
    "打开",
    "关闭",
    "编辑器",
    "插件",
    "智能体",
    "知识库",
    "工作区",
    "上传",
    "下载",
    "应用",
    "语言",
    "字体",
    "段落",
    "页眉",
    "页脚",
    "审阅",
    "拼写",
    "翻译",
    "聊天机器人",
    "生成",
    "重写",
    "续写",
    "总结",
    "优化",
    "错误",
    "检查",
    "请求",
    "响应",
  ];
  const languageFindings = runtime
    .map((item) => ({
      contextId: item.contextId,
      href: item.href,
      guid: item.guid,
      matches: bannedTerms.filter((term) => item.text.includes(term)),
      sample: item.text.slice(0, 1200),
    }))
    .filter((item) => item.matches.length > 0);

  if (targetPattern.includes("login/index")) {
    const homeContextId = runtime.find(function (item) {
      return item.href.includes("/login/index.html") && item.text.includes("開啟本機檔案");
    })?.contextId;
    assert.ok(homeContextId, "找不到 ONLYOFFICE 首頁執行環境");
    const patchArgument = process.argv.find((item) => item.startsWith("--patch-home="));
    let patchResult = null;
    if (patchArgument) {
      const patchPath = patchArgument.slice("--patch-home=".length);
      const patchSource = await readFile(patchPath, "utf8");
      patchResult = await evaluate(patchSource, homeContextId);
      await delay(300);
    }
    const homeState = await evaluate(`(() => {
      const visibleNodes = Array.from(document.querySelectorAll("body *"))
        .filter(function (node) {
          if (node.children.length || !node.textContent.trim()) return false;
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .map(function (node) {
          return {
            text: node.textContent.trim(),
            id: node.id,
            className: String(node.className || ""),
            tagName: node.tagName
          };
        });
      return {
        language: window.lang || window.language || "",
        l10nKeys: Object.keys(window.l10n || {}),
        zhTW: window.l10n?.zh_TW || null,
        visibleNodes: visibleNodes
      };
    })()`, homeContextId);
    console.log(
      JSON.stringify({ target, runtime, languageFindings, patchResult, homeState }, null, 2),
    );
    cdp.close();
    process.exit(0);
  }

  assert.ok(twPluginContextId, "找不到全能文件工作台繁中外掛");
  assert.ok(editorContextId, "找不到已安裝快捷鍵的文件編輯器");

  let openedFontList = null;
  if (process.argv.includes("--open-font-list")) {
    openedFontList = await evaluate(`(() => {
      const candidates = Array.from(document.querySelectorAll("*"))
        .filter(function (element) {
          return String(element.innerText || element.value || "").trim() === "Noto Sans CJK TC" &&
            element.getBoundingClientRect().width > 0;
        })
        .sort(function (left, right) {
          return left.children.length - right.children.length;
        });
      const target =
        candidates.find(function (element) { return element.tagName === "BUTTON"; }) ||
        candidates[0]?.closest?.("button") ||
        candidates[0];
      target?.click?.();
      return candidates.map(function (element) {
        return {
          tagName: element.tagName,
          className: String(element.className || ""),
          parentClassName: String(element.parentElement?.className || "")
        };
      });
    })()`, editorContextId);
    await delay(500);
  }

  const targetSelection = await evaluate(`new Promise((resolve) => {
    Asc.plugin.callCommand(function () {
      const document = Api.GetDocument();
      const paragraphs = document.GetAllParagraphs();
      const paragraph = paragraphs.find(function (item) {
        return item.GetText().trim() === "預期結果";
      });
      if (!paragraph) return null;
      const range = paragraph.GetRange(0, paragraph.GetText().length);
      range.Select();
      const cell = paragraph.GetParentTableCell?.();
      const textPr = range.GetTextPr?.();
      const beforeJc = {
        public: paragraph.GetJc?.(),
        internal: paragraph.Lb?.get_Jc?.()
      };
      if (${applyDirect}) {
        paragraph.SetJc?.("left");
        paragraph.Ha?.Vt?.(AscCommon.align_Distributed);
      }
      if (${Number.isFinite(applySpacing) ? applySpacing : "null"} !== null) {
        range.SetSpacing?.(${Number.isFinite(applySpacing) ? applySpacing : 0});
      }
      const describe = function (value) {
        const methods = [];
        let prototype = value;
        for (let depth = 0; prototype && depth < 4; depth += 1) {
          methods.push.apply(methods, Object.getOwnPropertyNames(prototype));
          prototype = Object.getPrototypeOf(prototype);
        }
        return {
          keys: Object.keys(value || {}),
          methods: Array.from(new Set(methods)).filter(function (name) {
            return /align|jc|para|pr|select|compiled|width|margin|grid|bound|size|measure/i.test(name);
          }).sort(),
          candidates: [
            "Vt",
            "put_Jc",
            "Set_Align",
            "Set_Jc",
            "SetJc",
            "rn",
            "Cd",
            "Kc",
            "Ue",
            "td"
          ].filter(function (name) {
            return typeof value?.[name] === "function";
          })
        };
      };
      const primitives = function (value) {
        const result = {};
        Object.keys(value || {}).forEach(function (key) {
          const item = value[key];
          if (item === null || ["string", "number", "boolean"].includes(typeof item)) {
            result[key] = item;
          }
        });
        return result;
      };
      return {
        text: paragraph.GetText(),
        paragraph: describe(paragraph),
        paragraphBa: describe(paragraph.Ba),
        paragraphInternal: describe(paragraph.Lb),
        paragraphHa: describe(paragraph.Ha),
        range: describe(range),
        rangeElement: describe(range.Element),
        paragraphPrimitiveTree: {
          paragraph: primitives(paragraph?.Ha),
          children: Object.fromEntries(
            Object.keys(paragraph?.Ha || {}).map(function (key) {
              return [key, primitives(paragraph.Ha[key])];
            }),
          ),
        },
        cell: describe(cell),
        cellBa: describe(cell?.Ba),
        cellInternal: describe(cell?.Wb),
        cellEO: describe(cell?.EO),
        cellPrimitiveTree: {
          cell: primitives(cell),
          internal: primitives(cell?.Wb),
          internalChildren: Object.fromEntries(
            Object.keys(cell?.Wb || {}).map(function (key) {
              return [key, primitives(cell.Wb[key])];
            }),
          ),
          eo: primitives(cell?.EO),
          eoChildren: Object.fromEntries(
            Object.keys(cell?.EO || {}).map(function (key) {
              return [key, primitives(cell.EO[key])];
            }),
          ),
        },
        cellMeasurements: {
          width: cell?.GetWidth?.(),
          minWidth: cell?.GetMinWidth?.(),
          marginLeft: cell?.GetMarginLeft?.(),
          marginRight: cell?.GetMarginRight?.()
        },
        textProperties: {
          fontSize: textPr?.GetFontSize?.(),
          fontFamily: textPr?.GetFontFamily?.()?.GetName?.(),
          spacing: textPr?.GetSpacing?.()
        },
        beforeJc: beforeJc,
        afterJc: {
          public: paragraph.GetJc?.(),
          internal: paragraph.Lb?.get_Jc?.()
        },
      };
    }, false, false, resolve);
  })`, twPluginContextId);
  assert.ok(targetSelection, "找不到表格「預期結果」段落");
  await delay(300);

  let fontMenuResult = null;
  if (process.argv.includes("--apply-font-menu")) {
    const button = await evaluate(`(() => {
      const candidates = Array.from(document.querySelectorAll("*"))
        .filter(function (element) {
          return String(element.innerText || "").trim() === "臺灣字型" &&
            element.getBoundingClientRect().width > 0;
        })
        .sort(function (left, right) {
          return left.children.length - right.children.length;
        });
      const target =
        candidates.find(function (element) { return element.tagName === "BUTTON"; }) ||
        candidates[0]?.closest?.("button") ||
        candidates[0];
      target?.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true }));
      target?.click?.();
      return candidates.map(function (element) {
        return {
          tagName: element.tagName,
          className: String(element.className || ""),
          parentClassName: String(element.parentElement?.className || "")
        };
      });
    })()`, editorContextId);
    await delay(400);
    const item = await evaluate(`(() => {
      const candidates = Array.from(document.querySelectorAll("*"))
        .filter(function (element) {
          return String(element.innerText || "").trim() === "新細明體" &&
            element.getBoundingClientRect().width > 0;
        })
        .sort(function (left, right) {
          return left.children.length - right.children.length;
        });
      const target = candidates[0];
      target?.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true }));
      target?.click?.();
      return {
        found: candidates.length,
        candidates: candidates.map(function (element) {
          return {
            tagName: element.tagName,
            className: String(element.className || ""),
            parentClassName: String(element.parentElement?.className || "")
          };
        })
      };
    })()`, editorContextId);
    await delay(600);
    fontMenuResult = { button, item };
  }

  const readSelection = () =>
    evaluate(`(() => {
      const api = window.Asc?.editor;
      const elements = api?.getSelectedElements?.() || [];
      return {
        apiKeys: Object.keys(api || {}).filter(function (key) {
          return /font|para|align|select/i.test(key);
        }).slice(0, 200),
        elements: elements.map(function (item) {
          const value = item.get_ObjectValue?.();
          return {
            type: item.get_ObjectType?.(),
            itemKeys: Object.keys(item),
            valueKeys: Object.keys(value || {}),
            jc:
              value?.get_Jc?.() ??
              value?.asc_getJc?.() ??
              value?.get_ParaPr?.()?.get_Jc?.() ??
              null
          };
        })
      };
    })()`, editorContextId);

  const before = await readSelection();
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "J",
    code: "KeyJ",
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true
  }))`, editorContextId);
  await delay(500);
  const after = await readSelection();

  const fontState = await evaluate(`(() => {
    const stores = [];
    const visit = function (value, label) {
      try {
        const store = value?.store;
        const rows = typeof store?.toJSON === "function" ? store.toJSON() : [];
        if (rows.length && rows.some(function (row) { return row?.name; })) {
          stores.push({ label: label, fonts: rows.map(function (row) { return row.name; }) });
        }
      } catch (_) {}
    };
    visit(window.DE?.getController?.("Fonts"), "DE Fonts");
    visit(window.DE?.getController?.("Common.Controllers.Fonts"), "DE Common Fonts");
    const common = window.Common?.Controllers;
    if (common) {
      Object.keys(common).forEach(function (key) { visit(common[key], "Common." + key); });
    }
    const bodyText = document.body?.innerText || "";
    return {
      stores: stores,
      hasPMingLiUInDom: /新細明體|PMingLiU/i.test(bodyText),
      fontInputs: Array.from(document.querySelectorAll("input")).map(function (input) {
        return { value: input.value, id: input.id, className: input.className };
      }).filter(function (item) {
        return /font/i.test(item.id + " " + item.className);
      }).slice(0, 50)
    };
  })()`, editorContextId);

  console.log(
    JSON.stringify(
      {
        target: { title: target.title, url: target.url },
        contexts: runtime.map(({ text, ...item }) => item),
        languageFindings,
        targetSelection,
        alignment: { before, after },
        fontState,
        openedFontList,
        fontMenuResult,
      },
      null,
      2,
    ),
  );
} finally {
  cdp.close();
}
