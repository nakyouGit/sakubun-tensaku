/**
 * layout.test.js
 * 実行: node layout.test.js
 * 組版の最重要の決まり（行の頭に句読点・閉じかっこ・小さい字を置かない）を中心に確かめる。
 */
'use strict';
const assert = require('assert');
const cfg = require('./config.js');
const { Typesetter, layoutEssay, findViolations } = require('./layout.js');
const { parseGeminiOutput, normalizeEssay, convertNumerals } = require('./parser.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  通過: ' + name);
  } catch (error) {
    console.error('  失敗: ' + name + '\n    ' + error.message);
    process.exitCode = 1;
  }
}

const repeat = (ch, n) => ch.repeat(n);
const plainEssay = (blocks) => ({
  title: '', titleLocation: 'none', name: '', nameLocation: 'none', studentNumber: '1', blocks: blocks,
});
const lay = (blocks) => layoutEssay(plainEssay(blocks), cfg);
const cellText = (cell) => cell.ch + cell.hang.join('');

console.log('組版');

test('行の最後ちょうどに来た「。」の次が「。」→前の行の最後のマスに入る', () => {
  const result = lay([{ type: 'paragraph', text: repeat('あ', 19) + '。' + 'い' }]);
  assert.strictEqual(result.lines.length, 2);
  assert.deepStrictEqual(result.lines[0].cells[19].hang, ['。']);
  assert.strictEqual(result.lines[1].cells[0].ch, 'い');
  assert.deepStrictEqual(result.violations, []);
});

test('「ちょ。」」が行末で重なる→「ち」のマスに「ょ」「。」」が入る', () => {
  const text = '「' + repeat('あ', 18) + 'ち' + 'ょ。」';
  const result = lay([{ type: 'dialogue', text: text }]);
  assert.strictEqual(result.lines.length, 1);
  const last = result.lines[0].cells[19];
  assert.strictEqual(last.ch, 'ち');
  assert.deepStrictEqual(last.hang, ['ょ', '。', '」']);
  assert.deepStrictEqual(result.violations, []);
});

test('押し込む字が多すぎる時は、前の字ごと次の行へ送る', () => {
  const text = repeat('あ', 19) + 'ち' + 'ょっ。' + 'い';
  const result = lay([{ type: 'after_dialogue', text: text }]);
  assert.strictEqual(result.lines[1].cells[0].ch, 'ち');
  assert.deepStrictEqual(result.violations, []);
});

test('小さい字が行の頭に来る時も、前の行の最後のマスに入る', () => {
  const result = lay([{ type: 'after_dialogue', text: repeat('あ', 19) + 'しゃ' + 'べ' }]);
  assert.strictEqual(result.lines[0].cells[19].ch, 'し');
  assert.deepStrictEqual(result.lines[0].cells[19].hang, ['ゃ']);
  assert.strictEqual(result.lines[1].cells[0].ch, 'べ');
});

test('1枚目の最後の行で起きても、2枚目の頭に送らない', () => {
  const lines400 = repeat(repeat('あ', 20), 20).slice(0, 400);
  const result = lay([{ type: 'after_dialogue', text: lines400 + '。' + 'い' }]);
  assert.strictEqual(result.sheets[0].length, 20);
  assert.deepStrictEqual(result.sheets[0][19].cells[19].hang, ['。']);
  assert.strictEqual(result.sheets[1][0].cells[0].ch, 'い');
  assert.deepStrictEqual(result.violations, []);
});

test('段落の1マス下げと、行の終わりの「。」が重なる', () => {
  const result = lay([{ type: 'paragraph', text: repeat('あ', 19) + '。' }]);
  assert.strictEqual(result.lines[0].cells[0].blank, true);
  assert.strictEqual(result.lines.length, 1);
  assert.deepStrictEqual(result.lines[0].cells[19].hang, ['。']);
});

test('20マスちょうどで行が埋まる→次の字は次の行', () => {
  const result = lay([{ type: 'after_dialogue', text: repeat('あ', 20) + 'い' }]);
  assert.strictEqual(result.lines.length, 2);
  assert.strictEqual(result.lines[0].cells.length, 20);
  assert.strictEqual(result.lines[1].cells[0].ch, 'い');
});

test('開きかぎは行の最後のマスに置かず、次の行の頭へ送る', () => {
  const result = lay([{ type: 'after_dialogue', text: repeat('あ', 19) + '「い' }]);
  assert.strictEqual(result.lines[0].cells[19].blank, true);
  assert.strictEqual(result.lines[1].cells[0].ch, '「');
});

test('会話文の2行目以降は1マス下げる', () => {
  const result = lay([{ type: 'dialogue', text: '「' + repeat('あ', 30) + '。」' }]);
  assert.strictEqual(result.lines[0].cells[0].ch, '「');
  assert.strictEqual(result.lines[1].cells[0].blank, true);
  assert.strictEqual(result.lines[1].cells[1].ch, 'あ');
});

