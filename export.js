/**
 * export.js
 * PDF・一覧(CSV)・印刷の出力。作文のデータはこの端末の中だけで処理し、どこにも送らない。
 * （外部から読み込むのは、字体と PDF 作成の部品だけ。）
 */
(function (root) {
  'use strict';

  function loadScriptOnce(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-src="' + url + '"]');
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', reject);
        if (window.jspdf) resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.dataset.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('PDF作成の部品を読み込めませんでした。'));
      document.head.appendChild(script);
    });
  }

  async function ensureJsPdf(cfg) {
    if (!window.jspdf) await loadScriptOnce(cfg.JSPDF_URL);
    if (!window.jspdf) throw new Error('PDF作成の部品が使えません。「印刷」から PDF に保存してください。');
    return window.jspdf.jsPDF;
  }

  /** 字体を読み込み終えてから描く。読み込めなければ端末の明朝体を使う。 */
  async function ensureFontsLoaded(cfg) {
    try {
      await document.fonts.load('40px "Noto Serif JP"', 'あ日。「」');
    } catch (error) {
      // 端末の字体で描く
    }
    try {
      await document.fonts.ready;
    } catch (error) {
      // そのまま続ける
    }
  }

  async function buildPdfBlob(canvases, cfg) {
    const JsPdf = await ensureJsPdf(cfg);
    const paper = cfg.PAPER_SIZES_MM[cfg.PAPER];
    const doc = new JsPdf({ orientation: 'landscape', unit: 'mm', format: [paper.w, paper.h], compress: true });
    canvases.forEach((canvas, index) => {
      if (index > 0) doc.addPage([paper.w, paper.h], 'landscape');
      doc.addImage(canvas.toDataURL('image/jpeg', cfg.PDF_JPEG_QUALITY), 'JPEG', 0, 0, paper.w, paper.h);
    });
    return doc.output('blob');
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function studentPdfFileName(essay, position) {
    const label = essay.studentNumber ? '出席番号' + essay.studentNumber : '番号なし' + (position + 1);
    return '作文用紙_' + label + '.pdf';
  }

  const ALL_STUDENTS_PDF_FILE_NAME = '作文用紙_全員分.pdf';
  const REVIEW_CSV_FILE_NAME = '作文用紙_確認一覧.csv';

  /** PDFが作れない時の逃げ道。ブラウザの印刷で PDF に保存できる。 */
  function openPrintView(canvases, cfg) {
    const paper = cfg.PAPER_SIZES_MM[cfg.PAPER];
    const win = window.open('', '_blank');
    if (!win) throw new Error('印刷用の画面を開けませんでした。ポップアップを許可してください。');
    const images = canvases
      .map((canvas) => '<img src="' + canvas.toDataURL('image/jpeg', cfg.PDF_JPEG_QUALITY) + '">')
      .join('');
    win.document.write(
      '<!doctype html><meta charset="utf-8"><title>作文用紙</title><style>' +
        '@page{size:' + paper.w + 'mm ' + paper.h + 'mm;margin:0}' +
        'body{margin:0}img{display:block;width:' + paper.w + 'mm;height:' + paper.h + 'mm;page-break-after:always}' +
        '</style>' + images
    );
    win.document.close();
    win.addEventListener('load', () => win.print());
  }

  const csvCell = (value) => '"' + String(value).replace(/"/g, '""') + '"';

  /** 先生が確かめるための一覧（配る用紙には載せない）。 */
  function buildReviewCsv(items) {
    const header = ['出席番号', '番号の元', '元のページ', '枚数', '直した数', '意味を直した数', '読み取り不確か', '確認事項'];
    const sourceLabel = { paper: '用紙', page: 'ページ番号から', none: 'なし' };
    const applied = (item) => (item.manual ? [] : item.base.edits.filter((e) => e.kind !== '段落' && ['ok', 'duplicate'].includes((item.essay.editStatus.get(e.id) || {}).state) && (item.choices.has(e.id) ? item.choices.get(e.id) : e.defaultApply !== false)));
    const rows = items.map((item) => [
      item.essay.studentNumber || '',
      sourceLabel[item.essay.numberSource] || '',
      item.essay.sourcePages.join('、'),
      item.layout.sheets.length,
      applied(item).length,
      applied(item).filter((c) => c.kind === '意味').length,
      item.essay.unsure.length,
      item.essay.warnings.concat(item.layout.warnings).join(' / '),
    ]);
    const body = [header].concat(rows).map((row) => row.map(csvCell).join(',')).join('\r\n');
    return new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  }

  const KANJI_REVIEW_TEXT_FILE_NAME = '作文用紙_漢字の確認.txt';

  /**
   * 先生が漢字を確かめるためのテキスト。Gem の漢字の直しを、学年で分けて載せる。
   */
  function buildKanjiReviewText(items) {
    const kanji = root.SakubunKanji;
    const lines = ['作文用紙づくり　漢字の確認リスト', ''];
    const describe = (list) => list.map((k) => k.ch + '（' + kanji.gradeLabel(k.grade) + '）').join('、');
    items.forEach((item) => {
      const { essay, base } = item;
      lines.push('■ 出席番号 ' + (essay.studentNumber || '未定') + (essay.grade ? '（' + essay.grade + '年）' : ''));
      if (!essay.grade) {
        lines.push('  学年が分からないため、漢字を確かめていません。');
        lines.push('');
        return;
      }
      const isApplied = (e) => (item.choices.has(e.id) ? item.choices.get(e.id) : e.defaultApply !== false);
      const kanjiEdits = base.edits.filter((e) => e.kind !== '段落' && e.introduced && e.introduced.length > 0);
      const show = (title, list) => {
        if (list.length === 0) return;
        lines.push('  【' + title + '】');
        list.forEach((e) => lines.push('    ' + e.before + ' → ' + e.after + '　' + describe(e.introduced) +
          (e.context ? '　文: ' + e.context : '') + (item.manual ? '' : isApplied(e) ? '　（反映中）' : '　（元のまま）')));
      };
      show('この学年で習う漢字に直した所（使うか先生が決める）', kanjiEdits.filter((e) => e.category === 'decide'));
      show('まだ習っていない漢字に直そうとした所（既定は元のまま）', kanjiEdits.filter((e) => e.category === 'unlearned'));
      show('前の学年までに習った漢字に直した所', kanjiEdits.filter((e) => e.category === 'learned'));
      const left = kanji.unlearnedInText([essay.title].concat(essay.blocks.map((b) => b.text)).join(''), essay.grade);
      if (left.length) {
        lines.push('  【本文にある、まだ習っていない漢字（児童が自分で書いたかを確認）】');
        lines.push('    ' + describe(left));
      }
      if (kanjiEdits.length === 0 && left.length === 0) lines.push('  確認することはありません。');
      lines.push('');
    });
    return new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
  }

  const api = {
    buildKanjiReviewText, KANJI_REVIEW_TEXT_FILE_NAME,
    ensureFontsLoaded, buildPdfBlob, downloadBlob, studentPdfFileName, openPrintView, buildReviewCsv,
    ALL_STUDENTS_PDF_FILE_NAME, REVIEW_CSV_FILE_NAME,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunExport = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
