/**
 * layout.js
 * 文章を原稿用紙のマスに割り付ける。
 * 最重要の決まり: 行の頭に来る句読点・閉じかっこ・小さい字（っゃゅょ など）は、
 * 必ず前の行の最後のマスに、前の字と一緒に入れる。
 *
 * 行は「マスの並び」。1枚は LINES_PER_SHEET 行ずつに区切って作る。
 * マスは { ch, hang, blank }。ch は主な字、hang はそのマスに押し込めた字。
 */
(function (root) {
  'use strict';

  const makeBlankCell = () => ({ ch: '', hang: [], blank: true });
  const makeCell = (ch) => ({ ch: ch, hang: [], blank: false });

  function makeRules(cfg) {
    const toSet = (text) => new Set(Array.from(text));
    const headProhibited = toSet(cfg.HEAD_PROHIBITED_CHARS);
    const opening = toSet(cfg.OPENING_BRACKETS);
    const closing = toSet(cfg.CLOSING_BRACKETS);
    const exclamation = toSet(cfg.EXCLAMATION_CHARS);
    const pairCloser = toSet(cfg.PERIOD_PAIR_CLOSERS);
    return {
      isHeadProhibited: (ch) => headProhibited.has(ch),
      isOpening: (ch) => opening.has(ch),
      isClosing: (ch) => closing.has(ch),
      isExclamation: (ch) => exclamation.has(ch),
      isPairCloser: (ch) => pairCloser.has(ch),
      isPeriod: (ch) => ch === cfg.PERIOD_CHAR,
    };
  }

  /** 押し込んだ字の数。「。」」は1つ分として数える。 */
  function countHangSlots(mainCh, hangList, rules) {
    let start = 0;
    if (rules.isPeriod(mainCh) && hangList.length > 0 && rules.isPairCloser(hangList[0])) {
      start = 1; // 主な字が「。」で、すぐ閉じかっこが付いたマスは、そのまま1マス分
    }
    let slots = 0;
    for (let i = start; i < hangList.length; i++) {
      if (rules.isPeriod(hangList[i]) && i + 1 < hangList.length && rules.isPairCloser(hangList[i + 1])) {
        i++;
      }
      slots++;
    }
    return slots;
  }

  const isIndentOnly = (line) => line.cells.every((cell) => cell.blank);

  class Typesetter {
    constructor(cfg) {
      this.cfg = cfg;
      this.rules = makeRules(cfg);
      this.lines = [];
      this.warnings = [];
      this.prevIsExclamation = false;
    }

    currentLine() {
      return this.lines[this.lines.length - 1];
    }

    beginLine(indentCells) {
      const line = { cells: [] };
      for (let i = 0; i < indentCells; i++) line.cells.push(makeBlankCell());
      this.lines.push(line);
      return line;
    }

    beginBlock() {
      this.prevIsExclamation = false;
    }

    putText(text, continuationIndent) {
      for (const ch of Array.from(text)) this.placeChar(ch, continuationIndent);
    }

    placeChar(ch, continuationIndent) {
      const cfg = this.cfg;
      const rules = this.rules;
      const cap = cfg.CELLS_PER_LINE;

      if (/\s/.test(ch)) {
        this.placeSpace();
        return;
      }

      let line = this.currentLine();
      const lastCell = line.cells[line.cells.length - 1];

      // 「。」」は同じマスに入れる（行の途中でも同じ）
      if (
        lastCell && !lastCell.blank && rules.isPeriod(lastCell.ch) &&
        lastCell.hang.length === 0 && rules.isPairCloser(ch)
      ) {
        lastCell.hang.push(ch);
        this.prevIsExclamation = false;
        return;
      }

      const atLineStart = isIndentOnly(line);

      // 行の頭に置けない字は、前の行の最後のマスに入れる（最重要）
      if (rules.isHeadProhibited(ch) && (line.cells.length >= cap || atLineStart)) {
        this.hangChar(ch, line, atLineStart, continuationIndent);
        this.prevIsExclamation = false;
        return;
      }

      // 「！」「？」のあとに文が続く時は1マスあける
      const lastIsBlank = lastCell ? lastCell.blank : true;
      if (
        cfg.SPACE_AFTER_EXCLAMATION && this.prevIsExclamation && !atLineStart && !lastIsBlank &&
        !rules.isClosing(ch) && !rules.isExclamation(ch) && !rules.isHeadProhibited(ch) &&
        line.cells.length < cap
      ) {
        line.cells.push(makeBlankCell());
      }

      // 開きかっこは行の最後のマスに置かない
      if (rules.isOpening(ch) && line.cells.length === cap - 1) {
        line.cells.push(makeBlankCell());
      }

      if (line.cells.length >= cap) line = this.beginLine(continuationIndent);
      line.cells.push(makeCell(ch));
      this.prevIsExclamation = rules.isExclamation(ch);
    }

    placeSpace() {
      const line = this.currentLine();
      if (line.cells.length >= this.cfg.CELLS_PER_LINE) return; // 行末の空白は捨てる
      if (isIndentOnly(line)) return; // 行頭の空白は捨てる
      if (line.cells[line.cells.length - 1].blank) return;
      line.cells.push(makeBlankCell());
    }

    canHang(cell, ch) {
      const next = cell.hang.concat([ch]);
      return countHangSlots(cell.ch, next, this.rules) <= this.cfg.MAX_HANGING_SLOTS;
    }

    hangChar(ch, line, atLineStart, continuationIndent) {
      const rules = this.rules;
      let target = line;
      if (atLineStart) target = this.lines[this.lines.length - 2];

      if (!target) {
        this.warnings.push('文の最初に行の頭に置けない字があります: ' + ch);
        line.cells.push(makeCell(ch));
        return;
      }
      while (target.cells.length > 0 && target.cells[target.cells.length - 1].blank) target.cells.pop();
      if (target.cells.length === 0) {
        this.warnings.push('前の行が空のため、行の頭に置けない字を置きました: ' + ch);
        line.cells.push(makeCell(ch));
        return;
      }

      const lastCell = target.cells[target.cells.length - 1];
      if (this.canHang(lastCell, ch)) {
        lastCell.hang.push(ch);
        return;
      }
      if (target !== line) {
        this.warnings.push('前の行に押し込めませんでした: ' + ch);
        line.cells.push(makeCell(ch));
        return;
      }
      this.pushOverflow(line, ch, continuationIndent);
    }

    /** 押し込める数を超えた時は、前の字ごと次の行へ送る。 */
    pushOverflow(line, ch, continuationIndent) {
      const rules = this.rules;
      const moved = [line.cells.pop()];
      // 行の頭に置けない字が先頭に来る場合は、その前の字も一緒に送る
      while (rules.isHeadProhibited(moved[0].ch) && line.cells.some((cell) => !cell.blank)) {
        while (line.cells[line.cells.length - 1].blank) line.cells.pop(); // 間にある空白は捨てる
        moved.unshift(line.cells.pop());
      }
      const nextLine = this.beginLine(continuationIndent);
      for (const cell of moved) {
        nextLine.cells.push(makeCell(cell.ch));
        for (const hung of cell.hang) {
          const prev = nextLine.cells[nextLine.cells.length - 1];
          if (rules.isPeriod(prev.ch) && prev.hang.length === 0 && rules.isPairCloser(hung)) {
            prev.hang.push(hung);
          } else {
            nextLine.cells.push(makeCell(hung));
          }
        }
      }
      nextLine.cells.push(makeCell(ch));
      this.warnings.push('行末に押し込める字が多いため、次の行へ送りました（要確認）');
    }

    layoutBlock(block) {
      const cfg = this.cfg;
      const indents = {
        paragraph: { first: cfg.PARAGRAPH_INDENT_CELLS, rest: 0 },
        dialogue: { first: cfg.DIALOGUE_FIRST_INDENT_CELLS, rest: cfg.DIALOGUE_CONTINUATION_INDENT_CELLS },
        after_dialogue: { first: cfg.AFTER_DIALOGUE_INDENT_CELLS, rest: 0 },
      };
      const indent = indents[block.type] || indents.paragraph;
      // かっこで始まる段落は、1マス下げず、1マス目から書く（会話文の「 と同じ）
      const startsWithOpening = this.rules.isOpening(Array.from(block.text)[0]);
      const firstIndent = block.type === 'paragraph' && startsWithOpening ? 0 : indent.first;
      this.beginBlock();
      this.beginLine(firstIndent);
      this.putText(block.text, indent.rest);
    }

    /** 題名の上は、基本は3マス。長い題名は読みやすいよう2マスにする。 */
    layoutTitle(title) {
      const cfg = this.cfg;
      const isLong = Array.from(title).length >= cfg.TITLE_LONG_MIN_CHARS;
      const indent = isLong ? cfg.TITLE_INDENT_LONG_CELLS : cfg.TITLE_INDENT_CELLS;
      this.beginBlock();
      this.beginLine(indent);
      this.putText(title, indent + 1); // 2行にわたる時は、2行目を1マス下げる
    }

    /** 名前は行の下側に寄せ、下を NAME_BOTTOM_MARGIN_CELLS マスあける。 */
    layoutName(name) {
      const cfg = this.cfg;
      const cells = [];
      for (const ch of Array.from(name)) {
        if (/\s/.test(ch)) {
          if (cells.length > 0 && !cells[cells.length - 1].blank) cells.push(makeBlankCell());
        } else {
          cells.push(makeCell(ch));
        }
      }
      while (cells.length > 0 && cells[cells.length - 1].blank) cells.pop();
      const room = cfg.CELLS_PER_LINE - cfg.NAME_BOTTOM_MARGIN_CELLS;
      if (cells.length > room) {
        this.warnings.push('名前が長いため、1行に入りきらない字を省きました');
        cells.length = room;
      }
      const line = { cells: [] };
      const start = room - cells.length;
      for (let i = 0; i < start; i++) line.cells.push(makeBlankCell());
      for (const cell of cells) line.cells.push(cell);
      this.lines.push(line);
    }
  }

  /** 組版の結果を確かめる。見つかった問題を文字列で返す（空なら問題なし）。 */
  function findViolations(lines, cfg) {
    const rules = makeRules(cfg);
    const problems = [];
    lines.forEach((line, index) => {
      const label = '行' + (index + 1);
      if (line.cells.length > cfg.CELLS_PER_LINE) problems.push(label + ': マスの数が多すぎます');
      const firstReal = line.cells.find((cell) => !cell.blank);
      if (firstReal && rules.isHeadProhibited(firstReal.ch)) {
        problems.push(label + ': 行の頭に置けない字があります（' + firstReal.ch + '）');
      }
      const lastCell = line.cells[cfg.CELLS_PER_LINE - 1];
      if (lastCell && !lastCell.blank && rules.isOpening(lastCell.ch)) {
        problems.push(label + ': 行の最後に開きかっこがあります（' + lastCell.ch + '）');
      }
      line.cells.forEach((cell) => {
        if (countHangSlots(cell.ch, cell.hang, rules) > cfg.MAX_HANGING_SLOTS) {
          problems.push(label + ': 1マスに押し込んだ字が多すぎます');
        }
      });
    });
    return problems;
  }

  /**
   * 1人分の作文を割り付ける。
   * essay: parser.js の normalizeEssay が返す形。
   */
  function layoutEssay(essay, cfg) {
    const typesetter = new Typesetter(cfg);
    if (essay.title && essay.titleLocation === 'body') typesetter.layoutTitle(essay.title);
    if (essay.name && essay.nameLocation === 'body') typesetter.layoutName(essay.name);
    for (const block of essay.blocks) typesetter.layoutBlock(block);

    const lines = typesetter.lines;
    const sheets = [];
    for (let i = 0; i < lines.length; i += cfg.LINES_PER_SHEET) {
      sheets.push(lines.slice(i, i + cfg.LINES_PER_SHEET));
    }
    if (sheets.length === 0) sheets.push([]);

    const violations = findViolations(lines, cfg);
    return {
      lines: lines,
      sheets: sheets,
      margin: {
        title: essay.titleLocation === 'margin' ? essay.title : '',
        name: essay.nameLocation === 'margin' ? essay.name : '',
      },
      studentNumber: essay.studentNumber,
      warnings: typesetter.warnings.concat(violations.map((text) => '組版チェック ' + text)),
      violations: violations,
    };
  }

  const api = { Typesetter, layoutEssay, findViolations, makeRules, countHangSlots };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunLayout = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