test('会話文の2行目の頭に「。」」が来ても、前の行に入る', () => {
  const result = lay([{ type: 'dialogue', text: '「' + repeat('あ', 19) + '。」' }]);
  assert.strictEqual(result.lines.length, 1);
  assert.deepStrictEqual(result.lines[0].cells[19].hang, ['。', '」']);
  assert.deepStrictEqual(result.violations, []);
});

test('会話文の終わりの「。」」は行の途中でも1つのマス', () => {
  const result = lay([{ type: 'dialogue', text: '「あ。」' }]);
  assert.strictEqual(result.lines[0].cells.length, 3);
  assert.strictEqual(result.lines[0].cells[2].ch, '。');
  assert.deepStrictEqual(result.lines[0].cells[2].hang, ['」']);
});

test('「！」「？」のあとに、システムは空欄を足さない。児童が書いた空白は1マス残す', () => {
  const noSpace = lay([{ type: 'after_dialogue', text: 'あ！い？」う！！え' }]);
  assert.strictEqual(noSpace.lines[0].cells.map((c) => (c.blank ? '_' : cellText(c))).join(''), 'あ！い？」う！！え');
  const written = lay([{ type: 'after_dialogue', text: 'あ！ い' }]);
  assert.strictEqual(written.lines[0].cells.map((c) => (c.blank ? '_' : cellText(c))).join(''), 'あ！_い');
});

test('設定で SPACE_AFTER_EXCLAMATION を true にすると、「！」「？」のあとに1マス足す', () => {
  const on = layoutEssay(plainEssay([{ type: 'after_dialogue', text: 'あ！い？」う！！え' }]),
    Object.assign({}, cfg, { SPACE_AFTER_EXCLAMATION: true }));
  assert.strictEqual(on.lines[0].cells.map((c) => (c.blank ? '_' : cellText(c))).join(''), 'あ！_い？」う！！_え');
});

test('「ー」「！」「？」は行の頭に置いてよい', () => {
  const result = lay([{ type: 'after_dialogue', text: repeat('あ', 20) + 'ー' + repeat('あ', 19) + '！' }]);
  assert.strictEqual(result.lines[1].cells[0].ch, 'ー');
  assert.strictEqual(result.lines[2].cells[0].ch, '！');
  assert.deepStrictEqual(result.violations, []);
});

test('題名は上を3マスあけ、名前は下を1マスあける。本文は3行目から', () => {
  const result = layoutEssay({
    title: 'ぼくの夏', titleLocation: 'body', name: '中山 太郎', nameLocation: 'body',
    studentNumber: '3', blocks: [{ type: 'paragraph', text: 'きょうは。' }],
  }, cfg);
  assert.strictEqual(result.lines[0].cells[3].ch, 'ぼ');
  const name = result.lines[1].cells;
  assert.strictEqual(name.length, 19);
  assert.strictEqual(name[name.length - 1].ch, '郎');
  assert.strictEqual(result.lines[2].cells[1].ch, 'き');
});

test('題名が無い時は、名前が欄外に出る。本文は1行目から', () => {
  const parsed = parseGeminiOutput(JSON.stringify({ essays: [{
    studentNumber: '5', title: '', titleLocation: 'none', name: '山田 花子', nameLocation: 'body',
    blocks: [{ type: 'paragraph', text: 'わたしは。' }],
  }] }), cfg);
  const result = layoutEssay(parsed.essays[0], cfg);
  assert.strictEqual(result.margin.name, '山田 花子');
  assert.strictEqual(result.margin.title, '');
  assert.strictEqual(result.lines[0].cells[1].ch, 'わ');
});

test('欄外の題名と名前は、本文に入れず欄外に出す', () => {
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '7', title: 'うんどうかい', titleLocation: 'margin', name: '田中 一', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: 'がんばった。' }],
  }]), cfg);
  const result = layoutEssay(parsed.essays[0], cfg);
  assert.strictEqual(result.margin.title, 'うんどうかい');
  assert.strictEqual(result.margin.name, '田中 一');
  assert.strictEqual(result.lines[0].cells[1].ch, 'が');
});

test('乱数で10000通りの文を組み、行の頭に置けない字が一つも出ない', () => {
  let seed = 20261031;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const alphabet = Array.from('あいうえおかきくっゃゅょゎ。、。、！？ー」「（）…ッャ  ');
  const types = ['paragraph', 'dialogue', 'after_dialogue'];
  for (let trial = 0; trial < 10000; trial++) {
    const blocks = [];
    const count = 1 + Math.floor(random() * 4);
    for (let b = 0; b < count; b++) {
      let text = 'あ';
      const length = Math.floor(random() * 90);
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(random() * alphabet.length)];
      blocks.push({ type: types[Math.floor(random() * 3)], text: text });
    }
    const result = lay(blocks);
    const noWarnings = result.violations;
    assert.deepStrictEqual(noWarnings, [], '試行' + trial + ' ' + JSON.stringify(blocks) + ' ' + noWarnings.join(' / '));
  }
});

