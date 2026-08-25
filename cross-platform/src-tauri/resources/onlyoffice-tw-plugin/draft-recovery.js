(function (window) {
  "use strict";

  const plugin = window.Asc.plugin;
  const list = document.getElementById("draft-list");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function render(payload) {
    const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
    list.innerHTML = snapshots.length
      ? snapshots
          .map(
            (snapshot) => `
              <article class="draft">
                <div>
                  <b title="${escapeHtml(snapshot.sourcePath || snapshot.title)}">${escapeHtml(snapshot.title || "未命名文件")}</b>
                  <small>${escapeHtml(new Date(Number(snapshot.savedAt || 0)).toLocaleString("zh-TW"))}・${Number(snapshot.characters || 0).toLocaleString("zh-TW")} 字${snapshot.sourcePath ? `・${escapeHtml(snapshot.sourcePath)}` : "・尚未存檔"}</small>
                </div>
                <div class="actions">
                  <button data-delete="${escapeHtml(snapshot.id)}">刪除</button>
                  <button class="primary" data-restore="${escapeHtml(snapshot.id)}">插入復原</button>
                </div>
              </article>`,
          )
          .join("")
      : '<p class="empty">目前沒有可復原的富文字草稿。</p>';
    list.querySelectorAll("[data-restore]").forEach((button) => {
      button.addEventListener("click", () => plugin.sendToPlugin("onRestoreDraft", button.dataset.restore));
    });
    list.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => plugin.sendToPlugin("onDeleteDraft", button.dataset.delete));
    });
  }

  plugin.attachEvent("onDraftSnapshots", render);
  plugin.init = function () {
    plugin.sendToPlugin("onDraftRecoveryReady", {});
  };
  plugin.button = function () {
    plugin.executeCommand("close", "");
  };
})(window);
