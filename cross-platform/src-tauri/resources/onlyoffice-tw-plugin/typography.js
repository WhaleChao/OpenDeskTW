(function (root, factory) {
  "use strict";
  const tools = factory();
  if (typeof module === "object" && module.exports) module.exports = tools;
  root.OpenDeskTwTypography = tools;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const pairs = {
    "(": ")",
    "（": "）",
    "[": "]",
    "［": "］",
    "{": "}",
    "｛": "｝",
    "「": "」",
    "『": "』",
    "【": "】",
    "〔": "〕",
    "《": "》",
    "〈": "〉",
    "〖": "〗",
    "〘": "〙",
    "〚": "〛",
    "“": "”",
    "‘": "’",
  };
  const closingMarks = new Set(Object.values(pairs));

  function completePairs(text) {
    const stack = [];
    for (const character of String(text)) {
      if (pairs[character]) {
        stack.push(pairs[character]);
      } else if (stack.length && character === stack[stack.length - 1]) {
        stack.pop();
      } else if (closingMarks.has(character)) {
        const matchingIndex = stack.lastIndexOf(character);
        if (matchingIndex >= 0) stack.splice(matchingIndex, 1);
      }
    }
    return String(text) + stack.reverse().join("");
  }

  function alternatingQuotes(text, expression, opening, closing) {
    let isOpening = true;
    return text.replace(expression, function () {
      const result = isOpening ? opening : closing;
      isOpening = !isOpening;
      return result;
    });
  }

  function normalizeTaiwanPunctuation(text) {
    let result = String(text).replace(/“/g, "「").replace(/”/g, "」").replace(/‘/g, "『").replace(/’/g, "』");
    result = alternatingQuotes(result, /"/g, "「", "」");
    result = result
      .replace(/([\u3400-\u9fff]),(?=[\u3400-\u9fff「『（【〔《〈]|$)/g, "$1，")
      .replace(/([\u3400-\u9fff]):(?=[\u3400-\u9fff「『（【〔《〈]|$)/g, "$1：")
      .replace(/([\u3400-\u9fff]);(?=[\u3400-\u9fff「『（【〔《〈]|$)/g, "$1；")
      .replace(/([\u3400-\u9fff])\?(?=[\u3400-\u9fff」』）】〕》〉]|$)/g, "$1？")
      .replace(/([\u3400-\u9fff])!(?=[\u3400-\u9fff」』）】〕》〉]|$)/g, "$1！")
      .replace(/([\u3400-\u9fff])\.{3}(?=[\u3400-\u9fff」』）】〕》〉]|$)/g, "$1……")
      .replace(/([\u3400-\u9fff])\.(?=[\u3400-\u9fff」』）】〕》〉]|$)/g, "$1。");
    return completePairs(result);
  }

  return { completePairs, normalizeTaiwanPunctuation, pairs };
});