console.log('読み取り');

test('心の中の言葉は、20字までは文中に入る', () => {
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '1', name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: '見ると[[（どうしよう。）]]と思った。' }],
  }]), cfg);
  const blocks = parsed.essays[0].blocks;
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].text, '見ると（どうしよう。）と思った。');
});

test('心の中の言葉は、20字を超えたら会話文と同じ扱いで改行する', () => {
  const thought = '（' + repeat('あ', 21) + '。）';
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '1', name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: '見た。[[' + thought + ']]と思った。' }],
  }]), cfg);
  const blocks = parsed.essays[0].blocks;
  assert.deepStrictEqual(blocks.map((b) => b.type), ['paragraph', 'dialogue', 'after_dialogue']);
  assert.strictEqual(blocks[1].text, thought);
  assert.strictEqual(blocks[2].text, 'と思った。');
});

test('かぎかっこのあとに文が続く会話ブロックは、分けられる', () => {
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '1', name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'dialogue', text: '「おはよう。」と言って、「元気？」と聞いた。' }],
  }]), cfg);
  const blocks = parsed.essays[0].blocks;
  assert.deepStrictEqual(blocks.map((b) => b.type), ['dialogue', 'after_dialogue', 'dialogue', 'after_dialogue']);
  assert.strictEqual(blocks[0].text, '「おはよう。」');
  assert.strictEqual(blocks[3].text, 'と聞いた。');
});

test('かぎかっこで始まる段落は、会話文として扱われる', () => {
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '1', name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: '「ありがとう。」と言った。' }],
  }]), cfg);
  assert.strictEqual(parsed.essays[0].blocks[0].type, 'dialogue');
  assert.strictEqual(parsed.essays[0].blocks[1].type, 'after_dialogue');
});

test('用紙に出席番号が無い時は、最初のページ番号を使う。重なりと抜けを知らせる', () => {
  const make = (number, pages) => ({
    studentNumber: number, sourcePages: pages, name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: 'あ。' }],
  });
  const parsed = parseGeminiOutput(JSON.stringify([make(null, [1]), make('3', [2]), make('3', [3]), make('5', [4])]), cfg);
  assert.strictEqual(parsed.essays[0].numberSource, 'page');
  assert.ok(parsed.batchMessages.some((m) => m.includes('重なって')));
  assert.ok(parsed.batchMessages.some((m) => m.includes('抜け') && m.includes('2') && m.includes('4')));
});

test('ジェミニの返答のコードの囲みと全角の数字を読み取れる', () => {
  const body = '```json\n' + JSON.stringify({ essays: [{
    studentNumber: '１２', name: 'A', nameLocation: 'margin', blocks: [{ type: 'paragraph', text: 'あ。' }],
  }] }) + '\n```';
  assert.strictEqual(parseGeminiOutput(body, cfg).essays[0].studentNumber, '12');
});

test('JSONが壊れている時は、分かるエラーを出す', () => {
  assert.throws(() => parseGeminiOutput('{"essays": [', cfg), /途中で切れて/);
  assert.throws(() => parseGeminiOutput('作文はありません', cfg), /JSON/);
});

test('数字は漢数字に直す（十二・二十五・百・二〇二六年・三・五・千）', () => {
  const cases = [
    ['3びき', '三びき'], ['10人', '十人'], ['12こ', '十二こ'], ['25まい', '二十五まい'],
    ['100てん', '百てん'], ['2026年', '二〇二六年'], ['3.5キロ', '三・五キロ'], ['1,000円', '千円'],
    ['１２さい', '十二さい'], ['305', '三百五'], ['0', '〇'], ['20000', '二〇〇〇〇'], ['1年2組', '一年二組'],
  ];
  for (const [before, after] of cases) assert.strictEqual(convertNumerals(before, cfg).text, after, before);
});

test('漢数字に直した所は、直した所の一覧に「数字」として残る。名前は直さない', () => {
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '1', name: '田中 3郎', nameLocation: 'margin', title: '3月の日', titleLocation: 'margin',
    blocks: [{ type: 'paragraph', text: '5人で行った。' }],
  }]), cfg);
  const essay = parsed.essays[0];
  assert.strictEqual(essay.title, '三月の日');
  assert.strictEqual(essay.blocks[0].text, '五人で行った。');
  assert.strictEqual(essay.name, '田中 3郎');
  assert.strictEqual(essay.numeralChanges.length, 2);
});

