/**
 * config.js
 * 作文用紙の書き方の決まりと、画面・PDFの設定をすべてここに集める。
 * 組版の処理（layout.js）や描画（render.js）には、数字や文字の一覧を直接書かない。
 */
(function (root) {
  'use strict';

  // ---- 文字の集まり -------------------------------------------------
  const SMALL_KANA_HIRAGANA = 'ぁぃぅぇぉっゃゅょゎゕゖ';
  const SMALL_KANA_KATAKANA = 'ァィゥェォッャュョヮヵヶ';
  const SENTENCE_PUNCTUATION = '。、';
  const CLOSING_BRACKETS = '」』）〕］｝〉》';
  const OPENING_BRACKETS = '「『（〔［｛〈《';

  const SakubunConfig = Object.freeze({
    // ---- 用紙 ---------------------------------------------------------
    CELLS_PER_LINE: 20, // 1行のマス数（縦書きなので上から下へ並ぶ）
    LINES_PER_SHEET: 20, // 1枚の行数（右から左へ並ぶ）
    PAPER: 'A4', // 'A4' か 'B4'（横向き）
    PAPER_SIZES_MM: Object.freeze({
      A4: Object.freeze({ w: 297, h: 210 }),
      B4: Object.freeze({ w: 364, h: 257 }),
    }),
    PAGE_MARGIN_MM: 15,

    // ---- 書き方の決まり ----------------------------------------------
    PARAGRAPH_INDENT_CELLS: 1, // 段落の始まりを下げるマス数
    DIALOGUE_FIRST_INDENT_CELLS: 0, // 会話文の1行目（かぎから1マス目）
    DIALOGUE_CONTINUATION_INDENT_CELLS: 1, // 会話文の2行目以降（小学校の教科書の書き方）
    AFTER_DIALOGUE_INDENT_CELLS: 0, // 会話文のあとの文（改行して1マス目から）
    TITLE_INDENT_CELLS: 3, // 題名の上をあけるマス数（基本）
    TITLE_INDENT_LONG_CELLS: 2, // 題名が長い時に、上をあけるマス数
    TITLE_LONG_MIN_CHARS: 12, // 題名がこの字数以上なら「長い」とみなす
    NAME_BOTTOM_MARGIN_CELLS: 1, // 名前の下をあけるマス数
    INNER_THOUGHT_INLINE_MAX_CHARS: 20, // 心の中の言葉をこの字数まで文中に入れる。超えたら会話文と同じ扱い
    SPACE_AFTER_EXCLAMATION: false, // true にすると、「！」「？」のあとに文が続く時に1マス足す（小学校の資料に根拠がないため、児童が書いたとおりにする）
    MAX_HANGING_SLOTS: 2, // 行末のマスに押し込める字の数（前の字は別）。超えたら前の字ごと次の行へ送る

    // ---- 文字の扱い ---------------------------------------------------
    // 行の頭に置かない字（ー ！ ？ は行の頭に置いてよい。2026-10-31 庸平の指示）
    HEAD_PROHIBITED_CHARS:
      SENTENCE_PUNCTUATION + CLOSING_BRACKETS + SMALL_KANA_HIRAGANA + SMALL_KANA_KATAKANA,
    OPENING_BRACKETS: OPENING_BRACKETS, // 行の最後のマスに置かない字
    CLOSING_BRACKETS: CLOSING_BRACKETS,
    EXCLAMATION_CHARS: '！？!?',
    PERIOD_CHAR: '。',
    PERIOD_PAIR_CLOSERS: '」』', // 「。」」のように句点と同じマスに入れる閉じかっこ（「。）」は別のマス）
    DIALOGUE_OPEN: '「',
    DIALOGUE_CLOSE: '」',

    // ---- 数字（縦書きは漢数字）---------------------------------------
    CONVERT_NUMERALS: true,
    NUMERAL_STYLE: 'counting', // 'counting' は十二・二十五、'positional' は一二・二五
    POSITIONAL_MIN_DIGITS: 5, // この桁数以上は、位取りをせず一字ずつ（例 10000 → 一〇〇〇〇）

    // ---- ジェミニの出力の読み取り -------------------------------------
    // 心の中の言葉のかっこ: 'as_written'（児童が書いたまま）／'kagi'（「 」にそろえる）／'paren'（（ ）にそろえる）
    THOUGHT_BRACKET_STYLE: 'as_written',
    INNER_THOUGHT_OPEN_MARK: '[[',
    INNER_THOUGHT_CLOSE_MARK: ']]',
    PAGE_NUMBER_FALLBACK: true, // 用紙に出席番号が無い時、最初のページ番号を出席番号とみなす

    // ---- 描画 ---------------------------------------------------------
    FONT_FAMILY: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", "MS Mincho", serif',
    ROTATED_CHARS: 'ー「」『』（）〔〕［］｛｝〈〉《》…―—〜～－',
    PX_PER_MM: 8,
    GLYPH_SCALE: 0.78,
    BRACKET_SCALE: 1.15, // 「 」などの大きさ（ほかの字に対する割合）
    PAREN_CHARS: '（）〔〕［］｛｝', // 丸かっこの仲間（マスからはみ出さないよう、中央に小さめに描く）
    PAREN_SCALE: 0.85,
    GRID_COLOR: '#b9824f',
    TEXT_COLOR: '#222222',
    PDF_JPEG_QUALITY: 0.92,
    JSPDF_URL: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    PROMPT_FILE: 'prompt.txt',
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SakubunConfig;
  } else {
    root.SakubunConfig = SakubunConfig;
  }
})(typeof window !== 'undefined' ? window : globalThis);
