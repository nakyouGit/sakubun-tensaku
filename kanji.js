/**
 * kanji.js
 * 学年別漢字配当表（2020年度からの小学校学習指導要領、計1026字）と、漢字の学年の確かめ。
 * 2008年の配当表に、2017年告示の改訂（都道府県名の漢字20字の追加と、学年の入れ替え）を加えて作った。
 * 字数: 1年80・2年160・3年200・4年202・5年193・6年191（公式の字数と一致することを試験で確かめる）。
 */
(function (root) {
  'use strict';

  const KANJI_BY_GRADE = Object.freeze([
      "一二三四五六七八九十百千上下左右中大小月日年早木林山川土空田天生花草虫犬人名女男子目耳口手足見音力気円入出立休先夕本文字学校村町森正水火玉王石竹糸貝車金雨赤青白", // 1年 80字
      "数多少万半形太細広長点丸交光角計直線矢弱強高同親母父姉兄弟妹自友体毛頭顔首心時曜朝昼夜分週春夏秋冬今新古間方北南東西遠近前後内外場地国園谷野原里市京風雪雲池海岩星室戸家寺通門道話言答声聞語読書記紙画絵図工教晴思考知才理算作元食肉馬牛魚鳥羽鳴麦米茶色黄黒来行帰歩走止活店買売午汽弓回会組船明社切電毎合当台楽公引科歌刀番用何", // 2年 160字
      "丁世両主乗予事仕他代住使係倍全具写列助勉動勝化区医去反取受号向君味命和品員商問坂央始委守安定実客宮宿寒対局屋岸島州帳平幸度庫庭式役待急息悪悲想意感所打投拾持指放整旅族昔昭暑暗曲有服期板柱根植業様横橋次歯死氷決油波注泳洋流消深温港湖湯漢炭物球由申界畑病発登皮皿相県真着短研礼神祭福秒究章童笛第筆等箱級終緑練羊美習者育苦荷落葉薬血表詩調談豆負起路身転軽農返追送速進遊運部都配酒重鉄銀開院陽階集面題飲館駅鼻", // 3年 200字
      "不争付令以仲伝位低例便信倉候借健側働億兆児共兵典冷初別利刷副功加努労勇包卒協単博印参司各周唱器固塩変夫失好季孫完官害察巣差希席帯底府康建径徒必念愛成戦折挙改敗散料旗昨景最望未末札材束松果栄案梅械極標機欠残氏民求治法泣浅浴清満漁灯無然焼照熱牧特産的省祝票種積競笑管節約結給続置老臣良芸芽英菜街衣要覚観訓試説課議貨軍輪辞辺連達選郡量録鏡関陸隊静順願類飛飯養験賀群徳富城茨媛岡潟岐熊香佐埼崎滋鹿縄井沖栃奈梨阪阜", // 4年 202字
      "久仏仮件任似余価保修個備像再刊判制則効務勢厚句可営因団圧在均基報境墓増夢妻婦容寄導居属布師常幹序弁張往復志応快性情態慣技招授採接提損支政故断旧易暴条枝査格桜検構武比永河液混減測準演潔災燃版犯状独率現留略益眼破確示祖禁移程税築精素経統絶綿総編績織罪義耕職肥能興舎術衛製複規解設許証評講謝識護豊財貧責貸貿資賛質輸述迷逆造過適酸鉱銅防限険際雑非領額飼囲紀喜救型航告殺士史象賞貯停堂得毒費粉脈歴", // 5年 193字
      "並乱乳亡仁供俳値傷優党冊処刻割創劇勤危卵厳収后否吸呼善困垂域奏奮姿存孝宅宇宗宙宝宣密寸専射将尊就尺届展層己巻幕干幼庁座延律従忘忠憲我批担拝拡捨探推揮操敬映晩暖暮朗机枚染株棒模権樹欲段沿泉洗派済源潮激灰熟片班異疑痛皇盛盟看砂磁私秘穀穴窓筋策簡糖系紅納純絹縦縮署翌聖肺背胸脳腹臓臨至若著蒸蔵蚕衆裁装裏補視覧討訪訳詞誌認誕誠誤論諸警貴賃遺郵郷針鋼閉閣降陛除障難革頂骨胃腸恩券承舌銭退敵俵預", // 6年 191字
  ]);

  const GRADE_OF = new Map();
  KANJI_BY_GRADE.forEach((chars, index) => {
    for (const ch of Array.from(chars)) GRADE_OF.set(ch, index + 1);
  });

  const isKanji = (ch) => /[\u4e00-\u9fff\u3400-\u4dbf々]/.test(ch);

  /** 漢字の配当学年（1〜6）。配当表にない漢字は 7（中学校以上）、漢字でなければ 0。 */
  function gradeOf(ch) {
    if (!isKanji(ch) || ch === '々') return 0;
    return GRADE_OF.get(ch) || 7;
  }

  /** 文字列の中の漢字を、学年ごとに分けて返す。 */
  function kanjiWithGrades(text) {
    const seen = new Map();
    for (const ch of Array.from(String(text || ''))) {
      const grade = gradeOf(ch);
      if (grade > 0) seen.set(ch, grade);
    }
    return Array.from(seen, ([ch, grade]) => ({ ch: ch, grade: grade }));
  }

  const gradeLabel = (grade) => (grade >= 7 ? '小学校で習わない' : grade + '年');

  /**
   * Gem の直し1件を、学年に照らして分ける。直しが新しく入れた漢字（before に無い漢字）だけを見る。
   * - unlearned: まだ習っていない漢字が入る → 既定は元のまま（反映しない）
   * - decide:    その学年で習う漢字が入る → 既定は反映、赤で先生が確かめる
   * - learned:   前の学年までの漢字だけ → 反映する
   * - normal:    漢字を新しく入れない直し → 反映する
   */
  function classifyEdit(edit, studentGrade) {
    const grade = Number(studentGrade);
    const original = new Set(Array.from(edit.before));
    const introduced = kanjiWithGrades(edit.after).filter((k) => !original.has(k.ch));
    edit.introduced = introduced;
    if (!grade || introduced.length === 0) {
      edit.category = 'normal';
      edit.defaultApply = true;
      return edit;
    }
    const highest = introduced.reduce((max, k) => Math.max(max, k.grade), 0);
    if (highest > grade) {
      edit.category = 'unlearned';
      edit.defaultApply = false;
    } else if (highest === grade) {
      edit.category = 'decide';
      edit.defaultApply = true;
    } else {
      edit.category = 'learned';
      edit.defaultApply = true;
    }
    return edit;
  }

  function classifyEdits(edits, studentGrade) {
    edits.forEach((edit) => classifyEdit(edit, studentGrade));
    return edits;
  }

  /** 先生が確かめる必要がある直しか（赤＝decide、橙＝unlearned）。 */
  const needsConfirmation = (edit) => edit.category === 'decide' || edit.category === 'unlearned';

  /**
   * 組版に渡す本文（題名を含む）に残っている、まだ習っていない漢字を知らせる。
   * 児童が自分で書いた漢字の可能性もあるので、知らせるだけで、勝手には直さない。
   */
  function unlearnedInText(text, studentGrade) {
    const grade = Number(studentGrade);
    if (!grade) return [];
    return kanjiWithGrades(text).filter((k) => k.grade > grade);
  }

  const api = {
    KANJI_BY_GRADE, gradeOf, kanjiWithGrades, gradeLabel, classifyEdit, classifyEdits, needsConfirmation, unlearnedInText,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunKanji = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