test('段落の途中にある会話文は分ける。言葉の強調のかぎは文中に残す', () => {
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '1', name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: '先生が「よくがんばったね。」と言い、「ありがとう」の気持ちになった。' }],
  }]), cfg);
  const blocks = parsed.essays[0].blocks;
  assert.deepStrictEqual(blocks.map((b) => b.type), ['paragraph', 'dialogue', 'after_dialogue']);
  assert.strictEqual(blocks[1].text, '「よくがんばったね。」');
  assert.strictEqual(blocks[2].text, 'と言い、「ありがとう」の気持ちになった。');
});

test('かっこ（で始まる段落は、1マス下げず1マス目から書く', () => {
  const result = lay([{ type: 'paragraph', text: '（どうしよう。）と思った。' }]);
  assert.strictEqual(result.lines[0].cells[0].ch, '（');
});

test('「。」と「）」は別のマス。「。」」だけが同じマス', () => {
  const thought = lay([{ type: 'after_dialogue', text: '（あ。）' }]);
  assert.deepStrictEqual(thought.lines[0].cells.map((c) => cellText(c)), ['（', 'あ', '。', '）']);
  const speech = lay([{ type: 'dialogue', text: '「あ。」' }]);
  assert.deepStrictEqual(speech.lines[0].cells.map((c) => cellText(c)), ['「', 'あ', '。」']);
});

test('心の中の言葉が「 」で書かれていても、文中に残る（会話文と間違えて分けない）', () => {
  const parsed = parseGeminiOutput(JSON.stringify([{
    studentNumber: '1', name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: '見ると[[「どうしよう。」]]と思った。' }],
  }]), cfg);
  assert.strictEqual(parsed.essays[0].blocks.length, 1);
  assert.strictEqual(parsed.essays[0].blocks[0].text, '見ると「どうしよう。」と思った。');
});

test('心の中の言葉のかっこは、設定で（ ）か「 」にそろえられる', () => {
  const input = JSON.stringify([{
    studentNumber: '1', name: 'A', nameLocation: 'margin',
    blocks: [{ type: 'paragraph', text: '見ると[[「どうしよう。」]]と思った。' }],
  }]);
  const paren = parseGeminiOutput(input, Object.assign({}, cfg, { THOUGHT_BRACKET_STYLE: 'paren' }));
  assert.strictEqual(paren.essays[0].blocks[0].text, '見ると（どうしよう。）と思った。');
});

test('題名が長い時（12字以上）は、上を2マスにする', () => {
  const short = layoutEssay({ title: repeat('あ', 11), titleLocation: 'body', name: '', nameLocation: 'none', studentNumber: '1',
    blocks: [{ type: 'paragraph', text: 'い' }] }, cfg);
  const long = layoutEssay({ title: repeat('あ', 12), titleLocation: 'body', name: '', nameLocation: 'none', studentNumber: '1',
    blocks: [{ type: 'paragraph', text: 'い' }] }, cfg);
  assert.strictEqual(short.lines[0].cells.findIndex((c) => !c.blank), 3);
  assert.strictEqual(long.lines[0].cells.findIndex((c) => !c.blank), 2);
});

test('出席番号は「12番」を優先し、無ければ最後の数字を使う', () => {
  const { parseStudentNumber } = require('./parser.js');
  assert.strictEqual(parseStudentNumber('2年1組12番'), '12');
  assert.strictEqual(parseStudentNumber('2-1-7'), '7');
  assert.strictEqual(parseStudentNumber('５'), '5');
  assert.strictEqual(parseStudentNumber(null), null);
});

const oneEssay = (number, extra) => Object.assign({
  studentNumber: number, sourcePages: [Number(number)], name: 'A B', nameLocation: 'margin',
  blocks: [{ type: 'paragraph', text: 'あ。' }],
}, extra || {});

test('Gem の返事を2回分続けて貼っても、まとめて読み取る。学年も読む', () => {
  const text = '```json\n' + JSON.stringify({ grade: 2, essays: [oneEssay('1')] }) + '\n```\n' +
    '```json\n' + JSON.stringify({ grade: 2, essays: [oneEssay('2')] }) + '\n```';
  const parsed = parseGeminiOutput(text, cfg);
  assert.deepStrictEqual(parsed.essays.map((e) => e.studentNumber), ['1', '2']);
  assert.strictEqual(parsed.grade, '2');
});

test('途中で切れた返事と、続きがある返事を知らせる', () => {
  const whole = JSON.stringify({ grade: 2, unfinished: true, nextPage: 11, essays: [oneEssay('1')] });
  const cut = JSON.stringify({ grade: 2, essays: [oneEssay('2')] }).slice(0, 40);
  const parsed = parseGeminiOutput(whole + '\n' + cut, cfg);
  assert.strictEqual(parsed.essays.length, 1);
  assert.ok(parsed.batchMessages.some((m) => m.includes('続きがあります') && m.includes('11')));
  assert.ok(parsed.batchMessages.some((m) => m.includes('途中で切れて')));
});

