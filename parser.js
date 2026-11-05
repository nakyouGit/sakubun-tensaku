/**
 * parser.js
 * ジェミニが返した添削済みデータ（JSON）を読み取り、組版に渡せる形に整える。
 * - 出席番号の決め方（用紙の番号を優先、無ければページ番号）と、重なり・抜けの確認
 * - 題名・名前の置き場所（本文の中／欄外）
 * - 心の中の言葉の扱い（短ければ文中、長ければ会話文と同じ）
 * - 会話文の分け直し（かぎかっこのあとに文が続く時は別のブロックにする）
 */
(function (root) {
  'use strict';

  class SakubunInputError extends Error {}

  const BLOCK_TYPES = ['paragraph', 'dialogue', 'after_dialogue'];
  const EDIT_KINDS = ['誤字', '脱字', '意味', '段落', '片仮名', '漢字'];

  /** 漢字の学年の確かめ（kanji.js）。無ければ、学年による既定の判断はしない。 */
  function kanjiModule() {
    if (root.SakubunKanji) return root.SakubunKanji;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') return require('./kanji.js');
    return null;
  }
  const LOCATIONS = ['body', 'margin', 'none'];

  const toAsciiDigits = (text) =>
    String(text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

  /**
   * 貼られた文章から、JSON の値（{ } か [ ]）を順に取り出す。
   * Gem の返事を何回分か続けて貼っても、すべて読み取れるようにする。
   */
  function findJsonValues(rawText) {
    const text = String(rawText).replace(/```[a-zA-Z]*/g, '');
    const values = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch !== '{' && ch !== '[') { i++; continue; }
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') inString = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
          depth--;
          if (depth === 0) { end = j; break; }
        }
      }
      if (end < 0) {
        values.push({ text: text.slice(i), truncated: true });
        break;
      }
      values.push({ text: text.slice(i, end + 1), truncated: false });
      i = end + 1;
    }
    return values;
  }

  const cleanText = (value) =>
    String(value === undefined || value === null ? '' : value)
      .replace(/[\r\n\t]/g, '')
      .replace(/[ 　]+/g, ' ');

  function parseStudentNumber(value) {
    if (value === undefined || value === null) return null;
    const text = toAsciiDigits(value);
    const withBan = text.match(/(\d{1,3})\s*番/);
    const all = text.match(/\d{1,3}/g);
    const picked = withBan ? withBan[1] : all ? all[all.length - 1] : null; // 「2年1組12番」は 12
    return picked ? String(parseInt(picked, 10)) : null;
  }

  function normalizePages(value) {
    if (!Array.isArray(value)) return [];
    return value.map((page) => parseInt(toAsciiDigits(page), 10)).filter((page) => Number.isInteger(page) && page > 0);
  }

  function resolveHeaderItem(label, text, location, warnings) {
    const clean = cleanText(text).trim();
    if (!clean) return { text: '', location: 'none' };
    if (!LOCATIONS.includes(location) || location === 'none') {
      warnings.push(label + 'の場所が分からないため、本文の中に入れました');
      return { text: clean, location: 'body' };
    }
    return { text: clean, location: location };
  }

  // ---- 数字を漢数字に直す ---------------------------------------------
  const KANJI_DIGITS = '〇一二三四五六七八九';
  const UNIT_KANJI = ['', '十', '百', '千'];
  const NUMBER_PATTERN = /[0-9０-９]+(?:[.．,，][0-9０-９]+)*/g;

  const digitsToPositional = (digits) => Array.from(digits).map((d) => KANJI_DIGITS[Number(d)]).join('');

  /** 4桁までの整数を、十二・二十五・百・千二百のように直す。 */
  function digitsToCounting(digits) {
    const value = parseInt(digits, 10);
    if (value === 0) return KANJI_DIGITS[0];
    const padded = String(value).padStart(4, '0');
    let result = '';
    for (let i = 0; i < 4; i++) {
      const digit = Number(padded[i]);
      if (digit === 0) continue;
      const unitIndex = 3 - i;
      result += (digit === 1 && unitIndex > 0 ? '' : KANJI_DIGITS[digit]) + UNIT_KANJI[unitIndex];
    }
    return result;
  }

  function integerToKanji(digits, nextChar, cfg) {
    const isYear = digits.length === 4 && nextChar === '年';
    const keepsLeadingZero = digits.length > 1 && digits[0] === '0';
    if (
      cfg.NUMERAL_STYLE === 'positional' || isYear || keepsLeadingZero ||
      digits.length >= cfg.POSITIONAL_MIN_DIGITS
    ) {
      return digitsToPositional(digits);
    }
    return digitsToCounting(digits);
  }

  /** 文中の算用数字を漢数字に直す。直した所の一覧（before / after）も返す。 */
  function convertNumerals(text, cfg) {
    const changes = [];
    const converted = text.replace(NUMBER_PATTERN, (match, offset, whole) => {
      const ascii = toAsciiDigits(match);
      const nextChar = whole.charAt(offset + match.length);
      let result;
      if (/[.．]/.test(ascii)) {
        const [integerPart, decimalPart] = ascii.split(/[.．]/);
        result = integerToKanji(integerPart, '', cfg) + '・' + digitsToPositional(decimalPart);
      } else {
        result = integerToKanji(ascii.replace(/[,，]/g, ''), nextChar, cfg);
      }
      changes.push({ before: match, after: result, kind: '数字' });
      return result;
    });
    return { text: converted, changes: changes };
  }

  // 文中に残す心の中の言葉の「 」は、会話文と間違えて分けないよう、いったん別の印にする
  const THOUGHT_QUOTE_OPEN_PLACEHOLDER = '\uE000';
  const THOUGHT_QUOTE_CLOSE_PLACEHOLDER = '\uE001';

  function protectInlineThought(text, cfg) {
    return text
      .split(cfg.DIALOGUE_OPEN).join(THOUGHT_QUOTE_OPEN_PLACEHOLDER)
      .split(cfg.DIALOGUE_CLOSE).join(THOUGHT_QUOTE_CLOSE_PLACEHOLDER);
  }

  function restoreThoughtQuotes(text, cfg) {
    return text
      .split(THOUGHT_QUOTE_OPEN_PLACEHOLDER).join(cfg.DIALOGUE_OPEN)
      .split(THOUGHT_QUOTE_CLOSE_PLACEHOLDER).join(cfg.DIALOGUE_CLOSE);
  }

  /** 心の中の言葉のかっこを、設定に合わせてそろえる（児童が書いたかっこで囲まれている時だけ）。 */
  function restyleThought(inner, cfg) {
    const styles = { kagi: ['「', '」'], paren: ['（', '）'] };
    const target = styles[cfg.THOUGHT_BRACKET_STYLE];
    if (!target) return inner;
    const chars = Array.from(inner);
    const first = chars[0];
    const last = chars[chars.length - 1];
    if (chars.length >= 2 && '「（'.includes(first) && '」）'.includes(last)) {
      return target[0] + chars.slice(1, -1).join('') + target[1];
    }
    return inner;
  }

  function stripThoughtMarks(text, cfg) {
    return text.split(cfg.INNER_THOUGHT_OPEN_MARK).join('').split(cfg.INNER_THOUGHT_CLOSE_MARK).join('');
  }

  /**
   * 心の中の言葉（[[ ]] で囲まれた部分）を整える。
   * 決まった字数までは文中に入れ、超えたら会話文と同じように改行して書く。
   */
  function expandInnerThoughts(blocks, cfg) {
    const open = cfg.INNER_THOUGHT_OPEN_MARK;
    const close = cfg.INNER_THOUGHT_CLOSE_MARK;
    const pattern = new RegExp(escapeRegExp(open) + '([\\s\\S]*?)' + escapeRegExp(close), 'g');
    const result = [];
    for (const block of blocks) {
      if (block.type === 'dialogue') {
        result.push({ type: block.type, text: stripThoughtMarks(block.text, cfg) });
        continue;
      }
      let lastEnd = 0;
      let currentType = block.type;
      let pending = '';
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(block.text)) !== null) {
        const inner = restyleThought(match[1], cfg);
        pending += block.text.slice(lastEnd, match.index);
        lastEnd = match.index + match[0].length;
        if (Array.from(inner).length <= cfg.INNER_THOUGHT_INLINE_MAX_CHARS) {
          pending += protectInlineThought(inner, cfg);
        } else {
          if (pending) result.push({ type: currentType, text: pending });
          pending = '';
          result.push({ type: 'dialogue', text: inner });
          currentType = 'after_dialogue';
        }
      }
      pending += block.text.slice(lastEnd);
      pending = stripThoughtMarks(pending, cfg);
      if (pending) result.push({ type: currentType, text: pending });
    }
    return result;
  }

  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** かぎかっこの終わりの位置を探す（かぎの中のかぎにも対応）。見つからなければ -1。 */
  function findDialogueEnd(text, cfg) {
    let depth = 0;
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === cfg.DIALOGUE_OPEN) depth++;
      else if (chars[i] === cfg.DIALOGUE_CLOSE) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * 段落の途中にある会話文（「…。」「…！」「…？」と、文の終わりで閉じるかぎ）を分ける。
   * ジェミニが分け忘れても、会話文が改行されるようにするため。
   * 文の終わりがない「ありがとう」のような言葉の強調は、文中に残す。
   */
  // 「…」のすぐあとに続くと、話した言葉だと分かる言い方（「と思った」は心の中の言葉、「という」は名前や題名にも使うので入れない）
  const SPEECH_VERB_AFTER_QUOTE = /^と[、]?(言|い[っいえわ]|聞|き[いかきくけ]|答|こた|さけ|叫|話|はな|呼|よ[ばびぶべん]|返|かえ|たず|尋|わら|笑|どな|ささや)/;

  function splitSpeechInText(block, cfg) {
    const open = cfg.DIALOGUE_OPEN;
    const close = cfg.DIALOGUE_CLOSE;
    const pieces = [];
    let currentType = block.type;
    let buffer = '';
    let rest = block.text;
    while (rest.length > 0) {
      const start = rest.indexOf(open);
      if (start < 0) break;
      let depth = 0;
      let end = -1;
      for (let i = start; i < rest.length; i++) {
        if (rest[i] === open) depth++;
        else if (rest[i] === close) {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end < 0) break;
      const quoted = rest.slice(start, end + 1);
      const inner = quoted.slice(1, -1);
      const followedBySpeechVerb = SPEECH_VERB_AFTER_QUOTE.test(rest.slice(end + 1));
      if (/[。！？!?]$/.test(inner) || followedBySpeechVerb) {
        buffer += rest.slice(0, start);
        if (buffer) pieces.push({ type: currentType, text: buffer });
        buffer = '';
        pieces.push({ type: 'dialogue', text: quoted });
        currentType = 'after_dialogue';
      } else {
        buffer += rest.slice(0, end + 1);
      }
      rest = rest.slice(end + 1);
    }
    buffer += rest;
    if (buffer) pieces.push({ type: currentType, text: buffer });
    return pieces;
  }

  /** 文の頭の「…」が、話した言葉か（文の終わりで閉じる、または「と言った」などが続く）。 */
  function startsWithSpeech(text, cfg) {
    const chars = Array.from(text);
    const end = findDialogueEnd(text, cfg);
    if (end < 0) return true; // 閉じていないかぎは、会話文として扱い、警告を出す
    const inner = chars.slice(1, end).join('');
    const rest = chars.slice(end + 1).join('');
    return /[。！？!?]$/.test(inner) || SPEECH_VERB_AFTER_QUOTE.test(rest);
  }

  /**
   * 会話文のブロックを、会話文とそのあとの文に分ける。
   * 「A」と言って、「B」→ 会話文A／あとの文／会話文B
   */
  function splitDialogues(blocks, cfg, warnings) {
    const open = cfg.DIALOGUE_OPEN;
    const result = [];
    for (const original of blocks) {
      const block = { type: original.type, text: original.text };
      // 段落の頭の「…」は、話した言葉の時だけ会話文にする（「ぐりとぐら」という本… は段落のまま）
      if (block.type === 'paragraph' && block.text.startsWith(open) && startsWithSpeech(block.text, cfg)) {
        block.type = 'dialogue';
      }

      if (block.type !== 'dialogue') {
        splitSpeechInText(block, cfg).forEach((piece) => result.push(piece));
        continue;
      }
      if (!block.text.startsWith(open)) {
        result.push(block); // 心の中の言葉（（ ）など）はそのまま
        continue;
      }

      let rest = block.text;
      while (rest.length > 0) {
        if (rest.startsWith(open)) {
          const chars = Array.from(rest);
          const end = findDialogueEnd(rest, cfg);
          if (end < 0) {
            warnings.push('かぎかっこが閉じていません: ' + rest.slice(0, 20) + '…');
            result.push({ type: 'dialogue', text: rest });
            break;
          }
          result.push({ type: 'dialogue', text: chars.slice(0, end + 1).join('') });
          rest = chars.slice(end + 1).join('');
        } else {
          const next = rest.indexOf(open);
          const piece = next < 0 ? rest : rest.slice(0, next);
          result.push({ type: 'after_dialogue', text: piece });
          rest = next < 0 ? '' : rest.slice(next);
        }
      }
    }
    return result;
  }

  /** blocks を整える（空を除き、種類を確かめる）。直しは、まだ当てはめない。 */
  function cleanBlocks(rawBlocks, warnings, label) {
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
      throw new SakubunInputError(label + ': 本文（blocks）がありません。');
    }
    const cleaned = [];
    for (const raw of rawBlocks) {
      const text = cleanText(raw && raw.text).trim();
      if (!text) continue;
      let type = raw && raw.type;
      if (!BLOCK_TYPES.includes(type)) {
        warnings.push('ブロックの種類が分からないため、段落として扱いました: ' + text.slice(0, 10) + '…');
        type = 'paragraph';
      }
      cleaned.push({ type: type, text: text });
    }
    if (cleaned.length === 0) throw new SakubunInputError(label + ': 本文が空です。');
    return cleaned;
  }

  /**
   * Gem の「直しの一覧」。before は本文にそのまま入っている言葉、context は before を含む本文の一続きの文字列、
   * after は直した言葉。段落の区切りは本文（blocks）にすでに反映されているため、一覧には記録として残すだけ。
   */
  function normalizeEdits(raw) {
    if (!Array.isArray(raw)) return [];
    const edits = [];
    raw.forEach((item) => {
      const kind = EDIT_KINDS.includes(item && item.kind) ? item.kind : '誤字';
      const before = cleanText(item && item.before);
      const after = cleanText(item && item.after);
      const context = cleanText(item && item.context);
      if (!before) return;
      if (kind !== '段落' && before === after) return;
      edits.push({ id: 'e' + edits.length, kind: kind, before: before, after: after, context: context });
    });
    return edits;
  }

  /** 直しが当たる場所を探す（文脈があれば文脈で、無ければ before だけで）。 */
  function locateEdit(items, edit) {
    const before = edit.before;
    if (edit.context && edit.context.includes(before)) {
      const offset = edit.context.indexOf(before);
      for (let i = 0; i < items.length; i++) {
        const at = items[i].text.indexOf(edit.context);
        if (at >= 0) return [{ item: i, start: at + offset, end: at + offset + before.length }];
      }
    }
    const all = [];
    items.forEach((item, i) => {
      let from = 0;
      let at;
      while ((at = item.text.indexOf(before, from)) >= 0) {
        all.push({ item: i, start: at, end: at + before.length });
        from = at + before.length;
      }
    });
    if (all.length === 1) return all;
    // 文脈が書かれていない時だけ、同じ言葉をすべて同じように直す（文脈があるのに見つからない時は、場所を決めない）
    if (all.length > 1 && !edit.context && Array.from(before).length >= 2) return all;
    return [];
  }

  /**
   * 直しを本文に当てはめる。items: [{type, text}]（先頭は題名）。
   * isApplied(edit) が true の直しだけ反映し、色を付けるための区切り（segments）も返す。
   */
  function applyEdits(items, edits, isApplied) {
    const status = new Map();
    const perItem = items.map(() => []);
    edits.filter((edit) => edit.kind !== '段落').forEach((edit) => {
      const spots = locateEdit(items, edit);
      if (spots.length === 0) {
        status.set(edit.id, { state: 'unresolved', count: 0 });
        return;
      }
      let placed = 0;
      let conflict = false;
      spots.forEach((spot) => {
        const list = perItem[spot.item];
        const clash = list.find((other) => spot.start < other.end && other.start < spot.end);
        if (clash) {
          const same = clash.start === spot.start && clash.end === spot.end && clash.edit.after === edit.after;
          if (!same) conflict = true;
          return;
        }
        list.push({ start: spot.start, end: spot.end, edit: edit });
        placed++;
      });
      status.set(edit.id, { state: placed > 0 ? 'ok' : conflict ? 'overlap' : 'duplicate', count: placed });
    });

    const outItems = items.map((item, i) => {
      const spans = perItem[i].sort((a, b) => a.start - b.start);
      const segments = [];
      let pos = 0;
      spans.forEach((span) => {
        if (span.start > pos) segments.push({ text: item.text.slice(pos, span.start) });
        const applied = !!isApplied(span.edit);
        segments.push({ text: applied ? span.edit.after : span.edit.before, editId: span.edit.id, applied: applied });
        pos = span.end;
      });
      if (pos < item.text.length) segments.push({ text: item.text.slice(pos) });
      return { type: item.type, text: segments.map((x) => x.text).join(''), segments: segments };
    });
    return { items: outItems, status: status };
  }

  const defaultIsApplied = (edit) => edit.defaultApply !== false;

  /**
   * 原文＋直しの一覧から、組版に渡す本文を作る。
   * manual（先生が手で直した本文）があれば、直しは当てはめず、その本文を使う。
   */
  function materialize(essay, cfg, isApplied, manual) {
    const warnings = essay.baseWarnings.slice();
    const source = manual
      ? [{ type: 'title', text: manual.title }].concat(manual.blocks)
      : [{ type: 'title', text: essay.rawTitle }].concat(essay.rawBlocks);
    const applied = applyEdits(source, manual ? [] : essay.edits, isApplied || defaultIsApplied);

    const unresolved = manual ? 0 : essay.edits.filter((e) => e.kind !== '段落' && ['unresolved', 'overlap'].includes((applied.status.get(e.id) || {}).state)).length;
    if (unresolved > 0) warnings.push('本文に当てはめられなかった直しが ' + unresolved + ' 件あります（直す前の言葉が本文と合っていません）');

    const titleItem = applied.items[0];
    const bodyItems = applied.items.slice(1);
    const numeralChanges = [];
    let blocks = splitDialogues(expandInnerThoughts(bodyItems.map((b) => ({ type: b.type, text: b.text })), cfg), cfg, warnings)
      .map((b) => ({ type: b.type, text: restoreThoughtQuotes(b.text, cfg) }));
    let title = titleItem.text;
    if (cfg.CONVERT_NUMERALS) {
      // 縦書きなので、数字は漢数字に直す（題名と本文。名前は直さない）
      const titleResult = convertNumerals(title, cfg);
      title = titleResult.text;
      titleResult.changes.forEach((c) => numeralChanges.push(c));
      blocks = blocks.map((b) => {
        const result = convertNumerals(b.text, cfg);
        result.changes.forEach((c) => numeralChanges.push(c));
        return { type: b.type, text: result.text };
      });
    }
    return Object.assign({}, essay, {
      title: title,
      blocks: blocks,
      segments: { title: titleItem.segments, blocks: bodyItems.map((b) => ({ type: b.type, segments: b.segments })) },
      editStatus: applied.status,
      numeralChanges: numeralChanges,
      manual: !!manual,
      warnings: warnings,
    });
  }

  function normalizeUnsure(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => ({ text: cleanText(item && item.text), note: cleanText(item && item.note) }));
  }

  function normalizeEssay(raw, index, cfg) {
    const label = (index + 1) + '人目';
    if (!raw || typeof raw !== 'object') throw new SakubunInputError(label + ': 読み取れない形です。');
    const warnings = [];

    const sourcePages = normalizePages(raw.sourcePages);
    let studentNumber = parseStudentNumber(raw.studentNumber);
    let numberSource = studentNumber ? 'paper' : 'none';
    if (!studentNumber && cfg.PAGE_NUMBER_FALLBACK && sourcePages.length > 0) {
      studentNumber = String(sourcePages[0]);
      numberSource = 'page';
      warnings.push('用紙に出席番号が読み取れないため、ページ番号 ' + studentNumber + ' を出席番号にしました');
    }
    if (!studentNumber) warnings.push('出席番号が決められません');

    const title = resolveHeaderItem('題名', raw.title, raw.titleLocation, warnings);
    const name = resolveHeaderItem('名前', raw.name, raw.nameLocation, warnings);
    // 名前は用紙に写すだけの文字として扱い、システムでは確かめない（誰の作文かは出席番号で決める）
    if (title.location === 'none' && name.text) name.location = 'margin'; // 題名が無い時は、欄外に名前を出す

    const grade = raw.grade === undefined || raw.grade === null ? null : String(parseInt(toAsciiDigits(raw.grade), 10) || '');
    const edits = normalizeEdits(raw.edits);
    const kanji = kanjiModule();
    if (kanji) kanji.classifyEdits(edits, Number(grade));

    const base = {
      index: index,
      studentNumber: studentNumber,
      numberSource: numberSource,
      sourcePages: sourcePages,
      rawTitle: title.text,
      titleLocation: title.location,
      name: name.text,
      nameLocation: name.location,
      rawBlocks: cleanBlocks(raw.blocks, warnings, label),
      edits: edits,
      unsure: normalizeUnsure(raw.unsure),
      gemNotes: cleanText(raw.gemNotes),
      fromText: !!raw.fromText,
      grade: grade,
      baseWarnings: warnings,
    };
    return materialize(base, cfg, defaultIsApplied, null);
  }

  /** 出席番号の重なりと抜けを調べる。 */
  function checkBatch(essays) {
    const messages = [];
    const seen = new Map();
    for (const essay of essays) {
      if (!essay.studentNumber) continue;
      if (!seen.has(essay.studentNumber)) seen.set(essay.studentNumber, []);
      seen.get(essay.studentNumber).push(essay);
    }
    for (const [number, group] of seen) {
      if (group.length > 1) {
        const note = '出席番号 ' + number + ' が ' + group.length + ' 人分で重なっています。別の児童の作文が混ざっていないか確認してください';
        messages.push(note);
        group.forEach((essay) => essay.warnings.push('出席番号の重なり'));
      }
    }
    // 出席番号が用紙にある作文のすぐ次のページが、番号なし（ページ番号から決めた）なら、続きのページかもしれない
    const byPage = essays.filter((e) => e.sourcePages.length > 0).slice()
      .sort((a, b) => a.sourcePages[0] - b.sourcePages[0]);
    byPage.forEach((essay, i) => {
      const prev = byPage[i - 1];
      if (!prev || essay.numberSource !== 'page' || prev.numberSource !== 'paper') return;
      const prevLast = prev.sourcePages[prev.sourcePages.length - 1];
      if (essay.sourcePages[0] !== prevLast + 1) return;
      messages.push('ページ ' + essay.sourcePages[0] + ' は、出席番号 ' + prev.studentNumber +
        ' の作文の続きかもしれません（番号が書かれていないため、別の児童として読み込まれています）。続きなら、Gem に「題名のないページは前の作文の続き」と伝えて、やり直してください');
      essay.warnings.push('前の出席番号 ' + prev.studentNumber + ' の続きのページかもしれません');
    });
    const hasMultiPage = essays.some((essay) => essay.sourcePages.length > 1);
    const usesPageFallback = essays.some((essay) => essay.numberSource === 'page');
    if (hasMultiPage && usesPageFallback) {
      messages.push('複数ページの作文があるため、ページ番号から決めた出席番号がずれている可能性があります。「ページ番号から」の児童を確認してください');
    }
    const numbers = Array.from(seen.keys()).map(Number).sort((a, b) => a - b);
    if (numbers.length > 1) {
      const missing = [];
      for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n++) {
        if (!seen.has(String(n))) missing.push(n);
      }
      if (missing.length > 0) messages.push('出席番号の抜け: ' + missing.join('、') + '（欠席や未提出なら問題ありません）');
    }
    return messages;
  }

  function listEssays(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.essays)) return data.essays;
    if (data && Array.isArray(data.blocks)) return [data];
    return null;
  }

  // ---- テキスト形式（Gem が返す、先生が直しやすい形） ----------------------
  const TEXT_HEADER = /^={3,}\s*出席番号\s*([^／/\s]*)\s*(?:[／/]\s*ページ\s*([0-9０-９,，、\s]*))?\s*$/;
  const TEXT_FIELD = /^(題名|名前)\s*(?:[（(]\s*(本文|欄外|なし)\s*[）)])?\s*[:：]\s*(.*)$/;
  const TEXT_LOCATION = { '本文': 'body', '欄外': 'margin', 'なし': 'none' };
  const TEXT_NOTE = /^※\s*(直した所|確認)\s*[:：]\s*(.*)$/;
  const TEXT_CONTINUE = /^続きは\s*ページ\s*([0-9０-９]+)/;
  const TEXT_GRADE_LINE = /^学年\s*[:：]\s*([0-9０-９]+)\s*年?\s*$/;
  const TEXT_PROCESSED = /^処理したページ\s*[:：]/;

  /** 日本語の文字どうしの間の空白（分かち書き・行の折り返しで入った空白）を詰める。 */
  const removeSpacesBetweenJapanese = (text) => text.replace(/([^\x00-\x7F])[ \u3000\t]+(?=[^\x00-\x7F])/g, '$1');

  const looksLikeTextFormat = (rawText) => /^={3,}\s*出席番号/m.test(String(rawText));

  /** 「===== 出席番号 12 ／ ページ 3,4」で始まるテキストを、JSON と同じ形の作文の並びに直す。 */
  function parseTextOutput(rawText) {
    // 改行が消えて同じ行に続いて貼られた時のために、見出し・題名・名前・※の前で行を分け直す
    const spread = String(rawText).replace(/\r\n?/g, '\n')
      .replace(/[ \t]*(={3,}\s*出席番号)/g, '\n$1')
      .replace(/[ \t]*((?:題名|名前)\s*[（(]\s*(?:本文|欄外|なし)\s*[）)]\s*[:：])/g, '\n$1')
      .replace(/[ \t]*(※\s*(?:直した所|確認)\s*[:：])/g, '\n$1')
      .replace(/[ \t]*(続きは\s*ページ)/g, '\n$1')
      .replace(/[ \t]*(処理したページ\s*[:：])/g, '\n$1');
    const lines = spread.split('\n').filter((line) => !/^\s*```/.test(line));
    const messages = [];
    let grade = null;
    const essays = [];
    let current = null;
    let bodyOpen = false;
    const continuePages = [];

    const finishParagraph = () => {
      if (current && current.paragraph.length > 0) {
        current.blocks.push({ type: 'paragraph', text: removeSpacesBetweenJapanese(current.paragraph.join('')) });
      }
      if (current) current.paragraph = [];
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      const gradeLine = trimmed.match(TEXT_GRADE_LINE);
      if (gradeLine) { if (!grade) grade = String(parseInt(toAsciiDigits(gradeLine[1]), 10)); return; }
      if (TEXT_PROCESSED.test(trimmed)) return;
      const header = trimmed.match(TEXT_HEADER);
      if (header) {
        finishParagraph();
        const number = header[1] && header[1] !== 'なし' ? header[1] : null;
        const pages = (header[2] || '').split(/[,，、\s]+/).filter(Boolean).map((x) => parseInt(toAsciiDigits(x), 10)).filter((x) => x > 0);
        current = { studentNumber: number, sourcePages: pages, title: '', titleLocation: 'none', name: '', nameLocation: 'none',
          blocks: [], paragraph: [], notes: [], unsure: [] };
        essays.push(current);
        bodyOpen = false;
        return;
      }
      if (!current) {
        const g = trimmed.match(/学年\s*[:：]?\s*([0-9０-９]+)/);
        if (g) grade = String(parseInt(toAsciiDigits(g[1]), 10));
        return;
      }
      const cont = trimmed.match(TEXT_CONTINUE);
      if (cont) { continuePages.push(parseInt(toAsciiDigits(cont[1]), 10)); return; }
      const note = trimmed.match(TEXT_NOTE);
      if (note) {
        finishParagraph();
        const value = note[2].trim();
        if (note[1] === '直した所') { if (value && value !== 'なし') current.notes.push(value); }
        else if (value && value !== 'なし') current.unsure.push({ text: value, note: 'Gem の確認事項' });
        bodyOpen = true;
        return;
      }
      const field = !bodyOpen && current.blocks.length === 0 && current.paragraph.length === 0 ? trimmed.match(TEXT_FIELD) : null;
      if (field) {
        const key = field[1] === '題名' ? 'title' : 'name';
        current[key] = field[3].trim();
        current[key + 'Location'] = field[2] ? TEXT_LOCATION[field[2]] : 'unknown';
        return;
      }
      if (trimmed === '') { finishParagraph(); return; }
      current.paragraph.push(trimmed);
    });
    finishParagraph();

    const covered = new Set();
    essays.forEach((e) => e.sourcePages.forEach((n) => covered.add(n)));
    const lastPage = covered.size > 0 ? Math.max.apply(null, Array.from(covered)) : 0;
    const missing = [];
    for (let n = 1; n < lastPage; n++) if (!covered.has(n)) missing.push(n);
    if (missing.length > 0) messages.push('ページ ' + missing.join('、') + ' が読み込まれていません（Gem が飛ばしたか、まだ貼っていない返事があります）。Gem に「ページ ' + missing[0] + ' から読み直して」と送ってください');
    continuePages.forEach((page) => {
      if (page > lastPage) messages.push('Gem の返事に続きがあります。Gem に「続き」と送り、返ってきたテキストをこの欄の下に貼り足して、もう一度読み込んでください（次は ' + page + ' ページから）');
    });

    const rawEssays = essays.map((e) => ({
      studentNumber: e.studentNumber, sourcePages: e.sourcePages,
      title: e.title, titleLocation: e.titleLocation, name: e.name, nameLocation: e.nameLocation,
      blocks: e.blocks, edits: [], unsure: e.unsure, gemNotes: e.notes.join(' / '), grade: grade, fromText: true,
    }));
    return { rawEssays: rawEssays, grade: grade, messages: messages };
  }

  function parseGeminiOutput(rawText, cfg) {
    const textMode = looksLikeTextFormat(rawText);
    const values = textMode ? [] : findJsonValues(rawText);
    if (!textMode && values.length === 0) throw new SakubunInputError('Gem の返事（「===== 出席番号」で始まるテキスト、または JSON）が見つかりません。Gem の返事をそのまま貼ってください。Gem に学年を聞かれていたら、「2年」のように返してから、もう一度貼ってください。');

    const messages = [];
    const rawEssays = [];
    const grades = new Set();
    if (textMode) {
      const parsedText = parseTextOutput(rawText);
      parsedText.rawEssays.forEach((raw) => rawEssays.push(raw));
      parsedText.messages.forEach((m) => messages.push(m));
      if (parsedText.grade) grades.add(parsedText.grade);
      else messages.push('学年が書かれていないため、漢字の学年を確かめていません（先頭に「学年: 2年」の行を足すと確かめます）');
    }
    values.forEach((value, valueIndex) => {
      const label = values.length > 1 ? (valueIndex + 1) + '回目の返事: ' : '';
      if (value.truncated) {
        messages.push(label + '返事が途中で切れています。Gem に「続き」と送るか、人数を減らして送り直してください');
        return;
      }
      let data;
      try {
        data = JSON.parse(value.text);
      } catch (error) {
        messages.push(label + 'JSONとして読み取れません（' + error.message + '）');
        return;
      }
      const list = listEssays(data);
      if (!list) return; // 作文ではない JSON（例: 返事の中の小さな例）は無視する
      if (data && data.grade !== undefined && data.grade !== null) grades.add(String(data.grade));
      if (data && data.unfinished) {
        messages.push(label + 'Gem の返事に続きがあります。Gem に「続き」と送り、返ってきた JSON をこの欄の下に貼り足して、もう一度読み込んでください' +
          (data.nextPage ? '（次は ' + data.nextPage + ' ページから）' : ''));
      }
      list.forEach((raw) => rawEssays.push(Object.assign({ grade: data && data.grade }, raw)));
    });
    if (rawEssays.length === 0) {
      throw new SakubunInputError(messages.length ? messages.join(' / ') : '作文のデータ（essays）が見つかりません。');
    }
    if (grades.size > 1) messages.push('学年が違う返事が混ざっています: ' + Array.from(grades).join('、') + '年');

    const essays = [];
    rawEssays.forEach((raw, index) => {
      try {
        essays.push(normalizeEssay(raw, index, cfg));
      } catch (error) {
        if (!(error instanceof SakubunInputError)) throw error;
        messages.push(error.message + ' この1人分は飛ばしました');
      }
    });
    if (essays.length === 0) throw new SakubunInputError(messages.join(' / '));

    essays.sort((a, b) => {
      const an = a.studentNumber ? Number(a.studentNumber) : Infinity;
      const bn = b.studentNumber ? Number(b.studentNumber) : Infinity;
      return an - bn || a.index - b.index;
    });
    return {
      essays: essays,
      grade: grades.size === 1 ? Array.from(grades)[0] : null,
      batchMessages: messages.concat(checkBatch(essays)),
    };
  }

  const api = { SakubunInputError, parseGeminiOutput, findJsonValues, parseStudentNumber, normalizeEssay, materialize, applyEdits, expandInnerThoughts, splitDialogues, checkBatch, convertNumerals, parseTextOutput };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunParser = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
