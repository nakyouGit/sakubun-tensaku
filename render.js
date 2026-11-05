/**
 * render.js
 * 割り付けた結果を、原稿用紙1枚ごとにキャンバスへ描く（縦書き）。
 * 縦書き用の字形は、キャンバスでは自動で選ばれないため、ここで次のように描く。
 *  - かっこ・「ー」「…」などは90度回して描く
 *  - 「、」「。」は、マスの右上に寄せる
 *  - 小さい字（っゃゅょ など）は、マスの右上に寄せる
 */
(function (root) {
  'use strict';

  function geometry(cfg) {
    const paper = cfg.PAPER_SIZES_MM[cfg.PAPER];
    const pxPerMm = cfg.PX_PER_MM;
    const cell = ((paper.h - 2 * cfg.PAGE_MARGIN_MM) / cfg.CELLS_PER_LINE) * pxPerMm;
    const gridW = cell * cfg.LINES_PER_SHEET;
    const gridH = cell * cfg.CELLS_PER_LINE;
    const width = paper.w * pxPerMm;
    const height = paper.h * pxPerMm;
    return {
      width: width,
      height: height,
      cell: cell,
      gridW: gridW,
      gridH: gridH,
      gridLeft: (width - gridW) / 2,
      gridTop: (height - gridH) / 2,
    };
  }

  /** 字の黒い部分の中心が (targetX, targetY) に来るように描く。 */
  function drawGlyphAt(ctx, text, targetX, targetY) {
    // 測る前に基準をそろえる（測った値は、その時の textAlign・textBaseline が基準になる）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(text);
    if (metrics.actualBoundingBoxAscent === undefined) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, targetX, targetY);
      return;
    }
    const x = targetX - (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2;
    const y = targetY - (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
    ctx.fillText(text, x, y);
  }

  /**
   * 1字を、マスの中心 (cx, cy) を基準に描く。
   * cellSize は基準にするマスの大きさ、scale は字の大きさ（マスに対する割合）。
   */
  function drawChar(ctx, ch, cx, cy, cellSize, scale, cfg, rules) {
    ctx.font = Math.round(cellSize * scale) + 'px ' + cfg.FONT_FAMILY;
    const isPunctuation = ch === '、' || ch === '。';
    const isSmallKana = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ]/.test(ch);

    if (cfg.ROTATED_CHARS.indexOf(ch) >= 0) {
      let offsetX = 0;
      let offsetY = 0;
      const isParen = cfg.PAREN_CHARS.indexOf(ch) >= 0;
      const isBracket = rules.isOpening(ch) || rules.isClosing(ch);
      if (isBracket) {
        // かっこは字より小さく見えるため「 」は少し大きく、（ ）はマスからはみ出さないよう小さめに描く
        const bracketScale = isParen ? cfg.PAREN_SCALE : cfg.BRACKET_SCALE;
        ctx.font = Math.round(cellSize * scale * bracketScale) + 'px ' + cfg.FONT_FAMILY;
      }
      const horizontalShift = isParen ? 0 : 0.2 * cellSize; // 丸かっこは、マスの中央に置く
      if (rules.isOpening(ch)) {
        offsetX = horizontalShift; // 開きかっこは、マスの下半分
        offsetY = 0.22 * cellSize;
      } else if (rules.isClosing(ch)) {
        offsetX = -horizontalShift; // 閉じかっこは、マスの上半分
        offsetY = -0.22 * cellSize;
      }
      ctx.save();
      ctx.translate(cx + offsetX, cy + offsetY);
      ctx.rotate(Math.PI / 2);
      drawGlyphAt(ctx, ch, 0, 0);
      ctx.restore();
      return;
    }
    if (isPunctuation) {
      drawGlyphAt(ctx, ch, cx + 0.27 * cellSize, cy - 0.27 * cellSize);
      return;
    }
    if (isSmallKana) {
      drawGlyphAt(ctx, ch, cx + 0.1 * cellSize, cy - 0.1 * cellSize);
      return;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, cx, cy);
  }

  /** 1マスを描く。行末に押し込んだ字は、マスの下側に小さく並べる。 */
  function drawCell(ctx, cell, cx, cy, cellSize, cfg, rules) {
    if (cell.blank || !cell.ch) return;
    if (cell.hang.length === 0) {
      drawChar(ctx, cell.ch, cx, cy, cellSize, cfg.GLYPH_SCALE, cfg, rules);
      return;
    }
    let hangList = cell.hang;
    if (rules.isPeriod(cell.ch) && rules.isPairCloser(cell.hang[0])) {
      // 「。」」は1マスに並べて描く
      drawChar(ctx, cell.ch, cx, cy, cellSize, cfg.GLYPH_SCALE, cfg, rules);
      drawChar(ctx, cell.hang[0], cx, cy, cellSize, cfg.GLYPH_SCALE, cfg, rules);
      hangList = cell.hang.slice(1);
    } else {
      drawChar(ctx, cell.ch, cx, cy - 0.12 * cellSize, cellSize, cfg.GLYPH_SCALE * 0.85, cfg, rules);
    }
    let slot = 0;
    for (let i = 0; i < hangList.length; i++) {
      const slotX = cx + 0.28 * cellSize - slot * 0.3 * cellSize;
      const slotY = cy + 0.28 * cellSize;
      drawChar(ctx, hangList[i], slotX, slotY, cellSize * 0.6, 0.8, cfg, rules);
      const pairedCloser = rules.isPeriod(hangList[i]) && i + 1 < hangList.length && rules.isPairCloser(hangList[i + 1]);
      if (pairedCloser) {
        drawChar(ctx, hangList[i + 1], slotX, slotY, cellSize * 0.6, 0.8, cfg, rules);
        i++;
      }
      slot++;
    }
  }

  /** 欄外の題名・名前を、縦に並べて描く。 */
  function drawMarginText(ctx, text, columnX, startIndex, g, cfg, rules) {
    let index = startIndex;
    for (const ch of Array.from(text)) {
      if (!/\s/.test(ch)) {
        const cy = g.gridTop + (index + 0.5) * g.cell;
        drawCell(ctx, { ch: ch, hang: [], blank: false }, columnX, cy, g.cell * 0.9, cfg, rules);
      }
      index++;
    }
  }

  function drawGrid(ctx, g, cfg) {
    ctx.strokeStyle = cfg.GRID_COLOR;
    ctx.lineWidth = Math.max(1, g.cell * 0.025);
    ctx.beginPath();
    for (let i = 0; i <= cfg.LINES_PER_SHEET; i++) {
      const x = g.gridLeft + i * g.cell;
      ctx.moveTo(x, g.gridTop);
      ctx.lineTo(x, g.gridTop + g.gridH);
    }
    for (let j = 0; j <= cfg.CELLS_PER_LINE; j++) {
      const y = g.gridTop + j * g.cell;
      ctx.moveTo(g.gridLeft, y);
      ctx.lineTo(g.gridLeft + g.gridW, y);
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(2, g.cell * 0.06);
    ctx.strokeRect(g.gridLeft, g.gridTop, g.gridW, g.gridH);
  }

  /**
   * 1枚分を描いたキャンバスを返す。
   * layout: layout.js の layoutEssay の結果、sheetIndex: 0から数えた枚数。
   */
  function renderSheet(layout, sheetIndex, cfg, doc, rules) {
    const g = geometry(cfg);
    const canvas = doc.createElement('canvas');
    canvas.width = Math.round(g.width);
    canvas.height = Math.round(g.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, g, cfg);

    ctx.fillStyle = cfg.TEXT_COLOR;
    const lines = layout.sheets[sheetIndex] || [];
    lines.forEach((line, lineIndex) => {
      const cx = g.gridLeft + g.gridW - (lineIndex + 0.5) * g.cell;
      line.cells.forEach((cell, cellIndex) => {
        drawCell(ctx, cell, cx, g.gridTop + (cellIndex + 0.5) * g.cell, g.cell, cfg, rules);
      });
    });

    const marginRightEdge = g.gridLeft + g.gridW;
    if (layout.margin.title) drawMarginText(ctx, layout.margin.title, marginRightEdge + 2.4 * g.cell, 0, g, cfg, rules);
    if (layout.margin.name) drawMarginText(ctx, layout.margin.name, marginRightEdge + 1.2 * g.cell, 3, g, cfg, rules);

    if (layout.studentNumber) {
      ctx.font = 'bold ' + Math.round(g.cell * 0.9) + 'px ' + cfg.FONT_FAMILY;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(layout.studentNumber, g.width - cfg.PAGE_MARGIN_MM * cfg.PX_PER_MM, cfg.PAGE_MARGIN_MM * cfg.PX_PER_MM * 0.6);
    }
    return canvas;
  }

  /** 1人分のすべての枚数のキャンバスを返す。 */
  function renderEssay(layout, cfg, doc, rules) {
    return layout.sheets.map((_, index) => renderSheet(layout, index, cfg, doc, rules));
  }

  const api = { geometry, renderSheet, renderEssay };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunRender = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