test('本文が空の1人分は飛ばし、ほかの児童は読み込む', () => {
  const parsed = parseGeminiOutput(JSON.stringify({ essays: [oneEssay('1'), oneEssay('2', { blocks: [] })] }), cfg);
  assert.strictEqual(parsed.essays.length, 1);
  assert.ok(parsed.batchMessages.some((m) => m.includes('飛ばしました')));
});

test('「…」と言った のように、句点がなくても話した言葉なら分ける。「…」と書いた は残す', () => {
  const parsed = parseGeminiOutput(JSON.stringify([oneEssay('1', {
    blocks: [{ type: 'paragraph', text: '先生が「おはよう」と言った。紙に「ありがとう」と書いた。' }] })]), cfg);
  const blocks = parsed.essays[0].blocks;
  assert.deepStrictEqual(blocks.map((b) => b.type), ['paragraph', 'dialogue', 'after_dialogue']);
  assert.strictEqual(blocks[2].text, 'と言った。紙に「ありがとう」と書いた。');
});

test('複数ページの作文があり、ページ番号から出席番号を決めた時は知らせる', () => {
  const parsed = parseGeminiOutput(JSON.stringify([
    oneEssay(null, { sourcePages: [1, 2] }), oneEssay(null, { sourcePages: [3] })]), cfg);
  assert.ok(parsed.batchMessages.some((m) => m.includes('複数ページ')));
});

test('「…」という本 は会話文にしない', () => {
  const parsed = parseGeminiOutput(JSON.stringify([oneEssay('1', {
    blocks: [{ type: 'paragraph', text: '「ぐりとぐら」という本を読んだ。' }] })]), cfg);
  assert.strictEqual(parsed.essays[0].blocks.length, 1);
});

console.log('漢字');
const kanji = require('./kanji.js');

test('学年別漢字配当表の字数が公式と一致する（1026字）', () => {
  assert.deepStrictEqual(kanji.KANJI_BY_GRADE.map((s) => Array.from(s).length), [80, 160, 200, 202, 193, 191]);
  const all = kanji.KANJI_BY_GRADE.join('');
  assert.strictEqual(new Set(Array.from(all)).size, 1026);
});

test('2020年の改訂を反映している（茨は4年、囲は5年、胃は6年、城は4年）', () => {
  assert.strictEqual(kanji.gradeOf('茨'), 4);
  assert.strictEqual(kanji.gradeOf('囲'), 5);
  assert.strictEqual(kanji.gradeOf('胃'), 6);
  assert.strictEqual(kanji.gradeOf('城'), 4);
  assert.strictEqual(kanji.gradeOf('学'), 1);
  assert.strictEqual(kanji.gradeOf('鬱'), 7);
  assert.strictEqual(kanji.gradeOf('あ'), 0);
});

test('複数ページの作文: まとめて返されれば、枚数が増えて出席番号はそのまま', () => {
  const long = repeat('あ', 19) + '。';
  const parsed = parseGeminiOutput(JSON.stringify({ grade: 5, essays: [oneEssay('7', {
    sourcePages: [3, 4, 5], blocks: [10, 10, 8].map((n) => ({ type: 'paragraph', text: long.repeat(n) })) })] }), cfg);
  const result = layoutEssay(parsed.essays[0], cfg);
  assert.strictEqual(result.sheets.length, 2);
  assert.strictEqual(parsed.essays[0].studentNumber, '7');
  assert.deepStrictEqual(result.violations, []);
});

test('複数ページの作文を別の児童として返された時は、続きかもしれないと知らせる', () => {
  const parsed = parseGeminiOutput(JSON.stringify([
    oneEssay('7', { sourcePages: [3] }), oneEssay(null, { sourcePages: [4] }), oneEssay(null, { sourcePages: [5] })]), cfg);
  assert.ok(parsed.batchMessages.some((m) => m.includes('ページ 4') && m.includes('出席番号 7')));
  assert.ok(!parsed.batchMessages.some((m) => m.includes('ページ 5 は')));
});

console.log('直しの一覧（原文＋edits）');

const { applyEdits, materialize } = require('./parser.js');
const withEdits = (edits, text, extra) => parseGeminiOutput(JSON.stringify({ grade: 2, essays: [oneEssay('1', Object.assign({
  blocks: [{ type: 'paragraph', text: text }], edits: edits }, extra || {}))] }), cfg).essays[0];

test('本文は原文のまま受け取り、直しは edits から当てはめる（文脈で場所を決める）', () => {
  const essay = withEdits([{ kind: '脱字', before: 'リレ出', after: 'リレーに出', context: 'でリレ出ました' }], 'ぼくはリレ出ました。');
  assert.strictEqual(essay.rawBlocks[0].text, 'ぼくはリレ出ました。');
  assert.strictEqual(essay.blocks[0].text, 'ぼくはリレーに出ました。');
});

