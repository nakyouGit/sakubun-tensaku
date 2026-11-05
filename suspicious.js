/**
 * suspicious.js
 * 本文の中の「読み取りが怪しい所」を、決まりで拾う（AI は使わない）。
 * 先生が直す枠で、青い印を付けて「ここを原稿と見比べて」と知らせるための部品。
 * 戻り値: [{ start, end, reason }]（start 以上 end 未満の文字の範囲）
 */
(function (root) {
  'use strict';

  const SMALL_TSU = 'っッ';
  const SMALL_YOON = 'ゃゅょャュョ';
  const SMALL_ALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';
  const YOON_HOST = 'きぎしじちぢにひびぴみりキギシジチヂニヒビピミリ'; // 拗音（ゃゅょ）の前に来る字
  const AFTER_TSU_NG = 'あいうえおアイウエオんンー、。」）！？'; // 促音の次に来にくい字
  const SENTENCE_END = '。」）！？』';
  const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const NUM_CLASS = '[一二三四五六七八九]';
  const DECLARE_VERB = '(?:話|書|伝|紹介|教え|言|説明|発表|お話)';
  const MIN_KATAKANA_LENGTH = 3;

  function checkSmallKana(text, found) {
    const lines = text.split('\n');
    let offset = 0;
    lines.forEach((line) => {
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const prev = i > 0 ? line[i - 1] : '';
        const next = i + 1 < line.length ? line[i + 1] : '';
        const at = offset + i;
        if (SMALL_TSU.includes(ch) && (next === '' || AFTER_TSU_NG.includes(next) || SMALL_ALL.includes(next))) {
          found.push({ start: at, end: at + 1, reason: '「っ」の次の字が不自然（「つ」や別の字の読み違いかも）' });
        } else if (SMALL_YOON.includes(ch) && !YOON_HOST.includes(prev)) {
          found.push({ start: at, end: at + 1, reason: '小さい「ゃゅょ」の前の字が不自然（「や・ゆ・よ」の読み違いかも）' });
        } else if (SMALL_ALL.includes(ch) && !SMALL_TSU.includes(ch) && !SMALL_YOON.includes(ch) && (prev === '' || '、。」（「'.includes(prev))) {
          found.push({ start: at, end: at + 1, reason: '小さい字が文や言葉の頭にある' });
        }
      }
      offset += line.length + 1;
    });
  }

  function checkOrdinals(text, found) {
    const declared = new RegExp('(' + NUM_CLASS + ')つ' + DECLARE_VERB, 'g');
    const ordinal = new RegExp('(' + NUM_CLASS + ')つ目', 'g');
    let declaration = null;
    let match;
    while ((match = declared.exec(text)) !== null) {
      if (!declaration) declaration = { count: KANJI_NUM[match[1]], start: match.index, end: match.index + 2 };
    }
    const ordinals = [];
    while ((match = ordinal.exec(text)) !== null) {
      ordinals.push({ number: KANJI_NUM[match[1]], start: match.index, end: match.index + 3 });
    }
    if (!declaration || ordinals.length === 0) return;
    ordinals.forEach((item) => {
      if (item.number > declaration.count) {
        found.push({ start: item.start, end: item.end, reason: '最初に「' + text.substr(declaration.start, 2) + '」とあるのに、それより大きい番号（「二つ目」の読み違いかも）' });
      }
    });
    for (let n = 1; n <= declaration.count; n++) {
      if (!ordinals.some((item) => item.number === n)) {
        found.push({ start: declaration.start, end: declaration.end, reason: n + '番目の「' + Object.keys(KANJI_NUM).find((k) => KANJI_NUM[k] === n) + 'つ目」が見つからない' });
        break;
      }
    }
  }

  function differsByOne(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
      if (diff > 1) return false;
    }
    return diff === 1;
  }

  function checkKatakanaVariants(text, found) {
    const pattern = new RegExp('[ァ-ヶー]{' + MIN_KATAKANA_LENGTH + ',}', 'g');
    const tokens = [];
    let match;
    while ((match = pattern.exec(text)) !== null) tokens.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    const flagged = new Set();
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        if (differsByOne(tokens[i].word, tokens[j].word)) {
          flagged.add(i);
          flagged.add(j);
        }
      }
    }
    flagged.forEach((index) => {
      const token = tokens[index];
      found.push({ start: token.start, end: token.end, reason: 'カタカナの言葉が、別の所と1字だけ違う（「' + token.word + '」。同じ名前なら書き方をそろえる）' });
    });
  }

  function checkParagraphEnds(text, found) {
    let offset = 0;
    text.split(/\n(?:[ 　\t]*\n)+/).forEach((paragraph) => {
      const start = text.indexOf(paragraph, offset);
      offset = start + paragraph.length;
      const trimmed = paragraph.replace(/\s+$/, '');
      if (trimmed.length === 0) return;
      const last = trimmed[trimmed.length - 1];
      if (!SENTENCE_END.includes(last)) {
        const at = start + trimmed.length - 1;
        found.push({ start: at, end: at + 1, reason: '段落の終わりに「。」が無い（字が抜けたか、続きの文があるかも）' });
      }
    });
  }

  function findSuspicious(text) {
    const source = String(text || '');
    const found = [];
    checkSmallKana(source, found);
    checkOrdinals(source, found);
    checkKatakanaVariants(source, found);
    checkParagraphEnds(source, found);
    return found.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  const api = { findSuspicious: findSuspicious };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunSuspicious = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
