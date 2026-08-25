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
  const quotePairs = {
    "「": "」",
    "『": "』",
    "“": "”",
    "‘": "’",
  };
  const quoteClosers = new Set(Object.values(quotePairs));

  function isLatinWordCharacter(character) {
    return /[A-Za-z0-9]/.test(character || "");
  }

  function quoteStack(text) {
    const stack = [];
    const source = String(text);
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quotePairs[character]) {
        stack.push(character === "“" ? "」" : character === "‘" ? "』" : quotePairs[character]);
      } else if (quoteClosers.has(character) || character === "」" || character === "』") {
        const normalized = character === "”" ? "」" : character === "’" ? "』" : character;
        const matchingIndex = stack.lastIndexOf(normalized);
        if (matchingIndex >= 0) stack.splice(matchingIndex);
      } else if (character === '"') {
        if (stack[stack.length - 1] === "」") stack.pop();
        else stack.push("」");
      } else if (character === "'") {
        const apostrophe =
          isLatinWordCharacter(source[index - 1]) && isLatinWordCharacter(source[index + 1]);
        if (apostrophe) continue;
        if (stack[stack.length - 1] === "』") stack.pop();
        else stack.push("』");
      }
    }
    return stack;
  }

  function smartQuoteForContext(textBefore, input) {
    const before = String(textBefore || "");
    const mark = String(input || "");
    const stack = quoteStack(before);
    const expected = stack[stack.length - 1];
    const previous = Array.from(before).pop() || "";

    if (mark === "「" || mark === "“") return "「";
    if (mark === "『" || mark === "‘") return "『";
    if (mark === '"' || mark === "”" || mark === "」") {
      if (expected) return expected;
      return mark === '"' ? "「" : "」";
    }
    if (mark === "'") {
      if (isLatinWordCharacter(previous)) return mark;
      return expected === "』" ? "』" : "『";
    }
    if (mark === "’" || mark === "』") {
      if (mark === "’" && isLatinWordCharacter(previous)) return mark;
      if (expected) return expected;
      return "』";
    }
    return mark;
  }

  function distributionGlyphCount(text) {
    return Array.from(String(text)).filter(function (character) {
      return character !== "\r" && character !== "\n";
    }).length;
  }

  function calculateDistributedSpacing(rangeWidth, contentWidth, glyphCount) {
    const available = Number(rangeWidth);
    const occupied = Number(contentWidth);
    const count = Number(glyphCount);
    if (
      !Number.isFinite(available) ||
      !Number.isFinite(occupied) ||
      !Number.isFinite(count) ||
      count < 2 ||
      occupied <= 0 ||
      available <= occupied
    ) {
      return 0;
    }
    return (available - occupied) / (count - 1);
  }

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

  function normalizeQuotes(text) {
    const source = String(text);
    let result = "";
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (
        (character === "'" || character === "’") &&
        isLatinWordCharacter(source[index - 1]) &&
        isLatinWordCharacter(source[index + 1])
      ) {
        result += character;
      } else if (character === "“") {
        result += "「";
      } else if (character === "‘") {
        result += "『";
      } else if ('"”」\'’』'.includes(character)) {
        result += smartQuoteForContext(result, character);
      } else {
        result += character;
      }
    }
    return result;
  }

  function normalizeTaiwanPunctuation(text) {
    let result = normalizeQuotes(text);
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

  return {
    calculateDistributedSpacing,
    completePairs,
    distributionGlyphCount,
    normalizeTaiwanPunctuation,
    pairs,
    quoteStack,
    smartQuoteForContext,
  };
});