test('同じ言葉が2か所にあっても、文脈で指した所だけ直す。文脈が無い時は、すべて直す', () => {
  const text = 'ともだちとあそぶ。ともだちがきた。';
  const one = withEdits([{ kind: '漢字', before: 'ともだち', after: '友だち', context: 'ともだちがきた' }], text);
  assert.strictEqual(one.blocks[0].text, 'ともだちとあそぶ。友だちがきた。');
  const all = withEdits([{ kind: '漢字', before: 'ともだち', after: '友だち' }], text);
  assert.strictEqual(all.blocks[0].text, '友だちとあそぶ。友だちがきた。');
});

test('文脈があるのに見つからず、before が何か所もある時は、場所を決めず「当てはめられない」と知らせる', () => {
  const essay = withEdits([{ kind: '漢字', before: 'ともだち', after: '友だち', context: 'ありません' }], 'ともだちとあそぶ。ともだちがきた。');
  assert.strictEqual(essay.blocks[0].text, 'ともだちとあそぶ。ともだちがきた。');
  assert.strictEqual(essay.editStatus.get('e0').state, 'unresolved');
  assert.ok(essay.warnings.some((w) => w.includes('当てはめられなかった直し')));
});

test('原文に無い言葉を before にした直しは当てはめず、本文は原文のまま', () => {
  const essay = withEdits([{ kind: '誤字', before: 'わたしわ', after: 'わたしは' }], 'ぼくは行きました。');
  assert.strictEqual(essay.blocks[0].text, 'ぼくは行きました。');
  assert.strictEqual(essay.editStatus.get('e0').state, 'unresolved');
});

test('「段落」の直しは本文を変えず、一覧に残る', () => {
  const essay = withEdits([{ kind: '段落', before: 'た。はじめに', after: 'ここで段落を分けた' }], 'あいう。');
  assert.strictEqual(essay.blocks[0].text, 'あいう。');
  assert.strictEqual(essay.edits[0].kind, '段落');
});

test('重なる直しは、先の直しだけ当てはめ、あとの直しは知らせる', () => {
  const essay = withEdits([
    { kind: '漢字', before: 'おおきな', after: '大きな', context: 'おおきなこえ' },
    { kind: '誤字', before: 'きなこ', after: 'きなこ！', context: 'おおきなこえ' },
  ], 'おおきなこえ。');
  assert.strictEqual(essay.blocks[0].text, '大きなこえ。');
  assert.strictEqual(essay.editStatus.get('e1').state, 'overlap');
});

test('題名の直しも当てはめる。直しを選ばなければ、題名も原文のまま', () => {
  const essay = withEdits([{ kind: '漢字', before: 'うんどうかい', after: '運動会', context: 'うんどうかい' }], 'あ。', { title: 'うんどうかい', titleLocation: 'body' });
  assert.strictEqual(essay.title, 'うんどうかい'); // 運・動は3年。2年の作文では既定で反映しない
});

test('漢字の直しを学年で分ける（その学年は赤＝既定で反映／未習は既定で元のまま／前の学年は反映）', () => {
  const edits = [
    { kind: '漢字', before: 'ともだち', after: '友だち', context: 'ともだち' },
    { kind: '漢字', before: 'せんせい', after: '先生', context: 'せんせい' },
    { kind: '漢字', before: 'うんどう', after: '運動', context: 'うんどう' },
    { kind: '脱字', before: 'たの', after: 'たのし', context: 'たの' },
  ];
  const essay = withEdits(edits, 'ともだち、せんせい、うんどう、たの。');
  assert.deepStrictEqual(essay.edits.map((e) => [e.category, e.defaultApply]),
    [['decide', true], ['learned', true], ['unlearned', false], ['normal', true]]);
  assert.strictEqual(essay.blocks[0].text, '友だち、先生、うんどう、たのし。');
});

test('児童が自分で書いた漢字は、直しの before に入っていれば「新しく入れた漢字」に数えない', () => {
  const essay = withEdits([{ kind: '誤字', before: '運どう', after: '運動', context: '運どう' }], '運どうかい。');
  assert.strictEqual(essay.edits[0].category, 'unlearned'); // 「動」は新しく入る字（3年）
  const same = withEdits([{ kind: '誤字', before: '遊ぶよ', after: '遊ぼう', context: '遊ぶよ' }], '遊ぶよ。');
  assert.strictEqual(same.edits[0].category, 'normal'); // 「遊」は元からある字
});

