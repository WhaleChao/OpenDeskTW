(function (window) {
  "use strict";

  const plugin = window.Asc.plugin;
  let toolbarEventsBound = false;
  let wordFormatClipboardReady = false;
  let magiResultWindow = null;
  let magiResultPayload = null;
  let recoveryWindow = null;
  let draftSnapshotTimer = null;
  let lastWordAction = null;
  let distributedPersistenceTimer = null;
  let distributedLayoutTimer = null;
  let distributedTypingTimer = null;
  let distributedLayoutBusy = false;
  let distributedLayoutRefreshQueued = false;
  const draftStorageKey = "opendesk-tw-rich-drafts-v2";
  const draftSnapshotIntervalMs = 15000;
  const maxDraftSnapshots = 12;
  const maxDraftHtmlLength = 2_500_000;
  const numericFontSizes = [9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
  const traditionalFonts = [
    { id: "pmingliu", name: "PMingLiU", text: "新細明體（PMingLiU）" },
    { id: "mingliu", name: "MingLiU", text: "細明體（MingLiU）" },
  ];
  const selectedTextOptions = {
    Numbering: false,
    Math: false,
    TableCellSeparator: "\t",
    TableRowSeparator: "\n",
    ParaSeparator: "\n",
    NewLineSeparator: "\n",
    TabSymbol: "\t",
  };

  function showMessage(message) {
    plugin.executeMethod("ShowError", [message, 0]);
  }

  function readDraftSnapshots() {
    try {
      const value = JSON.parse(window.localStorage.getItem(draftStorageKey) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function writeDraftSnapshots(snapshots) {
    const normalized = snapshots
      .filter(function (snapshot) {
        return snapshot && snapshot.id && snapshot.html;
      })
      .sort(function (left, right) {
        return Number(right.savedAt || 0) - Number(left.savedAt || 0);
      })
      .slice(0, maxDraftSnapshots);
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(normalized));
      return true;
    } catch (_) {
      // A very image-heavy HTML snapshot can exceed the browser quota. Keep the
      // newest text-rich half before giving up, so an unsaved document still has
      // a useful recovery path.
      try {
        window.localStorage.setItem(
          draftStorageKey,
          JSON.stringify(
            normalized.slice(0, Math.max(2, Math.floor(maxDraftSnapshots / 2))),
          ),
        );
        return true;
      } catch (_error) {
        return false;
      }
    }
  }

  function draftDocumentIdentity(hostWindow) {
    const sourcePath = editorSourcePath(hostWindow);
    const title = String(plugin.info?.documentTitle || "未命名文件").trim() || "未命名文件";
    return {
      key: sourcePath || `unsaved:${title}`,
      sourcePath,
      title,
    };
  }

  function simpleDraftHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function captureRichDraft(hostWindow, callback) {
    plugin.executeMethod("GetFileHTML", [], function (html) {
      const content = String(html || "");
      const text = content
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || content.length > maxDraftHtmlLength) {
        callback?.(false);
        return;
      }
      const identity = draftDocumentIdentity(hostWindow);
      const hash = simpleDraftHash(content);
      const snapshots = readDraftSnapshots();
      const current = snapshots.find(function (snapshot) {
        return snapshot.documentKey === identity.key;
      });
      if (current?.hash === hash) {
        callback?.(false);
        return;
      }
      const now = Date.now();
      snapshots.unshift({
        id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
        documentKey: identity.key,
        title: identity.title,
        sourcePath: identity.sourcePath,
        savedAt: now,
        characters: text.length,
        hash,
        html: content,
      });
      // Keep one recent version per document plus a second checkpoint for the
      // active document. This avoids a single document evicting all other drafts.
      let currentDocumentCopies = 0;
      const compact = snapshots.filter(function (snapshot) {
        if (snapshot.documentKey !== identity.key) return true;
        currentDocumentCopies += 1;
        return currentDocumentCopies <= 2;
      });
      callback?.(writeDraftSnapshots(compact));
    });
  }

  function scheduleRichDraftSnapshots(hostWindow) {
    if (draftSnapshotTimer && typeof window.clearInterval === "function") {
      window.clearInterval(draftSnapshotTimer);
    }
    captureRichDraft(hostWindow);
    if (typeof window.setInterval === "function") {
      draftSnapshotTimer = window.setInterval(function () {
        captureRichDraft(hostWindow);
      }, draftSnapshotIntervalMs);
    }
  }

  function sendRecoveryWindowPayload() {
    if (!recoveryWindow) return;
    recoveryWindow.command("onDraftSnapshots", {
      snapshots: readDraftSnapshots().map(function (snapshot) {
        return {
          id: snapshot.id,
          title: snapshot.title,
          sourcePath: snapshot.sourcePath,
          savedAt: snapshot.savedAt,
          characters: snapshot.characters,
        };
      }),
    });
  }

  function restoreRichDraft(id) {
    const snapshot = readDraftSnapshots().find(function (value) {
      return value.id === id;
    });
    if (!snapshot) {
      showMessage("找不到這份草稿，可能已被清除。");
      return;
    }
    plugin.executeMethod("PasteHtml", [snapshot.html], function () {
      showMessage(
        `已把「${snapshot.title}」的未存草稿插入目前游標位置。\n請立即使用「另存新檔」保留復原內容。`,
      );
      focusEditor();
    });
  }

  function deleteRichDraft(id) {
    writeDraftSnapshots(
      readDraftSnapshots().filter(function (snapshot) {
        return snapshot.id !== id;
      }),
    );
    sendRecoveryWindowPayload();
  }

  function showRichDraftRecovery() {
    captureRichDraft(window.parent, function () {
      if (!recoveryWindow) {
        recoveryWindow = new window.Asc.PluginWindow();
        recoveryWindow.attachEvent("onDraftRecoveryReady", sendRecoveryWindowPayload);
        recoveryWindow.attachEvent("onRestoreDraft", function (id) {
          restoreRichDraft(String(id || ""));
        });
        recoveryWindow.attachEvent("onDeleteDraft", function (id) {
          deleteRichDraft(String(id || ""));
        });
        recoveryWindow.attachEvent("onClose", function () {
          if (recoveryWindow) recoveryWindow.close();
          recoveryWindow = null;
        });
      }
      recoveryWindow.show({
        url: "draft-recovery.html",
        description: "未存草稿復原",
        isVisual: true,
        isModal: false,
        EditorsSupport: ["word"],
        size: [640, 520],
        buttons: [{ text: "關閉", primary: false }],
      });
      window.setTimeout(sendRecoveryWindowPayload, 200);
    });
  }

  function sendMagiWindowPayload() {
    if (magiResultWindow && magiResultPayload) {
      magiResultWindow.command("onMagiResult", magiResultPayload);
    }
  }

  function showMagiWindow(payload) {
    magiResultPayload = payload;
    if (!magiResultWindow) {
      magiResultWindow = new window.Asc.PluginWindow();
      magiResultWindow.attachEvent("onMagiResultReady", sendMagiWindowPayload);
      magiResultWindow.attachEvent("onClose", function () {
        if (magiResultWindow) magiResultWindow.close();
        magiResultWindow = null;
      });
    }
    magiResultWindow.show({
      url: "magi-result.html",
      description: "MAGI 文件助理",
      isVisual: true,
      isModal: false,
      EditorsSupport: ["word"],
      size: [620, 520],
      buttons: [{ text: "關閉", primary: false }],
    });
    window.setTimeout(sendMagiWindowPayload, 250);
  }

  function updateMagiWindow(payload) {
    magiResultPayload = payload;
    sendMagiWindowPayload();
  }

  function reloadMagiBridgeConfig() {
    return new Promise(function (resolve) {
      if (!window.document?.head || !window.document.createElement) {
        resolve(window.OpenDeskMagiBridge);
        return;
      }
      const script = window.document.createElement("script");
      let settled = false;
      const finish = function () {
        if (settled) return;
        settled = true;
        script.remove?.();
        resolve(window.OpenDeskMagiBridge);
      };
      script.src = `magi-bridge-config.js?${Date.now()}`;
      script.onload = finish;
      script.onerror = finish;
      window.document.head.appendChild(script);
      window.setTimeout(finish, 1500);
    });
  }

  function magiBridgeConnectionMessage(status) {
    if (status === 401) {
      return "MAGI 橋接權杖已過期。請保持「全能文件工作台」開啟，完全關閉 ONLYOFFICE 後再重新開啟。";
    }
    if (status === 403) {
      return "目前 ONLYOFFICE 來源未獲 MAGI 橋接允許，請更新至最新版全能文件工作台後重試。";
    }
    return "無法連線到本機 MAGI 橋接。請先開啟或重新啟動「全能文件工作台」，保持工作台開啟，再按一次分析。";
  }

  async function verifyMagiBridge(bridge) {
    const healthUrl =
      bridge.healthUrl || String(bridge.url || "").replace(/\/v1\/analyze$/, "/v1/health");
    if (!healthUrl) return { ok: false, message: magiBridgeConnectionMessage() };
    const controller = new AbortController();
    const timeout = window.setTimeout(function () {
      controller.abort();
    }, 4000);
    try {
      const response = await window.fetch(healthUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${bridge.token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !result.ok) {
        return {
          ok: false,
          message: result.error || magiBridgeConnectionMessage(response.status),
        };
      }
      return { ok: true };
    } catch (_) {
      return { ok: false, message: magiBridgeConnectionMessage() };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function editorSourcePath(hostWindow) {
    try {
      const desktop = hostWindow?.AscDesktopEditor;
      if (!desktop || typeof desktop.LocalFileGetSourcePath !== "function") return "";
      return String(desktop.LocalFileGetSourcePath() || "");
    } catch (_) {
      return "";
    }
  }

  function collectNativeDistributedParagraphIds() {
    return new Promise(function (resolve) {
      plugin.callCommand(
        function () {
          const document = Api.GetDocument();
          let ids = [];
          try {
            const stored = document
              .GetCustomProperties?.()
              ?.Get?.("OpenDeskTW.DistributedParagraphs");
            const markers = stored ? JSON.parse(stored) : [];
            ids = Array.isArray(markers)
              ? markers.map(function (marker) {
                  return marker?.id;
                })
              : [];
          } catch (_) {
            ids = [];
          }
          const nativeIds = document
            .GetAllParagraphs()
            .filter(function (paragraph) {
              const internalId = paragraph.GetInternalId?.();
              const registeredParagraph = internalId
                ? AscCommon?.Ne?.Ug?.(internalId)
                : undefined;
              const nativeParagraph =
                registeredParagraph ||
                paragraph.Paragraph ||
                Object.values(paragraph).find(function (candidate) {
                  return candidate && typeof candidate.Vt === "function";
                });
              return nativeParagraph?.fa?.ye === 4;
            })
            .map(function (paragraph) {
              return paragraph.GetParaId?.();
            })
            .filter(Boolean);
          return Array.from(
            new Map(
              ids
                .concat(nativeIds)
                .filter(Boolean)
                .map(function (id) {
                  return [String(id), id];
                }),
            ).values(),
          );
        },
        false,
        false,
        function (ids) {
          resolve(Array.isArray(ids) ? ids.slice(0, 500) : []);
        },
      );
    });
  }

  async function persistDistributedAlignment(hostWindow, attempt) {
    const sourcePath = editorSourcePath(hostWindow);
    if (!sourcePath || !/\.(docx|docm)$/i.test(sourcePath)) return;
    const paragraphIds = await collectNativeDistributedParagraphIds();
    if (!paragraphIds.length) return;
    const bridge = await reloadMagiBridgeConfig();
    const distributedUrl =
      bridge?.distributedUrl ||
      String(bridge?.url || "").replace(/\/v1\/analyze$/, "/v1/distributed-alignment");
    if (!distributedUrl || !bridge?.token) return;
    try {
      const response = await window.fetch(distributedUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridge.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: sourcePath, paragraph_ids: paragraphIds }),
        cache: "no-store",
      });
      const result = await response.json().catch(function () {
        return {};
      });
      window.__OpenDeskTwDistributedPersistence = {
        ok: Boolean(response.ok && result.ok),
        path: sourcePath,
        applied: Number(result.applied || 0),
        status: response.status,
      };
      if (!response.ok || !result.ok) throw new Error(result.error || response.status);
    } catch (error) {
      window.__OpenDeskTwDistributedPersistence = {
        ok: false,
        path: sourcePath,
        error: String(error?.message || error),
      };
      if (attempt < 4) {
        scheduleDistributedPersistence(hostWindow, 300 * 2 ** attempt, attempt + 1);
      }
    }
  }

  function scheduleDistributedPersistence(hostWindow, delay, attempt) {
    if (distributedPersistenceTimer) window.clearTimeout(distributedPersistenceTimer);
    distributedPersistenceTimer = window.setTimeout(function () {
      distributedPersistenceTimer = null;
      persistDistributedAlignment(hostWindow, Number(attempt || 0));
    }, Number(delay || 150));
  }

  function installDistributedPersistenceHook(hostWindow) {
    try {
      if (!hostWindow) return false;
      const stateKey = "__OpenDeskTwDistributedSaveHook";
      const previous = hostWindow[stateKey];
      if (
        previous?.wrapper &&
        previous?.original &&
        hostWindow.DesktopOfflineAppDocumentEndSave === previous.wrapper
      ) {
        hostWindow.DesktopOfflineAppDocumentEndSave = previous.original;
      }
      if (
        previous?.onSaveWrapper &&
        previous?.originalOnSave &&
        hostWindow.AscDesktopEditor?.OnSave === previous.onSaveWrapper
      ) {
        hostWindow.AscDesktopEditor.OnSave = previous.originalOnSave;
      }
      const original = hostWindow.DesktopOfflineAppDocumentEndSave;
      if (typeof original !== "function") return false;
      const wrapper = function () {
        const result = original.apply(this, arguments);
        if (Number(arguments[0]) === 0) {
          scheduleDistributedPersistence(hostWindow, 150, 0);
        }
        return result;
      };
      hostWindow.DesktopOfflineAppDocumentEndSave = wrapper;
      const originalOnSave = hostWindow.AscDesktopEditor?.OnSave;
      let onSaveWrapper;
      if (typeof originalOnSave === "function") {
        onSaveWrapper = function () {
          const result = originalOnSave.apply(this, arguments);
          // OnSave 代表 SDK 已產生要交給桌面程式的文件；原生檔案寫入完成
          // 可能略晚於此回呼，延後再由橋接檢查段落 ID，未完成時自動重試。
          scheduleDistributedPersistence(hostWindow, 1800, 0);
          return result;
        };
        hostWindow.AscDesktopEditor.OnSave = onSaveWrapper;
      }
      hostWindow[stateKey] = {
        guid: plugin.guid,
        original,
        wrapper,
        originalOnSave,
        onSaveWrapper,
      };
      return true;
    } catch (_) {
      return false;
    }
  }

  function collectMagiText(callback) {
    plugin.executeMethod("GetSelectedText", [selectedTextOptions], function (selectedText) {
      if (selectedText && selectedText.trim()) {
        callback({ text: selectedText, source: "選取文字" });
        return;
      }
      plugin.callCommand(
        function () {
          const document = Api.GetDocument();
          const paragraphs = document.GetAllParagraphs();
          return paragraphs
            .map(function (paragraph) {
              return paragraph.GetText();
            })
            .join("\n");
        },
        false,
        false,
        function (text) {
          callback({ text: text || "", source: "整份文件" });
        },
      );
    });
  }

  function runMagiAnalysis(mode, label) {
    showMagiWindow({ state: "loading", title: label, source: "正在讀取目前文件…" });
    collectMagiText(async function (input) {
      if (!input.text.trim()) {
        updateMagiWindow({
          state: "error",
          title: label,
          text: "目前文件沒有可供 MAGI 分析的文字。",
        });
        return;
      }
      const bridge = await reloadMagiBridgeConfig();
      if (!bridge?.url || !bridge?.token) {
        updateMagiWindow({
          state: "error",
          title: label,
          text: "請先開啟「全能文件工作台」，再重新執行 MAGI 文件分析。",
        });
        return;
      }
      const bridgeStatus = await verifyMagiBridge(bridge);
      if (!bridgeStatus.ok) {
        updateMagiWindow({
          state: "error",
          title: label,
          text: bridgeStatus.message,
        });
        return;
      }
      updateMagiWindow({
        state: "loading",
        title: label,
        source: `${input.source}・正在交給本機 MAGI V2／V3…`,
      });
      const controller = new AbortController();
      const timeout = window.setTimeout(function () {
        controller.abort();
      }, 110000);
      try {
        const response = await window.fetch(bridge.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bridge.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: input.text,
            mode,
            instruction: "",
            document_title: plugin.info?.documentTitle || "目前文件",
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || !result.ok || !result.reply?.text) {
          throw new Error(result.error || `MAGI 橋接回應 ${response.status}`);
        }
        updateMagiWindow({
          state: "done",
          title: label,
          source: input.source,
          text: result.reply.text,
          version: String(result.reply.compatibility_version || "").toUpperCase(),
          model: result.reply.model || "",
          degraded: Boolean(result.reply.degraded),
        });
      } catch (error) {
        updateMagiWindow({
          state: "error",
          title: label,
          text:
            error?.name === "AbortError"
              ? "MAGI 分析逾時，請稍後再試。"
              : error?.name === "TypeError" ||
                  /failed to fetch|networkerror|load failed/i.test(String(error?.message || error))
                ? magiBridgeConnectionMessage()
                : `MAGI 分析失敗：${error?.message || error}`,
        });
      } finally {
        window.clearTimeout(timeout);
      }
    });
  }

  function focusEditor() {
    plugin.executeMethod("FocusEditor", []);
  }

  function replaceSelection(text) {
    window.Asc.scope.replacementParagraphs = text.split("\n");
    plugin.callCommand(
      function () {
        return Api.ReplaceTextSmart(Asc.scope.replacementParagraphs);
      },
      false,
      true,
      focusEditor,
    );
  }

  function transformSelectionOrSentence(transform, unchangedMessage) {
    plugin.executeMethod("GetSelectedText", [selectedTextOptions], function (selectedText) {
      if (selectedText) {
        const transformed = transform(selectedText);
        if (transformed === selectedText) {
          showMessage(unchangedMessage);
          return;
        }
        replaceSelection(transformed);
        return;
      }
      plugin.executeMethod("GetCurrentSentence", [], function (sentence) {
        if (!sentence) {
          showMessage("請先選取文字，或把游標放在要整理的句子內。");
          return;
        }
        const transformed = transform(sentence);
        if (transformed === sentence) {
          showMessage(unchangedMessage);
          return;
        }
        plugin.executeMethod("ReplaceCurrentSentence", [transformed, "entirely"], focusEditor);
      });
    });
  }

  function runDistributedLayout(mode, callback, preclearResult) {
    window.Asc.scope.openDeskDistributedLayoutMode = String(mode || "selection");
    if (!preclearResult) {
      plugin.callCommand(
        function () {
          try {
            const document = Api.GetDocument();
            const customProperties = document.GetCustomProperties?.();
            let markerIds = new Set();
            try {
              const stored = customProperties?.Get?.(
                "OpenDeskTW.DistributedParagraphs",
              );
              const markers = stored ? JSON.parse(stored) : [];
              markerIds = new Set(
                (Array.isArray(markers) ? markers : [])
                  .map(function (marker) {
                    return marker?.id;
                  })
                  .filter(function (id) {
                    return id !== undefined && id !== null && id !== "";
                  })
                  .map(String),
              );
            } catch (_error) {
              markerIds = new Set();
            }
            let paragraphs;
            if (Asc.scope.openDeskDistributedLayoutMode === "markers") {
              paragraphs = document.GetAllParagraphs().filter(function (paragraph) {
                return markerIds.has(String(paragraph.GetParaId?.() || ""));
              });
            } else {
              const selection = document.GetRangeBySelect();
              paragraphs = selection?.GetAllParagraphs?.() || [];
              if (!paragraphs.length) {
                const current = document.GetCurrentParagraph?.();
                paragraphs = current ? [current] : [];
              }
            }
            let clearedRuns = 0;
            function clearDirectRunSpacing(container) {
              const elementCount = Number(container?.GetElementsCount?.() || 0);
              for (let index = 0; index < elementCount; index += 1) {
                const element = container.GetElement?.(index);
                if (!element) continue;
                if (
                  element.GetClassType?.() === "run" &&
                  typeof element.SetSpacing === "function"
                ) {
                  element.SetSpacing(0);
                  clearedRuns += 1;
                } else {
                  clearDirectRunSpacing(element);
                }
              }
            }
            paragraphs.forEach(function (paragraph) {
              paragraph.SetJc?.("left");
              const internalId = paragraph.GetInternalId?.();
              const nativeParagraph = internalId
                ? AscCommon?.Ne?.Ug?.(internalId)
                : paragraph.Paragraph;
              nativeParagraph?.Vt?.(
                typeof AscCommon !== "undefined" &&
                  Number.isFinite(AscCommon.align_Left)
                  ? AscCommon.align_Left
                  : 0,
              );
              clearDirectRunSpacing(paragraph);
              paragraph.SetSpacing?.(0);
            });
            document.ForceRecalculate?.();
            return {
              applied: paragraphs.length,
              clearedRuns,
              completed: true,
            };
          } catch (error) {
            return {
              applied: 0,
              clearedRuns: 0,
              completed: false,
              error: `${error?.name || "Error"}: ${error?.message || error}`,
            };
          }
        },
        false,
        true,
        function (result) {
          const completed = result || { completed: true, clearedRuns: 0 };
          runDistributedLayout(
            mode,
            function (layoutResult) {
              if (layoutResult && typeof layoutResult === "object") {
                layoutResult.preclearedRuns = Number(
                  completed.clearedRuns || 0,
                );
                if (!layoutResult.error && completed.error) {
                  layoutResult.error = completed.error;
                }
              }
              callback?.(layoutResult);
            },
            completed,
          );
        },
      );
      return;
    }
    plugin.callCommand(
      function () {
        try {
          const document = Api.GetDocument();
          const customProperties = document.GetCustomProperties?.();
          let markers = [];
          try {
            const stored = customProperties?.Get?.(
              "OpenDeskTW.DistributedParagraphs",
            );
            markers = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(markers)) markers = [];
          } catch (_error) {
            markers = [];
          }
          const markerIds = new Set(
            markers
              .map(function (marker) {
                return marker?.id;
              })
              .filter(function (id) {
                return id !== undefined && id !== null && id !== "";
              })
              .map(String),
          );
          let paragraphs;
          if (Asc.scope.openDeskDistributedLayoutMode === "markers") {
            paragraphs = document.GetAllParagraphs().filter(function (paragraph) {
              return markerIds.has(String(paragraph.GetParaId?.() || ""));
            });
          } else {
            const selection = document.GetRangeBySelect();
            paragraphs = selection?.GetAllParagraphs?.() || [];
            if (!paragraphs.length) {
              const current = document.GetCurrentParagraph?.();
              paragraphs = current ? [current] : [];
            }
          }
          if (!paragraphs.length) {
            return {
              applied: 0,
              appliedRanges: 0,
              markerCount: markerIds.size,
              dynamic: true,
            };
          }

          const nativeDistributed =
            typeof AscCommon !== "undefined" &&
            Number.isFinite(AscCommon.align_Distributed)
              ? AscCommon.align_Distributed
              : 4;
          const logicDocument = document.Document;
          function nativeParagraphFor(paragraph) {
            const internalId = paragraph.GetInternalId?.();
            const registeredParagraph = internalId
              ? AscCommon?.Ne?.Ug?.(internalId)
              : undefined;
            if (registeredParagraph) return registeredParagraph;
            if (paragraph.Paragraph) return paragraph.Paragraph;
            return Object.values(paragraph).find(function (candidate) {
              return (
                candidate &&
                (typeof candidate.Vt === "function" ||
                  Array.isArray(candidate.Lines))
              );
            });
          }
          function horizontalFrame(candidate) {
            if (!candidate) return null;
            const start = Number(candidate.X);
            const end = Number(candidate.XLimit);
            if (
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              end <= start
            ) {
              return null;
            }
            return { start, end, width: end - start };
          }
          function tableLayoutFor(paragraph, internal) {
            let cell = null;
            try {
              cell = paragraph.GetParentTableCell?.() || null;
            } catch (_error) {
              cell = null;
            }
            if (!cell) {
              return { cell: null, frame: null };
            }

            // 未壓縮 SDK 可直接從段落或儲存格內容取得 X/XLimit；
            // 正式桌面版可能會壓縮內部欄位名稱，因此這只是快速、精確
            // 的第一順位。讀不到時，後面的不換行二分搜尋仍會由排版結果
            // 反推出儲存格能容納的最大字距。
            const nativeCell = cell.Wb;
            let apiContent = null;
            try {
              apiContent = cell.GetContent?.() || null;
            } catch (_error) {
              apiContent = null;
            }
            const nativeContent =
              nativeCell?.Content ||
              nativeCell?.aa ||
              apiContent?.Document ||
              apiContent?.gd ||
              null;
            const frames = [
              horizontalFrame(internal),
              horizontalFrame(nativeContent),
              horizontalFrame(nativeContent?.Pages?.[0]),
            ].filter(Boolean);
            if (typeof nativeCell?.GetPageContentFrame === "function") {
              try {
                const frame = horizontalFrame(
                  nativeCell.GetPageContentFrame(0),
                );
                if (frame) frames.push(frame);
              } catch (_error) {
                // 跨頁表格可能尚未建立第 0 頁框架；交由其他候選或
                // 排版回縮處理。
              }
            }
            const frame = frames.reduce(function (smallest, candidate) {
              if (!smallest || candidate.width < smallest.width) {
                return candidate;
              }
              return smallest;
            }, null);
            return { cell, frame };
          }
          function ensureNumericParagraphId(paragraph) {
            let id = paragraph.GetParaId?.();
            if (!id && typeof paragraph.SetParaId === "function") {
              // ONLYOFFICE 9.4 的 SetParaId 僅接受數字。全新未命名文件的
              // 空白段落尚未配置 ID；舊版在這裡傳入八位十六進位字串，
              // 因而拋出「ParaId must be a numerical」。ONLYOFFICE 9.4
              // 進一步限制為 1..0x7fffffff，讓 SDK 儲存時自行序列化為
              // OOXML 的八位十六進位 paraId。
              id = Math.floor(Math.random() * 0x7fffffff) + 1;
              paragraph.SetParaId(id);
              id = paragraph.GetParaId?.() || id;
            }
            return id;
          }
          function apiOffsetForPosition(internal, contentPosition) {
            if (!contentPosition) return null;
            const classes =
              internal.GetClassesByPos?.(contentPosition) ||
              internal.soa?.(contentPosition) ||
              [];
            const targetRun =
              internal.GetClassByPos?.(contentPosition) ||
              classes[classes.length - 1];
            const checkRunContent =
              internal.CheckRunContent || internal.hu;
            if (!targetRun || typeof checkRunContent !== "function") {
              return null;
            }
            const depth =
              contentPosition.GetDepth?.() ??
              contentPosition.Tc?.();
            const runPosition =
              typeof depth === "number"
                ? (contentPosition.Get?.(depth) ??
                  contentPosition.Ce?.(depth))
                : undefined;
            if (!Number.isFinite(runPosition)) return null;
            let offset = 0;
            let first = true;
            let result = null;
            checkRunContent.call(internal, function (run) {
              if (result !== null) return;
              if (!first) offset += 1;
              first = false;
              if (run === targetRun) {
                result = offset + runPosition;
                return;
              }
              offset += run.Content?.length || run.aa?.length || 0;
            });
            return result;
          }
          let clearedRuns = 0;
          function clearDirectRunSpacing(container) {
            const elementCount = Number(container?.GetElementsCount?.() || 0);
            for (let index = 0; index < elementCount; index += 1) {
              const element = container.GetElement?.(index);
              if (!element) continue;
              if (
                element.GetClassType?.() === "run" &&
                typeof element.SetSpacing === "function"
              ) {
                element.SetSpacing(0);
                clearedRuns += 1;
              } else {
                clearDirectRunSpacing(element);
              }
            }
          }

          // Word 的 wdAlignParagraphDistribute 不是固定字距，而是把每一行
          // 的字元依該行當下可用寬度重新分布。ONLYOFFICE 9.4 雖保留核心值
          // 4，畫面仍按靠左排版；上一輪的備援字距會切成直接格式 Run，
          // 必須逐一清除後才能以縮排、欄寬或視窗的新寬度取得自然文字寬度。
          paragraphs.forEach(function (paragraph) {
            ensureNumericParagraphId(paragraph);
            paragraph.SetJc?.("left");
            nativeParagraphFor(paragraph)?.Vt?.(
              typeof AscCommon !== "undefined" &&
                Number.isFinite(AscCommon.align_Left)
                ? AscCommon.align_Left
                : 0,
            );
            clearDirectRunSpacing(paragraph);
            paragraph.SetSpacing?.(0);
            const paragraphTextLength = Array.from(
              paragraph.GetText?.() || "",
            ).length;
            if (paragraphTextLength > 0) {
              paragraph
                .GetRange(0, paragraphTextLength)
                ?.SetSpacing(0);
            }
          });
          document.ForceRecalculate?.();

          const jobs = [];
          const spacingByParagraph = new Map();
          const naturalLineCountByParagraph = new Map();
          const tableParagraphs = new Set();
          let lineCount = 0;
          let skipped = 0;
          let tableConstrainedRanges = 0;
          paragraphs.forEach(function (paragraph) {
            const internal = nativeParagraphFor(paragraph);
            const tableLayout = tableLayoutFor(paragraph, internal);
            if (tableLayout.cell) tableParagraphs.add(paragraph);
            // ONLYOFFICE 的非壓縮 SDK 使用 Lines/Ranges/X/XEnd/W；
            // 9.4 桌面正式版會把同一欄位壓縮為 Xb/Of/ha/tB/Da，
            // 兩種名稱都依實際物件讀取，避免把版本名稱誤當固定版面。
            const lines = internal?.Lines || internal?.Xb || [];
            naturalLineCountByParagraph.set(paragraph, lines.length);
            lineCount += lines.length;
            lines.forEach(function (line, lineIndex) {
              (line.Ranges || line.Of || []).forEach(function (layoutRange, rangeIndex) {
                const getStartRangePosition =
                  internal.Get_StartRangePos2 || internal.BBa;
                const getEndRangePosition =
                  internal.Get_EndRangePos2 || internal.yBa;
                const startPosition = getStartRangePosition?.call(
                  internal,
                  lineIndex,
                  rangeIndex,
                );
                const endPosition = getEndRangePosition?.call(
                  internal,
                  lineIndex,
                  rangeIndex,
                  false,
                );
                const start = apiOffsetForPosition(internal, startPosition);
                const end = apiOffsetForPosition(internal, endPosition);
                const rangeStart = Number(
                  layoutRange.X ?? layoutRange.ha,
                );
                const rangeEnd = Number(
                  layoutRange.XEnd ?? layoutRange.tB,
                );
                let availableWidth =
                  rangeEnd - rangeStart;
                if (
                  tableLayout.frame &&
                  Number.isFinite(rangeStart) &&
                  tableLayout.frame.end > rangeStart
                ) {
                  const cellAvailableWidth =
                    tableLayout.frame.end - rangeStart;
                  if (
                    cellAvailableWidth > 0 &&
                    cellAvailableWidth < availableWidth
                  ) {
                    availableWidth = cellAvailableWidth;
                    tableConstrainedRanges += 1;
                  }
                }
                const occupiedWidth = Number(
                  layoutRange.W ?? layoutRange.Da,
                );
                if (
                  !Number.isFinite(start) ||
                  !Number.isFinite(end) ||
                  end - start < 2 ||
                  !Number.isFinite(availableWidth) ||
                  !Number.isFinite(occupiedWidth) ||
                  availableWidth <= occupiedWidth
                ) {
                  skipped += 1;
                  return;
                }
                const measuredRange = paragraph.GetRange(start, end);
                const text = measuredRange?.GetText?.() || "";
                const glyphCount = Array.from(text).filter(function (character) {
                  return (
                    character !== "\r" &&
                    character !== "\n" &&
                    character !== "\t"
                  );
                }).length;
                if (glyphCount < 2) {
                  skipped += 1;
                  return;
                }
                const distributableWidth = availableWidth - occupiedWidth;
                // ONLYOFFICE 最後仍要把 mm 字距量化成整數 twips。若直接
                // 四捨五入到理論上的滿寬，混合中英文或數字時各字寬的
                // 累積誤差可能多出不到 1 mm，卻足以把最後一字換到下一行。
                // 保留極小且隨行寬變動的安全邊界，視覺上仍是滿寬分布，
                // 但不會越過右邊界。
                const layoutSafetyMm = Math.min(
                  0.8,
                  Math.max(0.25, availableWidth * 0.004),
                  distributableWidth * 0.25,
                );
                const spacingMm =
                  (distributableWidth - layoutSafetyMm) /
                  (glyphCount - 1);
                const spacingTwips = Math.max(
                  0,
                  Math.floor((spacingMm * 1440) / 25.4),
                );
                if (!spacingTwips) {
                  skipped += 1;
                  return;
                }
                jobs.push({
                  paragraph,
                  start,
                  end: end - 1,
                  spacing: spacingTwips,
                  initialSpacing: spacingTwips,
                  availableWidth,
                  occupiedWidth,
                  glyphCount,
                  inTable: Boolean(tableLayout.cell),
                });
              });
            });
          });
          jobs.forEach(function (job) {
            job.paragraph
              .GetRange(job.start, job.end)
              ?.SetSpacing(job.spacing);
            const key = String(job.paragraph.GetParaId?.() || "");
            if (!spacingByParagraph.has(key)) {
              spacingByParagraph.set(key, new Set());
            }
            spacingByParagraph.get(key).add(job.spacing);
          });

          const nativeLeft =
            typeof AscCommon !== "undefined" &&
            Number.isFinite(AscCommon.align_Left)
              ? AscCommon.align_Left
              : 0;
          paragraphs.forEach(function (paragraph) {
            const nativeParagraph = nativeParagraphFor(paragraph);
            // 表格內若同時使用核心 distribute(4) 與畫面備援字距，
            // ONLYOFFICE 9.4 會把同一寬度分配兩次，造成末字突出或整段
            // 垂直換行。表格畫面保持 left 並只套動態字距；儲存 DOCX
            // 時橋接仍寫入標準 w:jc="distribute"，Word 會自行依儲存格
            // 的實際內寬分布。
            nativeParagraph?.Vt?.(
              tableParagraphs.has(paragraph)
                ? nativeLeft
                : nativeDistributed,
            );
          });
          document.ForceRecalculate?.();
          logicDocument?.Kc?.();
          logicDocument?.Ue?.();
          logicDocument?.td?.();

          // 字型 fallback 或壓縮版 SDK 無法提供儲存格 XLimit 時，實際
          // advance width 只能在第二次排版後確定。若新增了換行，就在
          // 0..原計算字距間做二分搜尋，找出仍維持自然行數的最大字距。
          // 這相當於由排版器直接量出目前欄寬，也涵蓋窄欄、合併儲存格、
          // 儲存格內距與段落縮排，不依賴固定值。
          let wrapCorrections = 0;
          function hasAddedWrap(paragraph) {
            const internal = nativeParagraphFor(paragraph);
            const currentLines = internal?.Lines || internal?.Xb || [];
            return (
              currentLines.length >
              Number(naturalLineCountByParagraph.get(paragraph) || 0)
            );
          }
          const adaptiveStates = new Map();
          paragraphs.forEach(function (paragraph) {
            if (hasAddedWrap(paragraph)) {
              adaptiveStates.set(paragraph, {
                low: 0,
                high: 1,
                scale: 1,
              });
            }
          });
          for (let attempt = 0; attempt < 11 && adaptiveStates.size; attempt += 1) {
            adaptiveStates.forEach(function (state, paragraph) {
              if (hasAddedWrap(paragraph)) {
                state.high = state.scale;
              } else {
                state.low = state.scale;
              }
              state.scale = (state.low + state.high) / 2;
              jobs
                .filter(function (job) {
                  return job.paragraph === paragraph;
                })
                .forEach(function (job) {
                  job.spacing = Math.max(
                    0,
                    Math.floor(job.initialSpacing * state.scale),
                  );
                  job.paragraph
                    .GetRange(job.start, job.end)
                    ?.SetSpacing(job.spacing);
                });
              wrapCorrections += 1;
            });
            document.ForceRecalculate?.();
          }
          adaptiveStates.forEach(function (state, paragraph) {
            jobs
              .filter(function (job) {
                return job.paragraph === paragraph;
              })
              .forEach(function (job) {
                // low 是已驗證不會新增換行的一側；再退 1 twip，避免
                // 不同縮放倍率下的邊界量化把最後一字推到下一行。
                job.spacing = Math.max(
                  0,
                  Math.floor(job.initialSpacing * state.low) - 1,
                );
                job.paragraph
                  .GetRange(job.start, job.end)
                  ?.SetSpacing(job.spacing);
              });
          });
          if (adaptiveStates.size) document.ForceRecalculate?.();

          // 僅記錄最後實際存在於文件中的字距，供儲存橋接移除畫面
          // 備援格式；二分搜尋的中間值不會寫入 DOCX。
          spacingByParagraph.clear();
          jobs.forEach(function (job) {
            const key = String(job.paragraph.GetParaId?.() || "");
            if (!spacingByParagraph.has(key)) {
              spacingByParagraph.set(key, new Set());
            }
            if (job.spacing > 0) {
              spacingByParagraph.get(key).add(job.spacing);
            }
          });

          // 留下段落 ID 與本次 ONLYOFFICE 畫面備援字距。桌面橋接會在
          // DOCX 中移除這些暫時字距，只保留 Word 標準 distribute，
          // 所以 Word 會依自己的版面寬度重新計算，不會變成固定值。
          if (customProperties) {
            const markerById = new Map(
              markers
                .filter(function (marker) {
                  return marker && marker.id !== undefined;
                })
                .map(function (marker) {
                  return [String(marker.id), marker];
                }),
            );
            paragraphs.forEach(function (paragraph) {
              const id = ensureNumericParagraphId(paragraph);
              if (!id) return;
              const key = String(id);
              const marker = markerById.get(key) || { id };
              marker.id = id;
              marker.text = paragraph.GetText?.().trim() || "";
              marker.layout = "word-paragraph-width";
              marker.dynamicSpacings = Array.from(
                new Set(
                  (Array.isArray(marker.dynamicSpacings)
                    ? marker.dynamicSpacings
                    : []
                  )
                    .filter(function (value) {
                      return Number.isFinite(Number(value)) && Number(value) > 0;
                    })
                    .map(Number)
                    .concat(
                      Array.from(spacingByParagraph.get(key) || []),
                  ),
                ),
              ).slice(-64);
              marker.renderedRanges = jobs
                .filter(function (job) {
                  return job.paragraph === paragraph;
                })
                .map(function (job) {
                  return {
                    start: job.start,
                    end: job.end,
                    available: job.availableWidth,
                    occupiedNatural: job.occupiedWidth,
                    glyphs: job.glyphCount,
                    spacing: job.spacing,
                  };
                });
              markerById.set(key, marker);
            });
            const nextMarkers = Array.from(markerById.values()).slice(-500);
            const nextStored = JSON.stringify(nextMarkers);
            const previousStored = customProperties.Get(
              "OpenDeskTW.DistributedParagraphs",
            );
            if (nextStored !== previousStored) {
              customProperties.Add(
                "OpenDeskTW.DistributedParagraphs",
                nextStored,
              );
            }
            markers = nextMarkers;
          }

          return {
            applied: paragraphs.length,
            appliedRanges: jobs.length,
            skipped,
            lines: lineCount,
            markerCount: markers.length,
            dynamic: true,
            method: "word-paragraph-width",
            implementation: "word-layout-ranges-v3",
            clearedRuns,
            wrapCorrections,
            adaptiveSearches: adaptiveStates.size,
            tableParagraphs: tableParagraphs.size,
            tableConstrainedRanges,
            value: nativeDistributed,
            spacings: Array.from(
              new Set(
                jobs.map(function (job) {
                  return job.spacing;
                }),
              ),
            ),
            widths: jobs.slice(0, 20).map(function (job) {
              return {
                available: job.availableWidth,
                occupiedBefore: job.occupiedWidth,
                glyphs: job.glyphCount,
                spacing: job.spacing,
              };
            }),
          };
        } catch (error) {
          return {
            applied: 0,
            appliedRanges: 0,
            error: `${error?.name || "Error"}: ${error?.message || error}`,
          };
        }
      },
      false,
      true,
      callback,
    );
  }

  function applyDistributedAlignment() {
    if (distributedLayoutTimer) {
      window.clearTimeout(distributedLayoutTimer);
      distributedLayoutTimer = null;
    }
    distributedLayoutRefreshQueued = false;
    if (distributedLayoutBusy) return;
    distributedLayoutBusy = true;
    runDistributedLayout(
      "selection",
      function (result) {
        distributedLayoutBusy = false;
        window.__OpenDeskTwDistributedLayout = result;
        if (result?.error) {
          showMessage(`分散對齊發生錯誤：${result.error}`);
        } else if (!result?.appliedRanges) {
          showMessage(
            "目前段落沒有至少兩個可分散的字元，或版面寬度尚未完成計算。",
          );
        }
        focusEditor();
        if (distributedLayoutRefreshQueued) {
          distributedLayoutRefreshQueued = false;
          scheduleDistributedLayoutRefresh(500);
        }
      },
    );
  }

  function restoreDistributedAlignment(focusAfter, attempt) {
    if (distributedLayoutBusy) {
      distributedLayoutRefreshQueued = true;
      return;
    }
    distributedLayoutBusy = true;
    runDistributedLayout("markers", function (result) {
      distributedLayoutBusy = false;
      window.__OpenDeskTwDistributedLayout = result;
      if (
        result?.markerCount &&
        !result?.appliedRanges &&
        Number(attempt || 0) < 4
      ) {
        const nextAttempt = Number(attempt || 0) + 1;
        window.setTimeout(function () {
          restoreDistributedAlignment(false, nextAttempt);
        }, 250 * 2 ** Number(attempt || 0));
      } else if (distributedLayoutRefreshQueued) {
        distributedLayoutRefreshQueued = false;
        scheduleDistributedLayoutRefresh(500);
      }
      if (focusAfter !== false) focusEditor();
    });
  }

  function scheduleDistributedLayoutRefresh(delay) {
    if (distributedLayoutTimer) window.clearTimeout(distributedLayoutTimer);
    distributedLayoutTimer = window.setTimeout(function () {
      distributedLayoutTimer = null;
      if (distributedLayoutBusy) {
        distributedLayoutRefreshQueued = true;
        return;
      }
      restoreDistributedAlignment(false, 0);
    }, Number(delay || 250));
  }

  function refreshDistributedParagraphAfterTyping() {
    if (distributedLayoutBusy) return;
    distributedLayoutBusy = true;
    plugin.callCommand(
      function () {
        try {
          const document = Api.GetDocument();
          const paragraph = document.GetCurrentParagraph?.();
          const customProperties = document.GetCustomProperties?.();
          if (!paragraph || !customProperties) {
            return { applied: false, reason: "no-current-paragraph" };
          }
          let markers = [];
          try {
            const stored = customProperties.Get(
              "OpenDeskTW.DistributedParagraphs",
            );
            markers = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(markers)) markers = [];
          } catch (_error) {
            markers = [];
          }
          const paragraphId = String(paragraph.GetParaId?.() || "");
          const marker = markers.find(function (candidate) {
            return String(candidate?.id ?? "") === paragraphId;
          });
          if (!marker) return { applied: false, reason: "not-distributed" };

          const currentText = paragraph.GetText?.() || "";
          const normalizedText = currentText.trim();
          if (normalizedText === String(marker.text || "")) {
            return { applied: false, reason: "text-unchanged" };
          }
          const renderedRanges = Array.isArray(marker.renderedRanges)
            ? marker.renderedRanges
            : [];
          // 跨多行段落的每行寬度可能不同，仍交由版面尺寸變動時的完整
          // 重排處理。打字中的即時修正專注於 Word 最常見的單行與表格欄位。
          if (renderedRanges.length !== 1) {
            return { applied: false, reason: "multiple-layout-ranges" };
          }
          const previousRange = renderedRanges[0];
          const previousSpacing = Number(previousRange.spacing || 0);
          const previousGlyphs = Number(previousRange.glyphs || 0);
          const availableWidth = Number(previousRange.available);
          if (
            !Number.isFinite(previousSpacing) ||
            previousSpacing < 0 ||
            !Number.isFinite(previousGlyphs) ||
            previousGlyphs < 2 ||
            !Number.isFinite(availableWidth) ||
            availableWidth <= 0
          ) {
            return { applied: false, reason: "invalid-layout-marker" };
          }

          const characters = Array.from(currentText);
          const visiblePositions = [];
          characters.forEach(function (character, index) {
            if (
              character !== "\r" &&
              character !== "\n" &&
              character !== "\t"
            ) {
              visiblePositions.push(index);
            }
          });
          const glyphCount = visiblePositions.length;
          if (glyphCount < 2) {
            return { applied: false, reason: "not-enough-glyphs" };
          }

          const internalId = paragraph.GetInternalId?.();
          const internal =
            (internalId ? AscCommon?.Ne?.Ug?.(internalId) : null) ||
            paragraph.Paragraph ||
            Object.values(paragraph).find(function (candidate) {
              return (
                candidate &&
                (Array.isArray(candidate.Lines) ||
                  Array.isArray(candidate.Xb))
              );
            });
          const lines = internal?.Lines || internal?.Xb || [];
          let occupiedWidth = 0;
          lines.forEach(function (line) {
            (line.Ranges || line.Of || []).forEach(function (layoutRange) {
              const width = Number(layoutRange.W ?? layoutRange.Da);
              if (Number.isFinite(width) && width > 0) {
                occupiedWidth += width;
              }
            });
          });
          if (!Number.isFinite(occupiedWidth) || occupiedWidth <= 0) {
            return { applied: false, reason: "layout-not-ready" };
          }

          // 目前排版寬度仍包含上一版直接字距。先從量測結果扣掉舊的
          // gap 總寬，就能得到新增／刪除文字後的自然字寬；接著一次把
          // 新字距覆寫到目前段落。過程不清零、不做中間重排，因此不會
          // 出現整行先縮回再展開的抖動。
          const previousSpacingMm = (previousSpacing * 25.4) / 1440;
          const previousGapWidth =
            previousSpacingMm * Math.max(0, previousGlyphs - 1);
          const occupiedNatural = Math.max(
            0,
            occupiedWidth - previousGapWidth,
          );
          const distributableWidth = availableWidth - occupiedNatural;
          if (distributableWidth <= 0) {
            return { applied: false, reason: "text-exceeds-width" };
          }
          const layoutSafetyMm = Math.min(
            0.8,
            Math.max(0.25, availableWidth * 0.004),
            distributableWidth * 0.25,
          );
          const spacingMm =
            (distributableWidth - layoutSafetyMm) / (glyphCount - 1);
          const spacingTwips = Math.max(
            0,
            Math.floor((spacingMm * 1440) / 25.4),
          );
          if (!spacingTwips) {
            return { applied: false, reason: "no-distributable-spacing" };
          }

          const lastVisiblePosition =
            visiblePositions[visiblePositions.length - 1];
          paragraph
            .GetRange(0, lastVisiblePosition)
            ?.SetSpacing(spacingTwips);
          document.ForceRecalculate?.();

          marker.text = normalizedText;
          marker.renderedRanges = [
            {
              start: 0,
              end: lastVisiblePosition,
              available: availableWidth,
              occupiedNatural,
              glyphs: glyphCount,
              spacing: spacingTwips,
            },
          ];
          marker.dynamicSpacings = Array.from(
            new Set(
              (Array.isArray(marker.dynamicSpacings)
                ? marker.dynamicSpacings
                : []
              )
                .filter(function (value) {
                  return Number.isFinite(Number(value)) && Number(value) > 0;
                })
                .map(Number)
                .concat([spacingTwips]),
            ),
          ).slice(-64);
          customProperties.Add(
            "OpenDeskTW.DistributedParagraphs",
            JSON.stringify(markers.slice(-500)),
          );
          const linesAfter =
            internal?.Lines || internal?.Xb || [];
          return {
            applied: true,
            method: "in-place-current-paragraph",
            glyphs: glyphCount,
            spacing: spacingTwips,
            occupiedNatural,
            available: availableWidth,
            linesBefore: lines.length,
            linesAfter: linesAfter.length,
          };
        } catch (error) {
          return {
            applied: false,
            error: `${error?.name || "Error"}: ${error?.message || error}`,
          };
        }
      },
      false,
      true,
      function (result) {
        distributedLayoutBusy = false;
        window.__OpenDeskTwDistributedTyping = result;
        if (distributedLayoutRefreshQueued) {
          distributedLayoutRefreshQueued = false;
          scheduleDistributedLayoutRefresh(500);
        }
      },
    );
  }

  function scheduleDistributedTypingRefresh(event) {
    if (event?.isComposing) return;
    const key = String(event?.key || "");
    if (
      [
        "Shift",
        "Control",
        "Meta",
        "Alt",
        "CapsLock",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "Escape",
      ].includes(key)
    ) {
      return;
    }
    if (distributedTypingTimer) {
      window.clearTimeout(distributedTypingTimer);
    }
    distributedTypingTimer = window.setTimeout(function () {
      distributedTypingTimer = null;
      refreshDistributedParagraphAfterTyping();
    }, 0);
  }

  function installDistributedLayoutRefresh(hostWindow) {
    try {
      if (!hostWindow) return false;
      const stateKey = "__OpenDeskTwDistributedLayoutHook";
      const previous = hostWindow[stateKey];
      if (previous) {
        hostWindow.removeEventListener?.("resize", previous.refresh);
        // 清除 2.0.1 曾經在每次打字與普通點擊後觸發全文件重排的
        // 舊監聽器。它會先把字距清零再套回，正是持續抖動的來源。
        hostWindow.document?.removeEventListener?.(
          "pointerup",
          previous.refresh,
          true,
        );
        hostWindow.document?.removeEventListener?.(
          "keyup",
          previous.refresh,
          true,
        );
        hostWindow.document?.removeEventListener?.(
          "keyup",
          previous.typingKeyup,
          true,
        );
        hostWindow.document?.removeEventListener?.(
          "pointerdown",
          previous.pointerDown,
          true,
        );
        hostWindow.document?.removeEventListener?.(
          "pointermove",
          previous.pointerMove,
          true,
        );
        hostWindow.document?.removeEventListener?.(
          "pointerup",
          previous.pointerUp,
          true,
        );
      }
      const refresh = function () {
        scheduleDistributedLayoutRefresh(500);
      };
      let dragState = null;
      function isLayoutResizeTarget(event) {
        const target = event?.target;
        if (!target) return false;
        let cursor = "";
        try {
          cursor = String(hostWindow.getComputedStyle?.(target)?.cursor || "");
        } catch (_error) {
          cursor = "";
        }
        if (/resize|col-resize|row-resize/i.test(cursor)) return true;
        const className = String(
          typeof target.className === "string"
            ? target.className
            : target.className?.baseVal || "",
        );
        return /ruler|resize|resizer|splitter/i.test(className);
      }
      const pointerDown = function (event) {
        dragState = {
          x: Number(event?.clientX || 0),
          y: Number(event?.clientY || 0),
          layoutResize: isLayoutResizeTarget(event),
          moved: false,
        };
      };
      const pointerMove = function (event) {
        if (!dragState) return;
        const x = Number(event?.clientX || 0);
        const y = Number(event?.clientY || 0);
        if (
          Math.abs(x - dragState.x) >= 5 ||
          Math.abs(y - dragState.y) >= 5
        ) {
          dragState.moved = true;
        }
        if (isLayoutResizeTarget(event)) {
          dragState.layoutResize = true;
        }
      };
      const pointerUp = function () {
        const shouldRefresh =
          Boolean(dragState?.layoutResize) && Boolean(dragState?.moved);
        dragState = null;
        if (shouldRefresh) scheduleDistributedLayoutRefresh(500);
      };
      const typingKeyup = function (event) {
        scheduleDistributedTypingRefresh(event);
      };
      hostWindow.addEventListener?.("resize", refresh);
      hostWindow.document?.addEventListener?.("keyup", typingKeyup, true);
      hostWindow.document?.addEventListener?.(
        "pointerdown",
        pointerDown,
        true,
      );
      hostWindow.document?.addEventListener?.(
        "pointermove",
        pointerMove,
        true,
      );
      hostWindow.document?.addEventListener?.("pointerup", pointerUp, true);
      hostWindow[stateKey] = {
        guid: plugin.guid,
        refresh,
        pointerDown,
        pointerMove,
        pointerUp,
        typingKeyup,
        mode: "resize-and-layout-drag-only",
        keyupMode: "in-place-current-paragraph",
      };
      return true;
    } catch (_error) {
      return false;
    }
  }

  function applyTraditionalFont(fontName) {
    window.Asc.scope.traditionalFontName = String(fontName);
    plugin.callCommand(
      function () {
        const name = Asc.scope.traditionalFontName;
        if (!name) return false;
        const document = Api.GetDocument();
        let range = document.GetRangeBySelect();
        if (range?.GetText?.()) {
          range.SetFontFamily(name);
          return name;
        }
        if (
          typeof Asc !== "undefined" &&
          Asc.editor &&
          typeof Asc.editor.put_TextPrFontName === "function"
        ) {
          Asc.editor.put_TextPrFontName(name);
          return name;
        }
        range = document.GetRangeBySelect();
        if (!range || !range.GetText()) {
          document.SelectCurrentWord();
          range = document.GetRangeBySelect();
        }
        if (!range) return false;
        range.SetFontFamily(name);
        return name;
      },
      false,
      true,
      function (applied) {
        if (!applied) {
          showMessage("目前游標位置無法套用字型。");
        }
        focusEditor();
      },
    );
  }

  function copyFormatting() {
    plugin.callCommand(
      function () {
        const logicDocument = Api.GetDocument()?.Document;
        if (!logicDocument || typeof logicDocument.Dne !== "function") return false;
        logicDocument.Dne();
        return true;
      },
      false,
      false,
      function (copied) {
        wordFormatClipboardReady = Boolean(copied);
        window.__OpenDeskTwFormatClipboard = {
          ready: wordFormatClipboardReady,
          copiedAt: wordFormatClipboardReady ? Date.now() : null,
        };
        if (!copied) showMessage("這個編輯器版本無法複製目前選取範圍的格式。");
        focusEditor();
      },
    );
  }

  function pasteFormatting() {
    plugin.callCommand(
      function () {
        const logicDocument = Api.GetDocument()?.Document;
        const copied = logicDocument?.yb?.ocb?.();
        if (!copied || typeof logicDocument?.Cl?.DT !== "function") return false;
        const canGroupHistory =
          typeof AscDFH !== "undefined" &&
          typeof AscDFH.FPg !== "undefined" &&
          typeof logicDocument.Cd === "function" &&
          typeof logicDocument.td === "function";
        if (canGroupHistory) logicDocument.Cd(AscDFH.FPg);
        logicDocument.Cl.DT(copied);
        logicDocument.Kc?.();
        logicDocument.sj?.();
        logicDocument.rq?.();
        if (canGroupHistory) logicDocument.td();
        return true;
      },
      false,
      true,
      function (pasted) {
        window.__OpenDeskTwFormatPaste = {
          ok: Boolean(pasted),
          pastedAt: pasted ? Date.now() : null,
        };
        if (!pasted) {
          showMessage(
            "尚未複製格式；請先選取來源文字並按 Ctrl+Shift+C，macOS 也可按 ⇧⌘C。",
          );
        }
        focusEditor();
      },
    );
  }

  function runRepeatableWordAction(action) {
    lastWordAction = action;
    action();
  }

  function repeatLastWordAction() {
    if (!lastWordAction) {
      showMessage("目前沒有可重複的全能文件操作。");
      focusEditor();
      return;
    }
    lastWordAction();
  }

  function clearParagraphFormatting() {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const range = document.GetRangeBySelect();
        let paragraphs = range?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        paragraphs.forEach(function (paragraph) {
          // Reapplying the paragraph's existing style is the closest Document API
          // equivalent to Word Ctrl+Q: direct paragraph overrides are removed
          // without changing Heading 1, Quote, Normal, or character formatting.
          const style = paragraph.GetStyle?.() || paragraph.GetParaPr?.()?.GetStyle?.();
          if (style) {
            paragraph.SetStyle(style);
            return;
          }
          paragraph.SetJc?.("left");
          paragraph.SetIndLeft?.(0);
          paragraph.SetIndRight?.(0);
          paragraph.SetIndFirstLine?.(0);
          paragraph.SetSpacingBefore?.(0, false);
          paragraph.SetSpacingAfter?.(0, false);
          paragraph.SetSpacingLine?.(240, "auto");
          paragraph.SetTabs?.([]);
        });
        return paragraphs.length;
      },
      false,
      true,
      focusEditor,
    );
  }

  function titleCaseLatinText(value) {
    return value.replace(/\b([\p{L}])([\p{L}\p{M}'’-]*)/gu, function (_, first, rest) {
      return first.toLocaleUpperCase() + rest.toLocaleLowerCase();
    });
  }

  function nextWordCase(value) {
    const cased = Array.from(value).filter(function (character) {
      return character.toLocaleLowerCase() !== character.toLocaleUpperCase();
    });
    if (!cased.length) return value;
    if (value === value.toLocaleUpperCase()) return titleCaseLatinText(value);
    if (value === titleCaseLatinText(value)) return value.toLocaleLowerCase();
    return value.toLocaleUpperCase();
  }

  function toggleSelectionCase() {
    plugin.executeMethod("GetSelectedText", [selectedTextOptions], function (selectedText) {
      if (!selectedText) {
        plugin.executeMethod("GetCurrentWord", [], function (word) {
          if (!word) {
            showMessage("請先選取英文文字，或把游標放在英文單字內。");
            return;
          }
          plugin.executeMethod("ReplaceCurrentWord", [nextWordCase(word), "entirely"], focusEditor);
        });
        return;
      }
      replaceSelection(nextWordCase(selectedText));
    });
  }

  function insertAutomaticPageNumber() {
    plugin.callCommand(
      function () {
        const paragraph = Api.GetDocument().GetCurrentParagraph?.();
        if (!paragraph?.AddPageNumber) return false;
        paragraph.AddPageNumber();
        return true;
      },
      false,
      true,
      function (inserted) {
        if (!inserted) showMessage("目前位置無法插入自動頁碼欄位。");
        focusEditor();
      },
    );
  }

  function insertCurrentDateOrTime(kind) {
    const now = new Date();
    const value =
      kind === "time"
        ? new Intl.DateTimeFormat("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(now)
        : new Intl.DateTimeFormat("zh-TW", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(now);
    plugin.executeMethod("InputText", [value], focusEditor);
  }

  function showFontDialog(hostWindow) {
    plugin.executeMethod("GetFontList", [], function (fonts) {
      const suggested = traditionalFonts[0].name;
      const requested = String(
        hostWindow?.prompt?.("輸入字型名稱：", suggested) || "",
      ).trim();
      if (!requested) {
        focusEditor();
        return;
      }
      const known = Array.isArray(fonts)
        ? fonts.some(function (font) {
            const name = String(font?.name || font?.Name || font || "");
            return name.toLocaleLowerCase() === requested.toLocaleLowerCase();
          })
        : true;
      if (!known) {
        showMessage(`目前編輯器字型清單找不到「${requested}」。`);
        focusEditor();
        return;
      }
      const sizeInput = String(hostWindow?.prompt?.("輸入字級（pt）：", "12") || "").trim();
      const size = Number(sizeInput);
      if (!Number.isFinite(size) || size < 1 || size > 300) {
        showMessage("字級必須是 1 到 300 的數字。");
        focusEditor();
        return;
      }
      window.Asc.scope.wordFontDialog = { name: requested, size };
      plugin.callCommand(
        function () {
          const document = Api.GetDocument();
          let range = document.GetRangeBySelect();
          if (!range || !range.GetText?.()) {
            document.SelectCurrentWord?.();
            range = document.GetRangeBySelect();
          }
          if (!range) return false;
          range.SetFontFamily?.(Asc.scope.wordFontDialog.name);
          range.SetFontSize?.(Asc.scope.wordFontDialog.size);
          return true;
        },
        false,
        true,
        focusEditor,
      );
    });
  }

  function showFontSizeDialog(hostWindow) {
    const requested = String(hostWindow?.prompt?.("輸入字級（pt）：", "12") || "").trim();
    const size = Number(requested);
    if (!Number.isFinite(size) || size < 1 || size > 300) {
      showMessage("字級必須是 1 到 300 的數字。");
      focusEditor();
      return;
    }
    runRepeatableWordAction(function () {
      applyNumericFontSize(size);
    });
  }

  function goToPageOrBookmark(hostWindow) {
    const request = String(
      hostWindow?.prompt?.("輸入頁碼或書籤名稱：", "1") || "",
    ).trim();
    if (!request) {
      focusEditor();
      return;
    }
    window.Asc.scope.wordGoToRequest = request;
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const request = Asc.scope.wordGoToRequest;
        if (/^\d+$/.test(request)) {
          const page = Math.max(0, Number(request) - 1);
          return { ok: Boolean(document.GoToPage?.(page)), kind: "page" };
        }
        const bookmark = document.GetBookmark?.(request);
        return { ok: Boolean(bookmark?.GoTo?.()), kind: "bookmark" };
      },
      false,
      false,
      function (result) {
        if (!result?.ok) {
          showMessage(
            /^\d+$/.test(request)
              ? "找不到指定頁碼。"
              : `找不到書籤「${request}」。`,
          );
        }
        focusEditor();
      },
    );
  }

  function insertFootnoteOrEndnote(kind) {
    window.Asc.scope.wordNoteKind = kind;
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const note =
          Asc.scope.wordNoteKind === "endnote"
            ? document.AddEndnote?.()
            : document.AddFootnote?.();
        if (!note) return false;
        const first = note.GetElement?.(0) || note.GetCurrentParagraph?.();
        first?.AddText?.("");
        return true;
      },
      false,
      true,
      function (inserted) {
        if (!inserted) showMessage("目前位置無法插入註腳／尾註。");
        focusEditor();
      },
    );
  }

  function updateDocumentFields() {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        document.UpdateAllFields?.();
        document.UpdateAllTOC?.();
        document.UpdateAllTOF?.();
        return true;
      },
      false,
      true,
      focusEditor,
    );
  }

  function applyLineSpacing(multiplier) {
    window.Asc.scope.wordLineSpacing = Math.round(Number(multiplier) * 240);
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const range = document.GetRangeBySelect();
        let paragraphs = range?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        paragraphs.forEach(function (paragraph) {
          paragraph.SetSpacingLine(Asc.scope.wordLineSpacing, "auto");
        });
        return paragraphs.length;
      },
      false,
      true,
      focusEditor,
    );
  }

  function toggleVerticalAlignment(alignment) {
    window.Asc.scope.wordVerticalAlignment = alignment;
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        let range = document.GetRangeBySelect();
        if (!range || !range.GetText()) {
          document.SelectCurrentWord();
          range = document.GetRangeBySelect();
        }
        if (!range) return false;
        const current = range.GetTextPr()?.GetVertAlign?.() || "baseline";
        range.SetVertAlign(
          current === Asc.scope.wordVerticalAlignment
            ? "baseline"
            : Asc.scope.wordVerticalAlignment,
        );
        return true;
      },
      false,
      true,
      focusEditor,
    );
  }

  function adjustHangingIndent(direction) {
    window.Asc.scope.wordHangingIndentDirection = Number(direction);
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const range = document.GetRangeBySelect();
        let paragraphs = range?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        paragraphs.forEach(function (paragraph) {
          const left = Number(paragraph.GetIndLeft?.() || 0);
          const first = Number(paragraph.GetIndFirstLine?.() || 0);
          if (Asc.scope.wordHangingIndentDirection > 0) {
            paragraph.SetIndLeft(left + 720);
            paragraph.SetIndFirstLine(first > -720 ? -720 : first);
          } else {
            const nextLeft = Math.max(0, left - 720);
            paragraph.SetIndLeft(nextLeft);
            paragraph.SetIndFirstLine(nextLeft === 0 ? 0 : Math.min(first, -720));
          }
        });
        return paragraphs.length;
      },
      false,
      true,
      focusEditor,
    );
  }

  function applyParagraphStyle(styleName) {
    window.Asc.scope.wordParagraphStyle = styleName;
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const style = document.GetStyle(Asc.scope.wordParagraphStyle);
        const range = document.GetRangeBySelect();
        let paragraphs = range?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        if (!style) return 0;
        paragraphs.forEach(function (paragraph) {
          paragraph.SetStyle(style);
        });
        return paragraphs.length;
      },
      false,
      true,
      focusEditor,
    );
  }

  function toggleTrackRevisions() {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const enabled = !document.IsTrackRevisions();
        document.SetTrackRevisions(enabled);
        return enabled;
      },
      false,
      true,
      function (enabled) {
        showMessage(enabled ? "已開啟追蹤修訂。" : "已關閉追蹤修訂。");
        focusEditor();
      },
    );
  }

  function addNativeComment(hostWindow) {
    try {
      const controller = hostWindow?.DE?.getController?.("DocumentHolder");
      if (controller?.addComment) {
        controller.addComment();
        return true;
      }
    } catch (_) {
      // Fall through to the documented plugin method.
    }
    showMessage("目前編輯器無法開啟原生註解輸入框；請使用「校閱 → 新增註解」。");
    return false;
  }

  function renumberHeadingsInDocument() {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const paragraphs = document.GetAllParagraphs();
        const counters = [0, 0, 0, 0, 0];
        const financialDigits = ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"];
        const commonDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
        function chineseNumber(value, financial) {
          const digits = financial ? financialDigits : commonDigits;
          if (value < 10) return digits[value];
          if (value < 20) return `${financial ? "拾" : "十"}${value % 10 ? digits[value % 10] : ""}`;
          if (value < 100) {
            const tens = `${digits[Math.floor(value / 10)]}${financial ? "拾" : "十"}`;
            return `${tens}${value % 10 ? digits[value % 10] : ""}`;
          }
          return String(value);
        }
        function headingMatch(text) {
          const patterns = [
            [1, /^\s*([壹貳參肆伍陸柒捌玖拾佰]+)、/],
            [1, /^\s*[〔【\[]([壹貳參肆伍陸柒捌玖拾佰]+)、[〕】\]]/],
            [2, /^\s*([一二三四五六七八九十百]+)、/],
            [2, /^\s*[〔【\[]([一二三四五六七八九十百]+)、[〕】\]]/],
            [3, /^\s*[（(]([一二三四五六七八九十百]+)[）)]/],
            [3, /^\s*[〔【\[]([一二三四五六七八九十百]+)[〕】\]]/],
            [4, /^\s*(\d+)[.．、]/],
          ];
          for (let index = 0; index < patterns.length; index += 1) {
            const match = String(text || "").match(patterns[index][1]);
            if (match) return { level: patterns[index][0], match: match };
          }
          return null;
        }
        let changed = 0;
        const preview = [];
        paragraphs.forEach(function (paragraph) {
          const text = paragraph.GetText({ Numbering: false, ParaSeparator: "" });
          const heading = headingMatch(text);
          if (!heading) return;
          counters[heading.level] += 1;
          for (let level = heading.level + 1; level <= 4; level += 1) counters[level] = 0;
          const next =
            heading.level === 1
              ? chineseNumber(counters[heading.level], true)
              : heading.level < 4
                ? chineseNumber(counters[heading.level], false)
                : String(counters[heading.level]);
          const oldPrefix = heading.match[0];
          const newPrefix = oldPrefix.replace(heading.match[1], next);
          const prefixRange = paragraph.GetRange(0, oldPrefix.length);
          if (!prefixRange) return;
          prefixRange.Delete();
          const insertion = paragraph.GetRange(0, 0);
          if (!insertion || !insertion.AddText(newPrefix, "before")) return;
          const style = document.GetStyle(`Heading ${heading.level}`);
          if (style) paragraph.SetStyle(style);
          if (preview.length < 4) preview.push(`${oldPrefix.trim()} → ${newPrefix.trim()}`);
          changed += 1;
        });
        return { changed: changed, preview: preview };
      },
      false,
      true,
      function (result) {
        if (!result?.changed) {
          showMessage("沒有在段落開頭找到「壹、」、「一、」、「（一）」或「1.」等標題；內文中的相同文字不會處理。");
        } else {
          showMessage(
            `已在目前文件安全重編 ${result.changed} 個標題並套用標題樣式。\n${result.preview.join("\n")}\n可按 Ctrl／⌘+Z 一次復原。`,
          );
        }
        focusEditor();
      },
    );
  }

  function insertContextualQuote(input) {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const paragraph = document.GetCurrentParagraph?.();
        const internal = paragraph?.Paragraph;
        const caretPosition = internal?.Get_ParaContentPos?.(false, false);
        if (!paragraph || !internal || !caretPosition) return "";

        const targetRun = internal.GetClassByPos?.(caretPosition);
        const depth = caretPosition.GetDepth?.();
        const runPosition =
          typeof depth === "number" ? caretPosition.Get(depth) : undefined;
        if (!targetRun || !internal.CheckRunContent || !Number.isFinite(runPosition)) {
          return "";
        }

        let offset = 0;
        let first = true;
        let caretOffset = null;
        internal.CheckRunContent(function (run) {
          if (caretOffset !== null) return;
          if (!first) offset += 1;
          first = false;
          if (run === targetRun) {
            caretOffset = offset + runPosition;
            return;
          }
          offset += run.Content?.length || 0;
        });
        if (!Number.isFinite(caretOffset) || caretOffset <= 0) return "";
        return paragraph.GetRange(0, caretOffset)?.GetText?.() || "";
      },
      false,
      false,
      function (paragraphTextBefore) {
        if (paragraphTextBefore) {
          insertContextualQuoteFromText(paragraphTextBefore, input);
          return;
        }
        plugin.executeMethod("GetCurrentSentence", ["before"], function (sentenceTextBefore) {
          insertContextualQuoteFromText(sentenceTextBefore, input);
        });
      },
    );
  }

  function insertContextualQuoteFromText(textBefore, input) {
    const replacement = window.OpenDeskTwTypography.smartQuoteForContext(
      textBefore || "",
      input,
    );
    plugin.executeMethod("InputText", [replacement || input], focusEditor);
  }

  function installWordCompatibilityShortcuts(hostWindow) {
    try {
      if (!hostWindow?.document) return false;
      const stateKey = "__OpenDeskTwWordShortcuts";
      const previous = hostWindow[stateKey];
      if (previous?.handler) {
        hostWindow.document.removeEventListener("keydown", previous.handler, true);
        hostWindow.removeEventListener?.("keydown", previous.handler, true);
      }
      const handler = function (event) {
        if (!event || event.repeat || event.isComposing) return;
        const target = event.target;
        if (
          target &&
          (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "") || target.isContentEditable)
        ) return;
        const rawKey = String(event.key || "");
        const key = rawKey.toLowerCase();
        const command = event.ctrlKey || event.metaKey;
        // Word 的格式複製／套用在 Windows 是 Ctrl+Shift+C/V，在 macOS
        // 是 Command+Shift+C/V。也接受使用者在 Mac 上按實體 Control，
        // 並保留既有的 Ctrl/Command+Option 備援組合。
        const wordFormatShortcut =
          (event.ctrlKey &&
            !event.metaKey &&
            ((event.shiftKey && !event.altKey) ||
              (event.altKey && !event.shiftKey))) ||
          (event.metaKey &&
            !event.ctrlKey &&
            ((event.shiftKey && !event.altKey) ||
              (event.altKey && !event.shiftKey)));
        let action = null;
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          ['"', "'", "”", "’", "」", "』"].includes(rawKey)
        ) {
          action = function () {
            insertContextualQuote(rawKey);
          };
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          event.shiftKey &&
          (key === "f3" || event.code === "F3")
        ) {
          action = function () {
            runRepeatableWordAction(toggleSelectionCase);
          };
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          (key === "f4" || event.code === "F4")
        ) {
          action = repeatLastWordAction;
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          (key === "f5" || event.code === "F5")
        ) {
          action = function () {
            goToPageOrBookmark(hostWindow);
          };
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          (key === "f9" || event.code === "F9")
        ) {
          action = updateDocumentFields;
        } else if (
          event.altKey &&
          event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          ["d", "p", "t"].includes(key)
        ) {
          action = function () {
            runRepeatableWordAction(function () {
              if (key === "p") insertAutomaticPageNumber();
              else insertCurrentDateOrTime(key === "t" ? "time" : "date");
            });
          };
        } else if (command && event.shiftKey && !event.altKey && (key === "j" || event.code === "KeyJ")) {
          action = function () {
            runRepeatableWordAction(applyDistributedAlignment);
          };
        } else if (command && event.shiftKey && event.altKey && (key === "r" || event.code === "KeyR")) {
          action = function () {
            runRepeatableWordAction(renumberHeadingsInDocument);
          };
        } else if (
          (key === "c" || event.code === "KeyC") &&
          wordFormatShortcut
        ) {
          action = copyFormatting;
        } else if (
          (key === "v" || event.code === "KeyV") &&
          wordFormatShortcut &&
          (event.altKey || wordFormatClipboardReady)
        ) {
          action = pasteFormatting;
        } else if (
          ((event.ctrlKey && !event.metaKey && !event.altKey) ||
            (event.metaKey && !event.ctrlKey && !event.altKey)) &&
          !event.shiftKey &&
          key === "d"
        ) {
          action = function () {
            showFontDialog(hostWindow);
          };
        } else if (
          command &&
          event.shiftKey &&
          !event.altKey &&
          (key === "f" || key === "p")
        ) {
          action = function () {
            if (key === "p") showFontSizeDialog(hostWindow);
            else showFontDialog(hostWindow);
          };
        } else if (
          ((event.ctrlKey && !event.metaKey && (key === "d" || key === "f")) ||
            (event.metaKey && !event.ctrlKey && (key === "e" || key === "f"))) &&
          event.altKey &&
          !event.shiftKey
        ) {
          action = function () {
            runRepeatableWordAction(function () {
              insertFootnoteOrEndnote(key === "d" || key === "e" ? "endnote" : "footnote");
            });
          };
        } else if (command && !event.shiftKey && !event.altKey && ["1", "2", "5"].includes(key)) {
          action = function () {
            runRepeatableWordAction(function () {
              applyLineSpacing(key === "5" ? 1.5 : Number(key));
            });
          };
        } else if (command && event.altKey && !event.shiftKey && ["1", "2", "3"].includes(key)) {
          action = function () {
            runRepeatableWordAction(function () {
              applyParagraphStyle(`Heading ${key}`);
            });
          };
        } else if (command && event.shiftKey && !event.altKey && key === "n") {
          action = function () {
            runRepeatableWordAction(function () {
              applyParagraphStyle("Normal");
            });
          };
        } else if (
          key === "q" &&
          !event.shiftKey &&
          ((event.ctrlKey && !event.metaKey && !event.altKey) ||
            (event.metaKey && !event.ctrlKey && event.altKey))
        ) {
          action = function () {
            runRepeatableWordAction(clearParagraphFormatting);
          };
        } else if (command && event.shiftKey && !event.altKey && key === "e") {
          action = toggleTrackRevisions;
        } else if (
          command &&
          event.shiftKey &&
          !event.altKey &&
          (key === "+" || event.code === "Equal")
        ) {
          action = function () {
            runRepeatableWordAction(function () {
              toggleVerticalAlignment("superscript");
            });
          };
        } else if (
          command &&
          event.shiftKey &&
          !event.altKey &&
          (key === "_" || event.code === "Minus")
        ) {
          action = function () {
            runRepeatableWordAction(function () {
              toggleVerticalAlignment("subscript");
            });
          };
        } else if (command && !event.altKey && key === "t") {
          action = function () {
            runRepeatableWordAction(function () {
              adjustHangingIndent(event.shiftKey ? -1 : 1);
            });
          };
        } else if (
          (event.ctrlKey && event.altKey && !event.shiftKey && key === "m") ||
          (event.metaKey && event.altKey && !event.shiftKey && key === "a")
        ) {
          action = function () {
            addNativeComment(hostWindow);
          };
        }
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        action();
      };
      // macOS 的原生選單與 ONLYOFFICE 編輯器會在 document 之前處理
      // 快捷鍵；同時掛在 window capture，讓解除 AppKit 顏色面板衝突後
      // 的 ⇧⌘C／⇧⌘V 能在編輯器自己的色彩命令之前被接管。
      hostWindow.addEventListener?.("keydown", handler, true);
      hostWindow.document.addEventListener("keydown", handler, true);
      hostWindow[stateKey] = {
        guid: plugin.guid,
        handler: handler,
        windowCapture: true,
        applyDistributedAlignment: applyDistributedAlignment,
        applyTraditionalFont: applyTraditionalFont,
        insertContextualQuote: insertContextualQuote,
      };
      return true;
    } catch (_) {
      return false;
    }
  }

  function applyNumericFontSize(size) {
    window.Asc.scope.numericFontSize = Number(size);
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        let range = document.GetRangeBySelect();
        if (!range || range.GetText() === "") {
          document.SelectCurrentWord();
          range = document.GetRangeBySelect();
        }
        if (!range) return false;
        range.SetFontSize(Asc.scope.numericFontSize);
        return true;
      },
      false,
      true,
      focusEditor,
    );
  }

  function completePairedPunctuation() {
    transformSelectionOrSentence(
      window.OpenDeskTwTypography.completePairs,
      "這段文字的括號與引號已經成對，不需要補齊。",
    );
  }

  function normalizeTaiwanPunctuation() {
    transformSelectionOrSentence(
      window.OpenDeskTwTypography.normalizeTaiwanPunctuation,
      "這段文字已符合台灣常用標點，不需要調整。",
    );
  }

  function showShortcuts() {
    showMessage(
      [
        "格式複製：Windows／Linux Ctrl+Shift+C；macOS ⇧⌘C",
        "套用格式：Windows／Linux Ctrl+Shift+V；macOS ⇧⌘V",
        "備援：Ctrl+Alt+C／V；macOS ⌘⌥C／V",
        "清除格式：Ctrl+Space；macOS ⌘+Fn+Space",
        "字級顯示：一律使用 9、10.5、12 等數字，不混用初號、五號等名稱",
        "粗體／斜體／底線：Ctrl／⌘+B、I、U",
        "靠左／置中／左右對齊：Ctrl／⌘+L、E、J",
        "文字等距分布：Windows／Linux Ctrl+Shift+J；macOS ⇧⌘J",
        "智慧下引號：輸入引號時，會依目前尚未閉合的「／『自動選擇」或』",
        "台灣字型：全能文件 → 台灣字型，可直接選新細明體或細明體",
        "行距：Ctrl／⌘+1 單行、+2 雙行、+5 1.5 倍",
        "標題樣式：Ctrl+Alt+1／2／3；macOS ⌘⌥1／2／3",
        "一般樣式：Ctrl／⌘+Shift+N；追蹤修訂：Ctrl／⌘+Shift+E",
        "清除段落直接格式：Windows Ctrl+Q；macOS ⌘⌥Q（保留既有標題樣式）",
        "切換英文大小寫：Shift+F3；重複上一個格式操作：F4；跳頁／書籤：F5",
        "欄位：F9 更新；Alt+Shift+D／T／P 插入日期、時間或自動頁碼",
        "未存草稿：每 15 秒保留富文字快照，可從常用 → 未存草稿復原",
        "新增註解：Windows Ctrl+Alt+M；macOS ⌘⌥A",
        "更多內容請在全能文件工作台開啟「快捷鍵總覽」。",
      ].join("\n"),
    );
  }

  function addTraditionalChineseToolbar() {
    plugin.executeMethod("AddToolbarMenuItem", [
      {
        guid: plugin.guid,
        tabs: [
          {
            id: "home",
            text: "常用",
            items: [
              {
                id: "opendesk-distributed",
                type: "button",
                text: "文字等距分布",
                hint: "像 Word 一樣，將所選段落文字平均攤滿可用寬度（Ctrl+Shift+J／⇧⌘J）",
                lockInViewMode: true,
                icons: "resources/distributed.svg",
              },
              {
                id: "opendesk-complete-pairs",
                type: "button",
                text: "智慧補齊",
                hint: "依巢狀順序補上）、」、】、〕等正確結尾",
                lockInViewMode: true,
                icons: "resources/pairs.svg",
              },
              {
                id: "opendesk-renumber-headings",
                type: "button",
                text: "標題重編",
                hint: "只重編段落開頭的中文標題；內文不處理，Ctrl／⌘+Z 可復原",
                lockInViewMode: true,
                icons: "resources/shortcuts.svg",
              },
              {
                id: "opendesk-home-magi-summary",
                type: "button",
                text: "MAGI 摘要",
                hint: "不離開常用頁籤，直接摘要選取文字或整份文件",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
              {
                id: "opendesk-draft-recovery",
                type: "button",
                text: "未存草稿復原",
                hint: "每 15 秒保留目前記憶體中的富文字草稿；當機後可插入空白文件復原",
                lockInViewMode: false,
                icons: "resources/recovery.svg",
              },
            ],
          },
          {
            id: "opendesk-tw-tab",
            text: "全能文件",
            items: [
              {
                id: "opendesk-normalize-punctuation",
                type: "button",
                text: "台灣標點",
                hint: "整理選取文字或目前句子的引號與中文標點",
                lockInViewMode: true,
                icons: "resources/punctuation.svg",
              },
              {
                id: "opendesk-font-size",
                type: "button",
                text: "數字字級",
                hint: "字級一律顯示為數字；可直接套用常用字級",
                lockInViewMode: true,
                split: false,
                icons: "resources/font-size.svg",
                items: numericFontSizes.map(function (size) {
                  return {
                    id: `opendesk-font-size-${String(size).replace(".", "-")}`,
                    text: String(size),
                    data: String(size),
                  };
                }),
              },
              {
                id: "opendesk-font-family",
                type: "button",
                text: "台灣字型",
                hint: "直接套用新細明體（PMingLiU）或細明體（MingLiU）",
                lockInViewMode: true,
                split: false,
                icons: "resources/font-size.svg",
                items: traditionalFonts.map(function (font) {
                  return {
                    id: `opendesk-font-family-${font.id}`,
                    text: font.text,
                    data: font.name,
                  };
                }),
              },
              {
                id: "opendesk-shortcuts",
                type: "button",
                text: "快捷鍵",
                hint: "顯示格式複製與常用文字快捷鍵",
                lockInViewMode: false,
                icons: "resources/shortcuts.svg",
              },
            ],
          },
          {
            id: "opendesk-magi-tab",
            text: "MAGI",
            items: [
              {
                id: "opendesk-magi-summary",
                type: "button",
                text: "文件摘要",
                hint: "以本機 MAGI 摘要選取文字；未選取時分析整份文件",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
              {
                id: "opendesk-magi-review",
                type: "button",
                text: "校對檢查",
                hint: "找出語句、數字、日期、邏輯與前後矛盾",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
              {
                id: "opendesk-magi-structure",
                type: "button",
                text: "結構分析",
                hint: "檢查標題層級、段落順序與可讀性",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
              {
                id: "opendesk-magi-risk",
                type: "button",
                text: "完整檢查",
                hint: "分析內容、結構、風險與可執行改善建議",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
            ],
          },
        ],
      },
    ]);
  }

  plugin.init = function () {
    window.OpenDeskTwUiPatch?.install?.(window.parent);
    if (plugin.info.editorType !== "word") return;
    installWordCompatibilityShortcuts(window.parent);
    installDistributedPersistenceHook(window.parent);
    installDistributedLayoutRefresh(window.parent);
    if (!toolbarEventsBound) {
      this.attachToolbarMenuClickEvent("opendesk-distributed", applyDistributedAlignment);
      this.attachToolbarMenuClickEvent("opendesk-complete-pairs", completePairedPunctuation);
      this.attachToolbarMenuClickEvent("opendesk-renumber-headings", renumberHeadingsInDocument);
      this.attachToolbarMenuClickEvent("opendesk-home-magi-summary", function () {
        runMagiAnalysis("summary", "MAGI 文件摘要");
      });
      this.attachToolbarMenuClickEvent("opendesk-draft-recovery", showRichDraftRecovery);
      this.attachToolbarMenuClickEvent(
        "opendesk-normalize-punctuation",
        normalizeTaiwanPunctuation,
      );
      this.attachToolbarMenuClickEvent("opendesk-shortcuts", showShortcuts);
      this.attachToolbarMenuClickEvent("opendesk-magi-summary", function () {
        runMagiAnalysis("summary", "MAGI 文件摘要");
      });
      this.attachToolbarMenuClickEvent("opendesk-magi-review", function () {
        runMagiAnalysis("review", "MAGI 校對檢查");
      });
      this.attachToolbarMenuClickEvent("opendesk-magi-structure", function () {
        runMagiAnalysis("structure", "MAGI 結構分析");
      });
      this.attachToolbarMenuClickEvent("opendesk-magi-risk", function () {
        runMagiAnalysis("risk", "MAGI 完整檢查");
      });
      for (const size of numericFontSizes) {
        this.attachToolbarMenuClickEvent(
          `opendesk-font-size-${String(size).replace(".", "-")}`,
          function () {
            applyNumericFontSize(size);
          },
        );
      }
      for (const font of traditionalFonts) {
        this.attachToolbarMenuClickEvent(`opendesk-font-family-${font.id}`, function () {
          applyTraditionalFont(font.name);
        });
      }
      toolbarEventsBound = true;
    }
    addTraditionalChineseToolbar();
    restoreDistributedAlignment();
    scheduleRichDraftSnapshots(window.parent);
    // 已存在的標記會依目前頁面／儲存格／縮排寬度重新排版；存檔時只把
    // Word 標準 w:jc="distribute" 寫回，不保留畫面備援的固定字距。
    scheduleDistributedPersistence(window.parent, 1200, 0);
  };

  plugin.button = function (_id, windowId) {
    if (magiResultWindow && magiResultWindow.id === windowId) {
      magiResultWindow.close();
      magiResultWindow = null;
    }
    if (recoveryWindow && recoveryWindow.id === windowId) {
      recoveryWindow.close();
      recoveryWindow = null;
    }
  };
})(window);
