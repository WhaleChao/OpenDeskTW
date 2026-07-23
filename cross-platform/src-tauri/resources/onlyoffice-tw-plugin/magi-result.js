(function (window) {
  "use strict";

  const plugin = window.Asc.plugin;
  const title = document.getElementById("title");
  const meta = document.getElementById("meta");
  const loading = document.getElementById("loading");
  const loadingText = document.getElementById("loading-text");
  const result = document.getElementById("result");
  const copy = document.getElementById("copy");
  const copyState = document.getElementById("copy-state");

  function render(payload) {
    const value = payload || {};
    title.textContent = value.title || "MAGI 文件助理";
    copyState.textContent = "";
    result.classList.toggle("error", value.state === "error");
    if (value.state === "loading") {
      loading.classList.remove("hidden");
      loadingText.textContent = value.source || "正在交給本機 MAGI V2／V3…";
      meta.textContent = "分析只經由本機橋接，不會開啟網頁";
      result.textContent = "MAGI 正在分析，完成後結果會顯示在這裡。";
      copy.disabled = true;
      return;
    }
    loading.classList.add("hidden");
    if (value.state === "done") {
      const details = [value.source, value.version, value.model].filter(Boolean).join("・");
      meta.textContent = `${details || "本機 MAGI"}${value.degraded ? "・備援模式" : ""}`;
      result.textContent = value.text || "MAGI 未傳回文字。";
      copy.disabled = !value.text;
      return;
    }
    meta.textContent = "未完成分析";
    result.textContent = value.text || "MAGI 分析失敗。";
    copy.disabled = true;
  }

  copy.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(result.textContent);
      copyState.textContent = "已複製";
    } catch (_error) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(result);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("copy");
      selection.removeAllRanges();
      copyState.textContent = "已複製";
    }
  });

  plugin.init = function () {
    plugin.attachEvent("onMagiResult", render);
    plugin.sendToPlugin("onMagiResultReady");
  };
})(window);