test('選び直し: 直しを外すと元の言葉に戻り、区切りに「反映中／元のまま」が出る', () => {
  const essay = withEdits([{ kind: '漢字', before: 'ともだち', after: '友だち', context: 'ともだち' }], 'ともだちが来た。');
  const on = materialize(essay, cfg, () => true, null);
  const off = materialize(essay, cfg, () => false, null);
  assert.strictEqual(on.blocks[0].text, '友だちが来た。');
  assert.strictEqual(off.blocks[0].text, 'ともだちが来た。');
  const seg = (v) => v.segments.blocks[0].segments.find((x) => x.editId);
  assert.deepStrictEqual([seg(on).applied, seg(on).text], [true, '友だち']);
  assert.deepStrictEqual([seg(off).applied, seg(off).text], [false, 'ともだち']);
});

test('手で直した本文があれば、直しの一覧は使わず、その本文を組版に使う', () => {
  const essay = withEdits([{ kind: '漢字', before: 'ともだち', after: '友だち', context: 'ともだち' }], 'ともだちが来た。');
  const manual = materialize(essay, cfg, () => true, { title: '', blocks: [{ type: 'paragraph', text: 'ともだちが来ました。' }] });
  assert.strictEqual(manual.blocks[0].text, 'ともだちが来ました。');
  assert.strictEqual(manual.manual, true);
});

test('原文のあとに、会話文の分け・数字の漢数字化が行われる（直しを当てはめたあと）', () => {
  const essay = withEdits([{ kind: '脱字', before: 'いった', after: 'いった。', context: 'とおもっていった' }],
    '3人で「いこう。」とおもっていった');
  assert.strictEqual(essay.blocks[0].text, '三人で');
  assert.strictEqual(essay.blocks[1].type, 'dialogue');
  assert.strictEqual(essay.blocks[2].text, 'とおもっていった。');
});

test('学年が分からない時は、漢字の直しを分けず、すべて反映する', () => {
  const parsed = parseGeminiOutput(JSON.stringify({ essays: [oneEssay('1', {
    blocks: [{ type: 'paragraph', text: 'うんどうだ。' }],
    edits: [{ kind: '漢字', before: 'うんどう', after: '運動', context: 'うんどう' }] })] }), cfg);
  assert.strictEqual(parsed.essays[0].blocks[0].text, '運動だ。');
  assert.strictEqual(parsed.essays[0].edits[0].category, 'normal');
});

test('needsConfirmation: 赤（その学年）と橙（未習）だけ確認が要る', () => {
  const essay = withEdits([
    { kind: '漢字', before: 'ともだち', after: '友だち', context: 'ともだち' },
    { kind: '漢字', before: 'せんせい', after: '先生', context: 'せんせい' },
  ], 'ともだち、せんせい。');
  assert.deepStrictEqual(essay.edits.map(kanji.needsConfirmation), [true, false]);
});

console.log('テキスト形式（Gem の返事）');

const TEXT_SAMPLE = [
  '学年: 2年', '',
  '===== 出席番号 12 ／ ページ 3,4',
  '題名（本文）: うんどうかい',
  '名前（欄外）: 中山 太郎', '',
  'ぼくは、運動会でリレーに出ました。', '',
  'はじめに、みんなでじゅんびたいそうをしました。',
  '「がんばれ。」',
  'と、友だちが大きな声で言ってくれました。', '',
  '3人でゴールしました。',
  '※直した所: 脱字「リレ出→リレーに出」',
  '※確認: なし', '',
  '===== 出席番号 なし ／ ページ 5',
  '題名（なし）:',
  '名前（欄外）: 山田 花子', '',
  'きのうはおばあちゃんのいえにいきました。',
  '※直した所: なし',
  '※確認: 「ち」の字が読みにくい', '',
  '続きは ページ 6 から',
].join('\n');

test('テキスト形式: 出席番号・ページ・題名・名前の場所・段落・会話文を読み取る', () => {
  const parsed = parseGeminiOutput(TEXT_SAMPLE, cfg);
  assert.strictEqual(parsed.essays.length, 2);
  assert.strictEqual(parsed.grade, '2');
  const a = parsed.essays.find((e) => e.studentNumber === '12');
  assert.deepStrictEqual([a.studentNumber, a.sourcePages, a.title, a.titleLocation, a.name, a.nameLocation],
    ['12', [3, 4], 'うんどうかい', 'body', '中山 太郎', 'margin']);
  assert.deepStrictEqual(a.blocks.map((b) => b.type), ['paragraph', 'paragraph', 'dialogue', 'after_dialogue', 'paragraph']);
  assert.strictEqual(a.blocks[4].text, '三人でゴールしました。'); // 数字は漢数字に
  assert.strictEqual(a.gemNotes, '脱字「リレ出→リレーに出」');
});

