/**
 * editor.js
 * 本文を直す画面。Gem が直した所の一覧（使う／元に戻す）と、本文の確認、題名・題名や名前の場所の選び直し。
 * 本文を直接書き換えると「手で直す」状態になり、その時は Gem の直しの一覧は使わない。
 * 色: 赤＝その学年で習う漢字（要確認）、橙＝まだ習っていない漢字、緑＝直した所、灰＝元に戻した所。
 */
(function (root) {
  'use strict';

  const BLOCK_LABELS = { paragraph: '段落', dialogue: '会話文', after_dialogue: '会話のあと' };
  const LOCATION_OPTIONS = [['body', '本文の中'], ['margin', '欄外'], ['none', 'なし']];
  const CATEGORY_LABELS = {
    decide: 'この学年で習う漢字（要確認）',
    unlearned: 'まだ習っていない漢字',
    learned: '前の学年までの漢字',
    normal: '',
  };

  function make(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /** 画面に出す色の種類。 */
  function markClass(edit, applied) {
    if (!applied) return 'mark-reverted';
    if (edit.category === 'decide') return 'mark-decide';
    if (edit.category === 'unlearned') return 'mark-unlearned';
    return 'mark-fixed';
  }

  /** 区切り（segments）を、色付きの部品にする。 */
  /** 学年を渡した時、直しに関わらない文字のうち、その学年で習う漢字（赤）とまだ習っていない漢字（橙）に色を付ける。 */
  function plainNodes(text, grade) {
    const kanji = root.SakubunKanji;
    if (!grade || !kanji) return [document.createTextNode(text)];
    const nodes = [];
    let plain = '';
    Array.from(text).forEach((ch) => {
      const g = kanji.gradeOf(ch);
      const cls = g > grade ? 'mark-unlearned' : g === grade ? 'mark-decide' : '';
      if (!cls) { plain += ch; return; }
      if (plain) { nodes.push(document.createTextNode(plain)); plain = ''; }
      const mark = make('mark', ch, cls);
      mark.title = kanji.gradeLabel(g) + 'の漢字';
      nodes.push(mark);
    });
    if (plain) nodes.push(document.createTextNode(plain));
    return nodes;
  }

  function buildSegmentNodes(segments, editsById, grade) {
    return segments.reduce((all, segment) => all.concat(buildOneSegment(segment, editsById, grade)), []);
  }

  function buildOneSegment(segment, editsById, grade) {
    return [segment].map((segment) => {
      if (!segment.editId) return plainNodes(segment.text, grade);
      const edit = editsById.get(segment.editId);
      const mark = make('mark', segment.text, markClass(edit, segment.applied));
      mark.title = '[' + edit.kind + '] ' + edit.before + ' → ' + edit.after +
        (CATEGORY_LABELS[edit.category] ? '（' + CATEGORY_LABELS[edit.category] + '）' : '') +
        (segment.applied ? '　反映中' : '　元のまま');
      return [mark];
    })[0];
  }

  const readText = (node) => node.textContent.replace(/[\r\n]/g, '').trim();

  const STATUS_TEXT = {
    unresolved: '本文に当てはめられません（直す前の言葉が本文と合っていません）',
    overlap: '別の直しと重なっていて当てはめられません',
    duplicate: '同じ場所の直しと重なっています',
  };


  // ---- テキスト形式の作文を直す画面（空行＝段落の区切り） ------------------
  const removeSpacesBetweenJapanese = (text) => text.replace(/([^\x00-\x7F])[ 　\t]+(?=[^\x00-\x7F])/g, '$1');

  /** 「確認」に書かれた言葉のうち「 」で囲まれたものを取り出す。 */
  function quotedWords(unsure) {
    const words = [];
    unsure.forEach((item) => {
      const text = String(item.text || '');
      const pattern = /[「『]([^」』]{1,20})[」』]/g;
      let m;
      while ((m = pattern.exec(text)) !== null) words.push(m[1]);
    });
    return words;
  }

  /** 本文を色付きの部品にする。学年の漢字（赤・橙）と、Gem が確認を求めた言葉（黄）。 */
  function buildTextHighlights(text, grade, noteWords) {
    const kanji = root.SakubunKanji;
    const classes = new Array(text.length).fill('');
    if (grade && kanji) {
      for (let i = 0; i < text.length; i++) {
        const g = kanji.gradeOf(text[i]);
        classes[i] = g > grade ? 'mark-unlearned' : g === grade ? 'mark-decide' : '';
      }
    }
    noteWords.forEach((word) => {
      let from = 0;
      let at;
      while ((at = text.indexOf(word, from)) >= 0) {
        for (let i = at; i < at + word.length; i++) classes[i] = 'mark-note';
        from = at + word.length;
      }
    });
    const nodes = [];
    let run = '';
    let runClass = '';
    const flush = () => {
      if (!run) return;
      if (runClass) nodes.push(make('mark', run, runClass)); else nodes.push(document.createTextNode(run));
      run = '';
    };
    for (let i = 0; i < text.length; i++) {
      if (classes[i] !== runClass) { flush(); runClass = classes[i]; }
      run += text[i];
    }
    flush();
    return nodes;
  }

  function renderTextEditor(container, options) {
    const item = options.item;
    const base = item.base;
    const grade = Number(base.grade);
    const noteWords = quotedWords(base.unsure);
    const header = Object.assign({}, item.header);

    container.textContent = '';
    container.appendChild(make('h2', options.title));

    const legend = make('p', undefined, 'note');
    legend.appendChild(make('mark', 'この学年で習う漢字', 'mark-decide'));
    legend.appendChild(document.createTextNode(' '));
    legend.appendChild(make('mark', 'まだ習っていない漢字', 'mark-unlearned'));
    legend.appendChild(document.createTextNode(' '));
    legend.appendChild(make('mark', 'Gem が確認を求めた言葉', 'mark-note'));
    legend.appendChild(document.createTextNode('　空の行が段落の区切りです。空の行を入れたり消したりして、段落を変えられます。書き換えると、下のプレビューがすぐ変わります。'));
    container.appendChild(legend);

    const field = (labelText, value) => {
      const wrap = make('label', labelText + ' ', 'editor-field');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value || '';
      wrap.appendChild(input);
      container.appendChild(wrap);
      return input;
    };
    const titleInput = field('題名', header.title);
    const nameInput = field('名前', header.name);
    const select = (labelText, key) => {
      const wrap = make('label', labelText + ' ', 'editor-field');
      const sel = document.createElement('select');
      LOCATION_OPTIONS.forEach(([value, text]) => {
        const option = make('option', text);
        option.value = value;
        if (header[key] === value) option.selected = true;
        sel.appendChild(option);
      });
      sel.addEventListener('change', notify);
      wrap.appendChild(sel);
      container.appendChild(wrap);
      return sel;
    };
    const titleSelect = select('題名の場所', 'titleLocation');
    const nameSelect = select('名前の場所', 'nameLocation');

    if (base.unsure.length > 0 || base.gemNotes) {
      const box = make('div', undefined, 'gem-notes');
      if (base.gemNotes) box.appendChild(make('div', 'Gem が直した所: ' + base.gemNotes));
      base.unsure.forEach((u) => box.appendChild(make('div', '確認: ' + u.text)));
      container.appendChild(box);
    }

    const wrap = make('div', undefined, 'text-editor-wrap');
    const backdrop = make('div', undefined, 'text-editor-backdrop');
    const area = document.createElement('textarea');
    area.className = 'text-editor-area';
    area.spellcheck = false;
    const startBlocks = item.manual ? item.manual.blocks : base.rawBlocks;
    area.value = startBlocks.map((b) => b.text).join('\n\n');
    wrap.appendChild(backdrop);
    wrap.appendChild(area);
    container.appendChild(wrap);

    function sync() {
      area.style.height = 'auto';
      area.style.height = (area.scrollHeight + 4) + 'px';
      backdrop.textContent = '';
      buildTextHighlights(area.value, grade, noteWords).forEach((node) => backdrop.appendChild(node));
      backdrop.appendChild(document.createTextNode('\n'));
    }

    const collect = () => {
      const state = {
        header: { title: titleInput.value.trim(), name: nameInput.value.trim(), titleLocation: titleSelect.value, nameLocation: nameSelect.value },
        choices: new Map(),
      };
      const blocks = area.value.split(/\n[ 　\t]*\n/)
        .map((chunk) => removeSpacesBetweenJapanese(chunk.replace(/\s*\n\s*/g, '')).trim())
        .filter(Boolean)
        .map((text) => ({ type: 'paragraph', text: text }));
      state.manual = { title: state.header.title, blocks: blocks };
      return state;
    };

    let timer = null;
    function notify() {
      clearTimeout(timer);
      timer = setTimeout(() => { if (options.onChange) options.onChange(collect()); }, 350);
    }
    area.addEventListener('input', () => { sync(); notify(); });
    titleInput.addEventListener('input', notify);
    nameInput.addEventListener('input', notify);
    sync();
    root.requestAnimationFrame ? root.requestAnimationFrame(sync) : null;

    const buttons = make('div', undefined, 'row');
    const saveNext = make('button', '保存して次へ', 'primary');
    saveNext.addEventListener('click', () => options.onSave(collect(), true));
    const save = make('button', '保存');
    save.addEventListener('click', () => options.onSave(collect(), false));
    const reset = make('button', 'Gem の返事に戻す');
    reset.addEventListener('click', () => options.onReset());
    const close = make('button', '閉じる');
    close.addEventListener('click', () => options.onClose());
    [saveNext, save, reset, close].forEach((b) => buttons.appendChild(b));
    container.appendChild(buttons);
  }

  /**
   * options:
   *  title, item（base・choices・header・manual を持つ）, recompute(state) → materialize した作文,
   *  onSave(result, goNext), onReset(), onClose()
   * 保存の中身 result: { choices:Map, header:{title,titleLocation,nameLocation}, manual:null|{title,blocks} }
   */
  function render(container, options) {
    if (options.item.base.fromText) return renderTextEditor(container, options);
    const item = options.item;
    const base = item.base;
    const editsById = new Map(base.edits.map((e) => [e.id, e]));
    const choices = new Map(item.choices);
    const header = Object.assign({}, item.header);
    let manualDirty = !!item.manual;

    container.textContent = '';
    container.appendChild(make('h2', options.title));

    const legend = make('p', undefined, 'note');
    legend.appendChild(make('mark', '要確認', 'mark-decide'));
    legend.appendChild(document.createTextNode(' '));
    legend.appendChild(make('mark', '未習の漢字', 'mark-unlearned'));
    legend.appendChild(document.createTextNode(' '));
    legend.appendChild(make('mark', '直した所', 'mark-fixed'));
    legend.appendChild(document.createTextNode(' '));
    legend.appendChild(make('mark', '元のまま', 'mark-reverted'));
    legend.appendChild(document.createTextNode('　チェックを外すと、その直しをやめて元の言葉に戻ります。本文を書き換えると「手で直す」になります。'));
    container.appendChild(legend);

    // 題名と、題名・名前の場所
    const titleLabel = make('label', '題名 ', 'editor-field');
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = header.title;
    titleLabel.appendChild(titleInput);
    container.appendChild(titleLabel);
    const select = (labelText, key) => {
      const wrap = make('label', labelText + ' ', 'editor-field');
      const sel = document.createElement('select');
      LOCATION_OPTIONS.forEach(([value, text]) => {
        const option = make('option', text);
        option.value = value;
        if (header[key] === value) option.selected = true;
        sel.appendChild(option);
      });
      sel.addEventListener('change', () => { header[key] = sel.value; });
      wrap.appendChild(sel);
      container.appendChild(wrap);
    };
    select('題名の場所', 'titleLocation');
    select('名前の場所', 'nameLocation');

    const editList = make('div', undefined, 'edit-list');
    const bodyBox = make('div');
    const manualNote = make('p', undefined, 'note');
    container.appendChild(manualNote);
    container.appendChild(editList);
    container.appendChild(bodyBox);

    let blockAreas = [];
    const currentState = () => ({ choices: choices, header: Object.assign({}, header, { title: titleInput.value.trim() }) });

    function renderEditList(view) {
      editList.textContent = '';
      const edits = base.edits.filter((e) => e.kind !== '段落');
      if (edits.length === 0) {
        editList.appendChild(make('p', 'Gem の直した所はありません。', 'note'));
        return;
      }
      edits.forEach((edit) => {
        const row = make('label', undefined, 'edit-row');
        const box = document.createElement('input');
        box.type = 'checkbox';
        const status = view.editStatus.get(edit.id);
        const resolved = status && (status.state === 'ok' || status.state === 'duplicate');
        box.checked = choices.has(edit.id) ? choices.get(edit.id) : edit.defaultApply !== false;
        box.disabled = manualDirty || !resolved;
        box.addEventListener('change', () => { choices.set(edit.id, box.checked); refreshBody(); });
        row.appendChild(box);
        row.appendChild(make('span', '[' + edit.kind + '] ' + edit.before + ' → ' + edit.after, 'edit-text'));
        if (CATEGORY_LABELS[edit.category]) row.appendChild(make('span', CATEGORY_LABELS[edit.category], 'edit-tag edit-tag-' + edit.category));
        if (status && STATUS_TEXT[status.state] && status.state !== 'duplicate') row.appendChild(make('span', STATUS_TEXT[status.state], 'edit-tag edit-tag-unresolved'));
        editList.appendChild(row);
      });
    }

    function renderBody(view) {
      bodyBox.textContent = '';
      blockAreas = view.segments.blocks.map((block) => {
        const row = make('div', undefined, 'editor-block');
        row.appendChild(make('span', BLOCK_LABELS[block.type] || '段落', 'editor-type'));
        const area = make('div', undefined, 'editor-text');
        area.contentEditable = 'true';
        area.spellcheck = false;
        buildSegmentNodes(block.segments, editsById, Number(base.grade)).forEach((node) => area.appendChild(node));
        area.addEventListener('input', () => {
          if (manualDirty) return;
          manualDirty = true;
          manualNote.textContent = '本文を書き換えたため「手で直す」状態です。Gem の直しの一覧は使いません。戻すには「Gem の直しに戻す」を押してください。';
          editList.querySelectorAll('input').forEach((box) => { box.disabled = true; });
        });
        row.appendChild(area);
        bodyBox.appendChild(row);
        return { type: block.type, area: area };
      });
    }

    function refreshBody() {
      const view = options.recompute(Object.assign(currentState(), { manual: null }));
      renderEditList(view);
      renderBody(view);
    }

    // 最初の表示
    const first = options.recompute(Object.assign(currentState(), { manual: item.manual }));
    manualNote.textContent = manualDirty ? '手で直した本文です。Gem の直しの一覧は使っていません。' : '';
    renderEditList(first);
    renderBody(first);

    const collect = () => {
      const state = currentState();
      if (!manualDirty) return { choices: state.choices, header: state.header, manual: null };
      return {
        choices: state.choices,
        header: state.header,
        manual: {
          title: state.header.title,
          blocks: blockAreas.map((b) => ({ type: b.type, text: readText(b.area) })).filter((b) => b.text),
        },
      };
    };

    const buttons = make('div', undefined, 'row');
    const saveNext = make('button', '保存して次へ', 'primary');
    saveNext.addEventListener('click', () => options.onSave(collect(), true));
    const save = make('button', '保存');
    save.addEventListener('click', () => options.onSave(collect(), false));
    const reset = make('button', 'Gem の直しに戻す');
    reset.addEventListener('click', () => options.onReset());
    const close = make('button', '閉じる');
    close.addEventListener('click', () => options.onClose());
    [saveNext, save, reset, close].forEach((b) => buttons.appendChild(b));
    container.appendChild(buttons);
  }

  const api = { render, buildSegmentNodes, markClass };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunEditor = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
