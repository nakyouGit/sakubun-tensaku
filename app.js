/**
 * app.js
 * 画面の動き。読み込み → 一覧 → 本文を直す → プレビュー → PDF。
 * 作文のデータは、この画面の中だけで処理し、どこにも送らない。
 */
(function () {
  'use strict';
  const baseConfig = window.SakubunConfig;
  const state = { items: [], cfg: baseConfig, rules: null, previewItem: null, editingItem: null };

  const el = (id) => document.getElementById(id);
  const currentConfig = () => Object.assign({}, baseConfig, { PAPER: el('paperSelect').value });

  function make(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function showMessages(list) {
    const box = el('messages');
    box.textContent = '';
    list.forEach((item) => box.appendChild(make('p', item.text, item.info ? 'info' : '')));
  }

  async function loadPrompt() {
    try {
      const response = await fetch(baseConfig.PROMPT_FILE);
      if (!response.ok) throw new Error(response.status);
      el('promptText').value = await response.text();
    } catch (error) {
      el('promptText').value = '依頼文を自動で読み込めませんでした。prompt.txt を開いて、中身をコピーしてください。';
    }
  }

  // ---- 1人分のデータ ------------------------------------------------------

  const isEditApplied = (item) => (edit) =>
    item.choices.has(edit.id) ? item.choices.get(edit.id) : edit.defaultApply !== false;

  /** 選び方（choices・header・manual）から、組版に渡す作文を作る。 */
  function recomputeEssay(item, stateLike) {
    const base = Object.assign({}, item.base, {
      rawTitle: stateLike.header.title,
      titleLocation: stateLike.header.titleLocation,
      nameLocation: stateLike.header.nameLocation,
    });
    const applied = (edit) => (stateLike.choices.has(edit.id) ? stateLike.choices.get(edit.id) : edit.defaultApply !== false);
    return window.SakubunParser.materialize(base, state.cfg, applied, stateLike.manual);
  }

  function refreshItem(item) {
    item.essay = recomputeEssay(item, item);
    item.layout = window.SakubunLayout.layoutEssay(item.essay, state.cfg);
  }

  const realEdits = (item) => item.base.edits.filter((e) => e.kind !== '段落');
  const editState = (item, edit) => (item.essay.editStatus.get(edit.id) || { state: 'unresolved' }).state;

  /** 先生が確かめる直し（赤・橙）と、当てはめられなかった直しの数。手で直した作文は数えない。 */
  const reviewCount = (item) => {
    if (item.manual) return 0;
    return realEdits(item).filter((e) =>
      window.SakubunKanji.needsConfirmation(e) || ['unresolved', 'overlap'].includes(editState(item, e))).length;
  };

  const needsReview = (item) => reviewCount(item) > 0 && !item.reviewed;

  const appliedEdits = (item) => (item.manual ? [] : realEdits(item).filter((e) =>
    ['ok', 'duplicate'].includes(editState(item, e)) && isEditApplied(item)(e)));

  // ---- 一覧 ---------------------------------------------------------------

  function describeDetails(item) {
    const { essay, layout } = item;
    const box = make('div', undefined, 'detail-body');
    const add = (title, lines) => {
      if (lines.length === 0) return;
      box.appendChild(make('strong', title));
      lines.forEach((line) => box.appendChild(make('div', line)));
    };
    add('直した所', item.manual ? ['手で直した本文です'] : appliedEdits(item).map((c) => '[' + c.kind + '] ' + c.before + ' → ' + c.after));
    add('元のままにした直し', item.manual ? [] : realEdits(item).filter((c) => !isEditApplied(item)(c)).map((c) => '[' + c.kind + '] ' + c.before + ' → ' + c.after));
    add('本文に当てはめられなかった直し', item.manual ? [] : realEdits(item).filter((c) => ['unresolved', 'overlap'].includes(editState(item, c))).map((c) => c.before + ' → ' + c.after));
    const left = window.SakubunKanji.unlearnedInText([essay.title].concat(essay.blocks.map((b) => b.text)).join(''), essay.grade);
    add('本文に残る、まだ習っていない漢字', left.map((k) => k.ch + '（' + window.SakubunKanji.gradeLabel(k.grade) + '）'));
    add('Gem が直した所（Gem の報告）', essay.gemNotes ? [essay.gemNotes] : []);
    add('読み取りに自信のない字', essay.unsure.map((u) => u.text + '（' + u.note + '）'));
    add('確認事項', essay.warnings.concat(layout.warnings));
    if (!essay.grade) add('漢字', ['学年が分からないため、漢字を確かめていません']);
    return box;
  }

  function reviewStatus(item) {
    if (reviewCount(item) === 0) return { text: 'なし', className: '' };
    if (item.reviewed) return { text: '確認済み', className: 'kanji-status-done' };
    return { text: '要確認 ' + reviewCount(item) + '件', className: 'kanji-status-open' };
  }

  function buildRow(item, position) {
    const row = make('tr');
    const { essay, layout } = item;
    const sourceText = { paper: '', page: '（ページ番号から）', none: '' }[essay.numberSource];
    row.appendChild(make('td', (essay.studentNumber || '未定') + sourceText));
    row.appendChild(make('td', essay.sourcePages.join('、') || '-'));
    row.appendChild(make('td', String(layout.sheets.length)));

    const done = appliedEdits(item);
    const meaningFixes = done.filter((c) => c.kind === '意味').length;
    const paragraphFixes = item.base.edits.filter((c) => c.kind === '段落').length;
    const fixNotes = [];
    if (meaningFixes) fixNotes.push('意味 ' + meaningFixes);
    if (paragraphFixes) fixNotes.push('段落 ' + paragraphFixes);
    row.appendChild(make('td', (item.manual ? '手で直す' : done.length + ' 件') + (fixNotes.length ? '（' + fixNotes.join('・') + '）' : '')));

    const checks = layout.warnings.length + essay.warnings.length + essay.unsure.length + meaningFixes + paragraphFixes;
    const checkCell = make('td');
    checkCell.appendChild(make('span', checks ? checks + ' 件' : 'なし', checks ? 'flag' : ''));
    const details = make('details');
    details.appendChild(make('summary', '内容'));
    details.appendChild(describeDetails(item));
    checkCell.appendChild(details);
    row.appendChild(checkCell);

    const status = reviewStatus(item);
    row.appendChild(make('td', status.text, status.className));

    const actions = make('td');
    const editButton = make('button', '本文を直す', needsReview(item) ? 'primary' : '');
    editButton.addEventListener('click', () => openEditor(item));
    const previewButton = make('button', 'プレビュー');
    previewButton.addEventListener('click', () => showPreview(item, true));
    const pdfButton = make('button', 'PDF');
    pdfButton.addEventListener('click', () => savePdf([item], window.SakubunExport.studentPdfFileName(essay, position), pdfButton));
    [editButton, previewButton, pdfButton].forEach((button) => {
      actions.appendChild(button);
      actions.appendChild(document.createTextNode(' '));
    });
    row.appendChild(actions);
    return row;
  }

  function rebuildRows() {
    const body = el('resultBody');
    body.textContent = '';
    state.items.forEach((item, position) => body.appendChild(buildRow(item, position)));
    const remaining = state.items.filter(needsReview).length;
    el('reviewSummary').textContent = remaining
      ? '確かめる直しのある児童が ' + remaining + ' 人います。「本文を直す」で赤・橙の所を確かめてください（確かめ終わるまでPDFは作れません）。'
      : '';
    el('startReviewButton').hidden = remaining === 0;
  }

  // ---- 本文を直す -----------------------------------------------------------

  const initialHeader = (base) => ({ title: base.rawTitle, titleLocation: base.titleLocation, nameLocation: base.nameLocation });

  function openEditor(item) {
    state.editingItem = item;
    const section = el('editorSection');
    section.hidden = false;
    window.SakubunEditor.render(section, {
      title: '本文を直す（出席番号 ' + (item.essay.studentNumber || '未定') + '）',
      item: item,
      recompute: (stateLike) => recomputeEssay(item, stateLike),
      onSave: (result, goNext) => {
        item.choices = result.choices;
        item.header = result.header;
        item.manual = result.manual;
        item.reviewed = true;
        refreshItem(item);
        rebuildRows();
        if (goNext) {
          const next = state.items.find(needsReview);
          if (next) {
            openEditor(next);
            showPreview(next, false);
            return;
          }
          closeEditor();
          showMessages([{ text: '迷う直しの確認が、全員終わりました。PDFを作れます。', info: true }]);
        }
        showPreview(item, false);
      },
      onReset: () => {
        item.choices = new Map();
        item.manual = null;
        item.header = initialHeader(item.base);
        refreshItem(item);
        rebuildRows();
        openEditor(item);
        showPreview(item, false);
      },
      onClose: closeEditor,
    });
    showPreview(item, false);
    section.scrollIntoView({ behavior: 'smooth' });
  }

  function closeEditor() {
    state.editingItem = null;
    el('editorSection').hidden = true;
    el('editorSection').textContent = '';
  }

  // ---- プレビューと PDF -----------------------------------------------------

  async function renderCanvases(items) {
    await window.SakubunExport.ensureFontsLoaded(state.cfg);
    const canvases = [];
    items.forEach((item) => {
      window.SakubunRender.renderEssay(item.layout, state.cfg, document, state.rules).forEach((c) => canvases.push(c));
    });
    return canvases;
  }

  async function showPreview(item, scroll) {
    state.previewItem = item;
    const canvases = await renderCanvases([item]);
    el('previewSection').hidden = false;
    el('previewTitle').textContent = 'プレビュー（出席番号 ' + (item.essay.studentNumber || '未定') + '）';
    const box = el('preview');
    box.textContent = '';
    canvases.forEach((canvas) => box.appendChild(canvas));
    if (scroll) el('previewSection').scrollIntoView({ behavior: 'smooth' });
  }

  async function savePdf(items, fileName, button) {
    const unreviewed = items.filter(needsReview);
    if (unreviewed.length > 0) {
      const numbers = unreviewed.map((item) => item.essay.studentNumber || '未定').join('、');
      showMessages([{ text: '確かめる直しの確認が済んでいない児童がいます（出席番号 ' + numbers + '）。「本文を直す」で確かめてから、もう一度押してください。' }]);
      el('messages').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '作成中…';
    try {
      const canvases = await renderCanvases(items);
      const blob = await window.SakubunExport.buildPdfBlob(canvases, state.cfg);
      window.SakubunExport.downloadBlob(blob, fileName);
    } catch (error) {
      showMessages([{ text: error.message + '（印刷の画面を開きます。「PDFに保存」を選んでください）' }]);
      try {
        window.SakubunExport.openPrintView(await renderCanvases(items), state.cfg);
      } catch (printError) {
        showMessages([{ text: printError.message }]);
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  // ---- 読み込み -------------------------------------------------------------

  function handleLoad() {
    const text = el('inputText').value.trim();
    if (!text) {
      showMessages([{ text: 'ジェミニの返事を貼るか、ファイルを選んでください。' }]);
      return;
    }
    state.cfg = currentConfig();
    state.rules = window.SakubunLayout.makeRules(state.cfg);
    try {
      const parsed = window.SakubunParser.parseGeminiOutput(text, state.cfg);
      state.previewItem = null;
      closeEditor();
      state.items = parsed.essays.map((essay) => {
        const base = essay.grade ? essay : Object.assign({}, essay, { grade: parsed.grade });
        window.SakubunKanji.classifyEdits(base.edits, Number(base.grade));
        const item = { base: base, choices: new Map(), header: initialHeader(base), manual: null, reviewed: false };
        refreshItem(item);
        return item;
      });
      const messages = parsed.batchMessages.map((m) => ({ text: m }));
      messages.unshift({ text: parsed.essays.length + ' 人分を読み込みました。' + (parsed.grade ? '（' + parsed.grade + '年）' : ''), info: true });
      showMessages(messages);
      rebuildRows();
      el('resultSection').hidden = false;
      el('previewSection').hidden = true;
    } catch (error) {
      showMessages([{ text: error.message }]);
    }
  }

  el('loadButton').addEventListener('click', handleLoad);
  el('inputFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) el('inputText').value = await file.text();
  });
  el('copyPromptButton').addEventListener('click', async () => {
    await navigator.clipboard.writeText(el('promptText').value);
    el('copyPromptButton').textContent = 'コピーしました';
    setTimeout(() => { el('copyPromptButton').textContent = '依頼文をコピー'; }, 2000);
  });
  el('startReviewButton').addEventListener('click', () => {
    const first = state.items.find(needsReview);
    if (first) openEditor(first);
  });
  el('allPdfButton').addEventListener('click', (event) =>
    savePdf(state.items, window.SakubunExport.ALL_STUDENTS_PDF_FILE_NAME, event.target));
  el('kanjiButton').addEventListener('click', () =>
    window.SakubunExport.downloadBlob(window.SakubunExport.buildKanjiReviewText(state.items), window.SakubunExport.KANJI_REVIEW_TEXT_FILE_NAME));
  el('csvButton').addEventListener('click', () =>
    window.SakubunExport.downloadBlob(window.SakubunExport.buildReviewCsv(state.items), window.SakubunExport.REVIEW_CSV_FILE_NAME));

  loadPrompt();
})();