test('テキスト形式: 題名なしの作文は、名前が欄外になり、出席番号はページ番号から決まる。確認事項は引き継ぐ', () => {
  const b = parseGeminiOutput(TEXT_SAMPLE, cfg).essays.find((e) => e.numberSource === 'page');
  assert.strictEqual(b.title, '');
  assert.strictEqual(b.titleLocation, 'none');
  assert.strictEqual(b.nameLocation, 'margin');
  assert.strictEqual(b.studentNumber, '5');
  assert.strictEqual(b.numberSource, 'page');
  assert.strictEqual(b.unsure.length, 1);
});

test('テキスト形式: 「続きは ページ ○ から」を知らせる。学年が無い時も読み込める', () => {
  const parsed = parseGeminiOutput(TEXT_SAMPLE.replace('学年: 2年', ''), cfg);
  assert.ok(parsed.batchMessages.some((m) => m.includes('続き') && m.includes('6')));
  assert.ok(parsed.batchMessages.some((m) => m.includes('学年が書かれていない')));
  assert.strictEqual(parsed.essays.length, 2);
});

test('テキスト形式: 先生が空行を足し引きして段落を変えた通りに読む。コードの囲み(```)は無視する', () => {
  const text = '```\n===== 出席番号 3 ／ ページ 1\n題名（本文）: あ\n名前（なし）:\n\nあい。\nうえ。\n\nおか。\n```';
  const essay = parseGeminiOutput(text, cfg).essays[0];
  assert.deepStrictEqual(essay.blocks.map((b) => b.text), ['あい。うえ。', 'おか。']);
});

test('テキスト形式の作文も、そのまま組版でき、行頭に禁則文字が来ない', () => {
  const essay = parseGeminiOutput(TEXT_SAMPLE, cfg).essays.find((e) => e.studentNumber === '12');
  assert.deepStrictEqual(layoutEssay(essay, cfg).violations, []);
});

test('テキスト形式: 改行が消えて同じ行に続いて貼られても、見出し・題名・名前・※を読み取る。行の折り返しの空白は詰める', () => {
  const flat = '学年: 2年\n\n===== 出席番号 なし ／ ページ 1 題名（なし）: 名前（欄外）: 山田 花子\n\nわたしは、二つ話します。\n\n一つ目は、あ。 次に、い。\n\n※直した所: 脱字「あ→あ」 ※確認: なし\n\n===== 出席番号 21 ／ ページ 2 題名（なし）: 名前（欄外）: 鈴木 太郎\n\nぼくは 家で 話した\n\n※直した所: なし ※確認: 読み取りが難しい';
  const essays = parseGeminiOutput(flat, cfg).essays;
  assert.strictEqual(essays.length, 2);
  const a = essays.find((e) => e.studentNumber === '1');
  assert.deepStrictEqual([a.name, a.nameLocation, a.titleLocation], ['山田 花子', 'margin', 'none']);
  assert.strictEqual(a.blocks[1].text, '一つ目は、あ。次に、い。');
  assert.strictEqual(a.gemNotes, '脱字「あ→あ」');
  const b = essays.find((e) => e.studentNumber === '21');
  assert.strictEqual(b.blocks[0].text, 'ぼくは家で話した');
  assert.strictEqual(b.unsure.length, 1);
});

test('テキスト形式: 返事を2回続けて貼っても、2回目の「学年」行が本文に混ざらない。続きが貼られていれば続きの案内は出さない', () => {
  const one = '学年: 2年\n\n===== 出席番号 1 ／ ページ 1,2\n題名（なし）:\n名前（なし）:\n\nあい。\n\n※直した所: なし\n※確認: なし\n\n処理したページ: 1〜2\n続きは ページ 3 から\n';
  const two = '学年: 2年\n\n===== 出席番号 2 ／ ページ 3\n題名（なし）:\n名前（なし）:\n\nうえ。\n\n※直した所: なし\n※確認: なし\n\n処理したページ: 3\n';
  const r = parseGeminiOutput(one + '\n' + two, cfg);
  assert.deepStrictEqual(r.essays.find((e) => e.studentNumber === '1').blocks.map((b) => b.text), ['あい。']);
  assert.deepStrictEqual(r.batchMessages.filter((m) => /続き|読み込まれていません/.test(m)), []);
});

test('テキスト形式: ページが飛んでいたら知らせる。最後に続きがあれば案内する', () => {
  const text = '学年: 2年\n\n===== 出席番号 1 ／ ページ 1\n題名（なし）:\n名前（なし）:\n\nあ。\n\n===== 出席番号 2 ／ ページ 3\n題名（なし）:\n名前（なし）:\n\nい。\n\n続きは ページ 4 から';
  const m = parseGeminiOutput(text, cfg).batchMessages.join('\n');
  assert.ok(/ページ 2 が読み込まれていません/.test(m), m);
  assert.ok(/次は 4 ページから/.test(m), m);
});

console.log('\n' + passed + ' 件通過' + (process.exitCode ? '（失敗あり）' : ''));
