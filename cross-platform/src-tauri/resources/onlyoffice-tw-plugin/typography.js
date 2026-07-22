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
    let result = "";
    for (const character of String(text)) {
      if (pairs[character]) {
        stack.push(pairs[character]);
        result += character;
      } else if (stack.length && character === stack[stack.length - 1]) {
        stack.pop();
        result += character;
      } else if (closingMarks.has(character)) {
        const matchingIndex = stack.lastIndexOf(character);
        if (matchingIndex >= 0) {
          // 使用者先輸入外層結尾時，必須先補齊尚未關閉的內層符號。
          // 例如「附件【第一項」應修成「附件【第一項】」，不能變成「附件【第一項」】。
          while (stack.length - 1 > matchingIndex) result += stack.pop();
          stack.pop();
        }
        result += character;
      } else {
        result += character;
      }
    }
    return result + stack.reverse().join("");
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
