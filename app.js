'use strict';

/* =========================================================
   ダイエット記録アプリ
   データはこの端末のブラウザ内（localStorage）にだけ保存する
   ========================================================= */

// ===== 定数 =====
const STORE_KEY = 'dietApp.v1';
const KCAL_PER_KG = 7200; // 体脂肪1kgあたりのおおよそのkcal

const ACTIVITY = {
  low:  { label: '低い', factor: 1.5,  example: '1日の大半を座って過ごす（デスクワーク中心で、運動はほとんどしない）' },
  mid:  { label: '普通', factor: 1.75, example: '座り仕事が中心だが、立ち仕事・移動・家事、軽い運動もする' },
  high: { label: '高い', factor: 2.0,  example: '立ち仕事や歩き回る仕事が多い、または活発な運動を習慣にしている' }
};

const MEALS = [['breakfast', '朝食'], ['lunch', '昼食'], ['dinner', '夕食'], ['snack', '間食']];

// 運動の種類（cat: activity=日常の活動 / exercise=息が弾む運動 / strength=筋トレ / other=軽いもの）
const BUILTIN_EX = [
  { name: 'ウォーキング（ふつう）', mets: 3.5, cat: 'activity' },
  { name: '速歩き', mets: 4.3, cat: 'exercise' },
  { name: 'ジョギング', mets: 7.0, cat: 'exercise' },
  { name: 'ランニング', mets: 9.8, cat: 'exercise' },
  { name: '自転車（ゆっくり）', mets: 4.0, cat: 'activity' },
  { name: '自転車（ややきつい）', mets: 6.8, cat: 'exercise' },
  { name: '筋トレ（軽め）', mets: 3.5, cat: 'strength' },
  { name: '筋トレ（きつめ）', mets: 6.0, cat: 'strength' },
  { name: '水泳（ゆっくり）', mets: 5.8, cat: 'exercise' },
  { name: '水泳（クロール）', mets: 8.3, cat: 'exercise' },
  { name: '階段のぼり', mets: 4.0, cat: 'exercise' },
  { name: '家事（掃除など）', mets: 3.3, cat: 'activity' },
  { name: 'ヨガ', mets: 2.5, cat: 'other' },
  { name: 'ストレッチ', mets: 2.3, cat: 'other' }
];
const CAT_LABEL = { activity: '日常の活動', exercise: '息が弾む運動', strength: '筋トレ', other: '軽い運動' };

// ===== 保存と読み込み =====
function defaultData() {
  return { profile: null, days: {}, favorites: [], mealSets: [], customExercises: [], lastBackup: null, createdAt: new Date().toISOString() };
}
function load() {
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (s) return Object.assign(defaultData(), JSON.parse(s));
  } catch (e) { /* 読めないときは新規 */ }
  return defaultData();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch (e) { toast('保存できませんでした'); }
}
let data = load();

// ===== 日付の道具 =====
function keyOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
function todayKey() { return keyOf(new Date()); }
function mondayOf(k) { const d = parseKey(k); return addDays(k, -((d.getDay() + 6) % 7)); }
function md(k) { const d = parseKey(k); return (d.getMonth() + 1) + '/' + d.getDate(); }
function jpDate(k) {
  const d = parseKey(k);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + '日月火水木金土'[d.getDay()] + '）';
}
function daysBetween(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }

// ===== 小さな道具 =====
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
function sign1(n) { return (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt1(Math.abs(n)); }
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2000);
}

// ===== 1日のデータ =====
function emptyDay() {
  return { meals: { breakfast: [], lunch: [], dinner: [], snack: [] }, exercises: [], weight: null, memo: '' };
}
function ensureDay(k) { if (!data.days[k]) data.days[k] = emptyDay(); return data.days[k]; }
function hasMeals(day) { return !!day && MEALS.some(([m]) => day.meals[m].length > 0); }
function intake(day) {
  if (!day) return 0;
  return MEALS.reduce((s, [m]) => s + day.meals[m].reduce((a, it) => a + it.kcal, 0), 0);
}
function hasRecord(day) {
  return !!day && (hasMeals(day) || day.exercises.length > 0 || day.weight != null || (day.memo || '') !== '');
}
// 空になった日は消して、データを小さく保つ
function tidyDay(k) { if (data.days[k] && !hasRecord(data.days[k])) delete data.days[k]; }

// k日まで（その日を含む）で一番新しい体重。なければ設定の体重
function currentWeight(k) {
  k = k || todayKey();
  let best = null;
  for (const key in data.days) {
    if (key <= k && data.days[key].weight != null && (best === null || key > best)) best = key;
  }
  return best ? data.days[best].weight : (data.profile ? data.profile.weight : 60);
}

// ===== 計算 =====
function calcBmi(w, h) { return w / Math.pow(h / 100, 2); }
function bmiClass(b) {
  if (b < 18.5) return '低体重';
  if (b < 25) return '普通体重';
  if (b < 30) return '肥満（1度）';
  if (b < 35) return '肥満（2度）';
  if (b < 40) return '肥満（3度）';
  return '肥満（4度）';
}
// Mifflin-St Jeor の式
function calcBmr(p, w) {
  const base = 10 * w + 6.25 * p.height - 5 * p.age;
  return p.sex === 'male' ? base + 5 : base - 161;
}
function calcPlan(p, w) {
  const bmi = calcBmi(w, p.height);
  const bmr = calcBmr(p, w);
  const tdee = bmr * ACTIVITY[p.activity].factor;
  // 自動計算の目標（消費量−500、基礎代謝が下限）に、自分で決めた調整分を足す
  const auto = Math.round(Math.max(tdee - 500, bmr));
  const adjust = p.kcalAdjust || 0;
  let target = tdee - 500 + adjust;
  let clamped = false;
  if (target < bmr) { target = bmr; clamped = true; }
  target = Math.round(target);
  const deficit = tdee - target;
  let eta = null;
  if (w > p.goalWeight && deficit > 0) {
    const days = Math.ceil((w - p.goalWeight) * KCAL_PER_KG / deficit);
    eta = { days, date: addDays(todayKey(), days) };
  }
  return { bmi, cls: bmiClass(bmi), bmr: Math.round(bmr), tdee: Math.round(tdee), target, auto, adjust, clamped, deficit, eta, reached: w <= p.goalWeight };
}
function planFor(k) { return calcPlan(data.profile, currentWeight(k)); }
function exKcal(mets, w, minutes) { return Math.round(mets * w * (minutes / 60) * 1.05); }
function allExercises() { return BUILTIN_EX.concat(data.customExercises); }

// 期間内の体重の平均（3回以上記録があるときだけ）
function avgWeight(endKey, n) {
  n = n || 7;
  const vals = [];
  for (let i = 0; i < n; i++) {
    const d = data.days[addDays(endKey, -i)];
    if (d && d.weight != null) vals.push(d.weight);
  }
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// ===== 週の集計 =====
function weekStats(start) {
  const keys = [];
  for (let i = 0; i < 7; i++) keys.push(addDays(start, i));
  let kcalSum = 0, kcalDays = 0, exMin = 0, exKcalSum = 0, recDays = 0;
  let vigMin = 0, strengthDays = 0;
  const weights = [];
  for (const k of keys) {
    const d = data.days[k];
    if (!d) continue;
    if (hasRecord(d)) recDays++;
    if (hasMeals(d)) { kcalSum += intake(d); kcalDays++; }
    let st = false;
    for (const e of d.exercises) {
      exMin += e.minutes; exKcalSum += e.kcal;
      if (e.cat === 'exercise') vigMin += e.minutes;
      if (e.cat === 'strength') st = true;
    }
    if (st) strengthDays++;
    if (d.weight != null) weights.push(d.weight);
  }
  const avgW = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
  return {
    keys, recDays, kcalDays, exMin, exKcal: exKcalSum, vigMin, strengthDays,
    avgKcal: kcalDays ? kcalSum / kcalDays : null,
    avgW
  };
}

// ===== 自動アドバイス（決まった基準で判定） =====
function makeAdvice() {
  const list = [];
  const p = data.profile;
  if (!p) return list;
  const t = todayKey();
  const plan = planFor(t);

  // 1) 食べなさすぎ：基礎代謝を下回る日が3日以上続く（今日は途中なので除く・未入力日は数えない）
  let run = 0, maxRun = 0;
  for (let i = 7; i >= 1; i--) {
    const d = data.days[addDays(t, -i)];
    if (hasMeals(d) && intake(d) < plan.bmr) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
  }
  if (maxRun >= 3) {
    list.push({ lv: 'bad', title: '食べなさすぎに注意', text: `摂取kcalが基礎代謝（${fmt(plan.bmr)}kcal）を下回る日が${maxRun}日続いています。筋肉が減りやすく、リバウンドの原因になります。目標の${fmt(plan.target)}kcal前後まで食べましょう。` });
  }

  // 2) 体重の減り方
  const a = avgWeight(t), b = avgWeight(addDays(t, -7)), c = avgWeight(addDays(t, -14));
  let paceGood = false;
  if (a != null && b != null) {
    const rate = (b - a) / b;
    if (rate > 0.01) {
      list.push({ lv: 'warn', title: 'ペースが速すぎます', text: `7日平均体重が1週間で${fmt1(b - a)}kg（${fmt1(rate * 100)}%）減っています。目安は週1%以内です。食事を減らしすぎていないか見直しましょう。` });
    } else if (rate > 0.001) {
      paceGood = true;
      list.push({ lv: 'good', title: '順調です', text: `7日平均体重が1週間で${fmt1(b - a)}kg減りました。無理のない良いペースです。この調子で続けましょう。` });
    }
  }
  // 3) 2週間ほぼ変わらない（±0.2kg以内）
  if (a != null && b != null && c != null && Math.abs(a - c) <= 0.2 && Math.abs(a - b) <= 0.2 && a > p.goalWeight) {
    const lower = Math.max(plan.bmr, plan.target - 150);
    list.push({ lv: 'warn', title: '体重が2週間ほぼ横ばいです', text: `目標kcalを100〜200kcal下げる（例：${fmt(plan.target)}→${fmt(lower)}kcal）か、運動を増やしてみましょう。基礎代謝（${fmt(plan.bmr)}kcal）は下回らないようにします。<br>目標kcalは「設定」→「目標kcalの調整」で変更できます。` });
  }

  // 4) 運動量を国の目安と比べる（直近7日）
  const w = weekStats(addDays(t, -6));
  const lack = [];
  // 日常の歩行（1日60分・約8,000歩）は歩数を記録しないため判定しない
  if (w.vigMin < 60) {
    lack.push(`息が弾む運動：週${fmt(w.vigMin)}分。目安の週60分まで、あと${fmt(60 - w.vigMin)}分（例：速歩きやジョギングを${fmt(Math.ceil((60 - w.vigMin) / 20))}回×20分）。`);
  }
  if (w.strengthDays < 2) {
    lack.push(`筋トレ：週${w.strengthDays}回。目安は週2〜3回です。あと${2 - w.strengthDays}回、スクワットや腕立てなどを取り入れましょう。`);
  }
  if (lack.length) {
    list.push({ lv: 'warn', title: '運動の目安との差（直近7日）', text: lack.join('<br>') });
  } else {
    list.push({ lv: 'good', title: '運動の目安を達成しています', text: '息が弾む運動（週60分以上）と筋トレ（週2回以上）の目安を満たしています。すばらしいです。' });
  }

  // 5) 食事が目標どおりの日が多ければ褒める
  let okDays = 0;
  for (let i = 1; i <= 7; i++) {
    const d = data.days[addDays(t, -i)];
    if (hasMeals(d)) { const v = intake(d); if (v >= plan.bmr && v <= plan.target + 100) okDays++; }
  }
  if (okDays >= 4 && maxRun < 3) {
    list.push({ lv: 'good', title: '食事の管理ができています', text: `直近7日のうち${okDays}日、目標どおりの摂取kcalでした。` });
  }

  if (!a && !hasMeals(data.days[addDays(t, -1)]) && list.length <= 1 && !paceGood) {
    list.unshift({ lv: 'good', title: '記録を続けましょう', text: '体重を1週間ほど記録すると、体重の変化についてのアドバイスも表示されます。' });
  }
  return list;
}

// ===== 画面の状態 =====
const state = {
  tab: 'home',
  month: keyOf(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  day: null,            // 開いている日（1日の記録画面）
  week: mondayOf(addDays(todayKey(), -1)), // 昨日を含む週（月曜に開いても空の週にならない）
  period: '1m',
  exSel: null,          // 選んでいる運動
  setup: null,          // 設定フォームの入力中の値
  sheetMeal: null
};

const view = document.getElementById('view');

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const tabs = document.getElementById('tabs');
  if (!data.profile) {
    tabs.classList.add('hidden');
    renderSetup(true);
    return;
  }
  tabs.classList.remove('hidden');
  if (state.tab === 'home') state.day ? renderDay() : renderHome();
  else if (state.tab === 'graph') renderGraph();
  else if (state.tab === 'week') renderWeek();
  else renderSettings();
}

// ===== 初回設定／基礎情報の変更 =====
function setupValues() {
  if (!state.setup) {
    const p = data.profile;
    state.setup = p
      ? { age: p.age, sex: p.sex, height: p.height, weight: currentWeight(), activity: p.activity, goalWeight: p.goalWeight }
      : { age: '', sex: null, height: '', weight: '', activity: null, goalWeight: '' };
  }
  return state.setup;
}
function validProfile(v) {
  const age = num(v.age), h = num(v.height), w = num(v.weight), g = num(v.goalWeight);
  if (!(age >= 15 && age <= 100)) return null;
  if (!(h >= 120 && h <= 220)) return null;
  if (!(w >= 30 && w <= 250)) return null;
  if (!(g >= 30 && g <= 250)) return null;
  if (!v.sex || !v.activity) return null;
  // 目標kcalの調整分は、基礎情報を変えても引き継ぐ
  const kcalAdjust = data.profile ? (data.profile.kcalAdjust || 0) : 0;
  return { age, sex: v.sex, height: h, weight: w, activity: v.activity, goalWeight: g, kcalAdjust };
}
function resultHtml(v) {
  const p = validProfile(v);
  if (!p) return '<p class="small">すべて入力すると、ここに計算結果が出ます。</p>';
  const r = calcPlan(p, p.weight);
  const goalBmi = calcBmi(p.goalWeight, p.height);
  let eta;
  if (r.reached) eta = '目標体重に到達しています';
  else if (r.eta) {
    const d = parseKey(r.eta.date);
    eta = `約${Math.ceil(r.eta.days / 7)}週間後（${d.getFullYear()}年${d.getMonth() + 1}月ごろ）`;
  } else eta = '計算できません';
  return `
    <table class="result">
      <tr><td>BMI</td><td>${fmt1(r.bmi)}（${r.cls}）</td></tr>
      <tr><td>基礎代謝<br><span class="small">何もしなくても使うkcal</span></td><td>${fmt(r.bmr)} kcal</td></tr>
      <tr><td>1日の推定消費量<br><span class="small">基礎代謝×${ACTIVITY[p.activity].factor}</span></td><td>${fmt(r.tdee)} kcal</td></tr>
      <tr><td>目標摂取kcal<br><span class="small">消費量−500kcal${r.adjust ? `（調整 ${r.adjust > 0 ? '+' : '−'}${Math.abs(r.adjust)}）` : ''}</span></td><td>${fmt(r.target)} kcal</td></tr>
      <tr><td>目標達成の目安</td><td>${eta}</td></tr>
    </table>
    ${r.clamped ? '<p class="small">※ 計算した目標が基礎代謝を下回るため、基礎代謝と同じ値にしています。</p>' : ''}
    ${goalBmi < 18.5 ? `<p class="small" style="color:var(--bad)">※ 目標体重はBMI ${fmt1(goalBmi)}（低体重）です。目標を見直すことをおすすめします。</p>` : ''}
    <p class="small">体脂肪1kg＝約7,200kcal として計算した目安です。</p>`;
}
function renderSetup(first) {
  const v = setupValues();
  document.getElementById('title').textContent = first ? 'はじめに' : '基礎情報の変更';
  view.innerHTML = `
    <div class="card">
      ${first ? '<h2>あなたの情報を入力してください</h2><p class="small">あとから設定画面で変更できます。データはこのiPhoneの中にだけ保存されます。</p>' : '<h2>基礎情報</h2>'}
      <label class="f">年齢</label>
      <input type="number" inputmode="numeric" pattern="[0-9]*" data-setup="age" value="${esc(v.age)}" placeholder="例：28">
      <label class="f">性別</label>
      <div class="choices">
        <button class="choice ${v.sex === 'male' ? 'on' : ''}" data-act="setSex" data-v="male">男性</button>
        <button class="choice ${v.sex === 'female' ? 'on' : ''}" data-act="setSex" data-v="female">女性</button>
      </div>
      <label class="f">身長（cm）</label>
      <input type="number" inputmode="decimal" data-setup="height" value="${esc(v.height)}" placeholder="例：170">
      <label class="f">${first ? '体重' : '今の体重'}（kg）</label>
      <input type="number" inputmode="decimal" data-setup="weight" value="${esc(v.weight)}" placeholder="例：72.5">
      <label class="f">活動量</label>
      <div class="choices one">
        ${Object.keys(ACTIVITY).map(k => `
          <button class="choice ${v.activity === k ? 'on' : ''}" data-act="setAct" data-v="${k}">
            ${ACTIVITY[k].label}（×${ACTIVITY[k].factor}）<span class="ex">${ACTIVITY[k].example}</span>
          </button>`).join('')}
      </div>
      <label class="f">目標体重（kg）</label>
      <input type="number" inputmode="decimal" data-setup="goalWeight" value="${esc(v.goalWeight)}" placeholder="例：65">
    </div>
    <div class="card">
      <h2>計算結果</h2>
      <div id="setupResult">${resultHtml(v)}</div>
    </div>
    <button class="btn" data-act="saveSetup">${first ? 'この内容ではじめる' : '保存する'}</button>
    ${first ? '' : '<button class="btn line" data-act="cancelSetup">やめる</button>'}`;
}

// ===== カレンダー（ホーム） =====
function noticesHtml() {
  let h = '';
  const t = todayKey();
  const td = data.days[t];
  if (!td || td.weight == null) {
    h += `<div class="notice"><span class="nt">⚖️ 今日の体重がまだ入力されていません</span><button data-act="openDay" data-k="${t}">入力する</button></div>`;
  }
  const base = data.lastBackup || data.createdAt;
  if (Object.keys(data.days).length > 0 && daysBetween(keyOf(new Date(base)), t) >= 7) {
    h += `<div class="notice"><span class="nt">💾 ${data.lastBackup ? '最後のバックアップから7日以上たちました' : 'まだバックアップをしていません'}</span><button data-act="tab" data-tab="settings">設定へ</button></div>`;
  }
  return h;
}
function renderHome() {
  document.getElementById('title').textContent = 'カレンダー';
  const t = todayKey();
  const first = parseKey(state.month);
  const y = first.getFullYear(), m = first.getMonth();
  const offset = (first.getDay() + 6) % 7; // 月曜はじまり
  const dim = new Date(y, m + 1, 0).getDate();
  let cells = '';
  ['月', '火', '水', '木', '金', '土', '日'].forEach((w, i) => {
    cells += `<div class="wd ${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${w}</div>`;
  });
  for (let i = 0; i < offset; i++) cells += '<div class="cell blank"></div>';
  for (let d = 1; d <= dim; d++) {
    const k = keyOf(new Date(y, m, d));
    const day = data.days[k];
    let inner = `<span class="dn">${d}</span>`;
    if (hasMeals(day)) {
      const kc = intake(day), tg = planFor(k).target;
      inner += `<span class="kc ${kc > tg ? 'over' : 'ok'}">${fmt(kc)}</span><span class="tg">/${fmt(tg)}</span>`;
    }
    let ic = '';
    if (day && day.exercises.length) ic += '🏃';
    if (day && day.weight != null) ic += '⚖️';
    if (ic) inner += `<span class="ic">${ic}</span>`;
    cells += `<button class="cell ${k === t ? 'today' : ''} ${k > t ? 'future' : ''}" data-act="openDay" data-k="${k}">${inner}</button>`;
  }
  view.innerHTML = `
    ${noticesHtml()}
    <div class="card">
      <div class="monthbar">
        <button class="navbtn" data-act="month" data-d="-1">‹</button>
        <h2>${y}年${m + 1}月</h2>
        <button class="navbtn" data-act="month" data-d="1">›</button>
      </div>
      <div class="cal">${cells}</div>
      <div class="legend">数字＝摂取kcal／目標（<span style="color:var(--main)">緑</span>は目標内、<span style="color:var(--warn)">橙</span>は超過）　🏃運動あり　⚖️体重入力済み</div>
    </div>
    <button class="btn" data-act="openDay" data-k="${t}">今日の記録をつける</button>`;
}

// ===== 1日の記録 =====
function renderDay() {
  const k = state.day;
  document.getElementById('title').textContent = '1日の記録';
  const day = data.days[k] || emptyDay();
  const plan = planFor(k);
  const total = intake(day);
  const diff = plan.target - total;
  const w = currentWeight(k);
  const exList = allExercises();
  const sel = state.exSel != null ? exList[state.exSel] : null;

  const mealsHtml = MEALS.map(([mk, ml]) => {
    const items = day.meals[mk];
    const sub = items.reduce((a, it) => a + it.kcal, 0);
    return `
      <h3><span>${ml}</span><span class="small">${items.length ? fmt(sub) + ' kcal' : ''}</span></h3>
      <ul class="items">
        ${items.map((it, i) => `
          <li><span class="nm">${esc(it.name)}</span><span class="kc">${fmt(it.kcal)} kcal</span>
            <button class="iconbtn" data-act="favAdd" data-m="${mk}" data-i="${i}" title="よく食べるものに登録">☆</button>
            <button class="iconbtn" data-act="mealDel" data-m="${mk}" data-i="${i}" title="削除">×</button></li>`).join('')}
      </ul>
      <div class="addrow">
        <input type="text" id="mn-${mk}" placeholder="品名">
        <input type="number" inputmode="numeric" pattern="[0-9]*" id="mk-${mk}" placeholder="kcal">
        <button class="btn" data-act="mealAdd" data-m="${mk}">追加</button>
      </div>
      <button class="btn sub" data-act="openFav" data-m="${mk}">★ よく食べるもの・セットから追加</button>
      ${items.length >= 2 ? `<button class="btn line" data-act="setFromMeal" data-m="${mk}">この${ml}をセットに登録</button>` : ''}`;
  }).join('');

  view.innerHTML = `
    <div class="dayhead">
      <button class="navbtn" data-act="dayMove" data-d="-1">‹</button>
      <h2>${jpDate(k)}${k === todayKey() ? '<br><span class="small">今日</span>' : ''}</h2>
      <button class="navbtn" data-act="dayMove" data-d="1">›</button>
    </div>

    <div class="card">
      <h2>⚖️ 体重</h2>
      <div class="row">
        <input type="number" inputmode="decimal" step="0.1" data-field="weight" value="${day.weight != null ? day.weight : ''}" placeholder="例：${fmt1(w)}">
        <span style="flex:none">kg</span>
      </div>
      <div class="hint">毎朝、<b>起床後・トイレの後・朝食の前</b>に測りましょう。毎日同じ条件で測ると、変化が正しくわかります。</div>
    </div>

    <div class="card">
      <h2>🍚 食事</h2>
      <div class="total">
        <span>合計 <span class="big">${fmt(total)}</span> kcal <span class="small">／目標 ${fmt(plan.target)}</span></span>
        <span class="diff ${diff < 0 ? 'over' : 'ok'}">${diff < 0 ? fmt(-diff) + ' kcal 超過' : 'あと ' + fmt(diff) + ' kcal'}</span>
      </div>
      <button class="btn line" data-act="copyPrev">前日と同じ食事を追加</button>
      ${mealsHtml}
    </div>

    <div class="card">
      <h2>🏃 運動</h2>
      <ul class="items">
        ${day.exercises.map((e, i) => `
          <li><span class="nm">${esc(e.name)}　${e.minutes}分</span><span class="kc">${fmt(e.kcal)} kcal${e.manual ? '' : '<br><span class="small">自動計算</span>'}</span>
            <button class="iconbtn" data-act="exDel" data-i="${i}" title="削除">×</button></li>`).join('')}
      </ul>
      <p class="small" style="margin:8px 0 6px">種類を選んでください（運動の目安の判定に使います）</p>
      <div class="exgrid" id="exGrid">
        ${exList.map((e, i) => `<button class="choice ${state.exSel === i ? 'on' : ''}" data-act="exSel" data-i="${i}">${esc(e.name)}<span class="ex">${e.mets} METs</span></button>`).join('')}
      </div>
      <label class="f">運動の名前 <span class="small">（任意）</span></label>
      <input type="text" id="exName" placeholder="例：朝ラン 5km">
      <p class="small">空欄なら、選んだ種類の名前で記録します。</p>
      <div class="row" style="margin-top:10px">
        <div><label class="f" style="margin-top:0">時間（分）</label>
          <input type="number" inputmode="numeric" pattern="[0-9]*" id="exMin" placeholder="例：30"></div>
        <div><label class="f" style="margin-top:0">消費kcal <span class="small">（任意）</span></label>
          <input type="number" inputmode="numeric" pattern="[0-9]*" id="exKcalIn" placeholder="自動計算"></div>
      </div>
      <p class="small">Nike Run Club など、ほかのアプリに表示された消費kcalがあれば入力してください。空欄なら自動で計算します。</p>
      <button class="btn" data-act="exAdd">運動を追加</button>
      <p class="small" id="exHint">${exHint(sel, w)}</p>
    </div>

    <div class="card">
      <h2>📝 一言メモ</h2>
      <textarea data-field="memo" placeholder="例：外食が多かった">${esc(day.memo || '')}</textarea>
    </div>

    <button class="btn line" data-act="closeDay">カレンダーに戻る</button>`;
}

// 運動の種類を選んだときの説明文
function exHint(sel, w) {
  return sel
    ? `${esc(sel.name)}：30分で約${fmt(exKcal(sel.mets, w, 30))}kcal（体重${fmt1(w)}kgで計算）`
    : '自動計算は「METs×体重×時間×1.05」です。METs＝安静時の何倍のエネルギーを使うかの値です。';
}

// ===== グラフ（自作） =====
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function periodRange() {
  const t = todayKey();
  if (state.period === '1m') return [addDays(t, -29), t];
  if (state.period === '3m') return [addDays(t, -89), t];
  const keys = Object.keys(data.days).sort();
  let s = keys.length ? keys[0] : addDays(t, -29);
  if (daysBetween(s, t) < 6) s = addDays(t, -6);
  return [s, t];
}
function setupCanvas(cv, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.parentElement.clientWidth;
  cv.style.height = h + 'px';
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '11px -apple-system, sans-serif';
  return { ctx, w, h };
}
// 目盛りのきりの良い間隔
function niceStep(range, count) {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
function drawAxes(ctx, w, h, pad, yMin, yMax, step, s, e, decimals) {
  ctx.strokeStyle = css('--line'); ctx.fillStyle = css('--sub'); ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    const y = pad.t + (1 - (v - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(v.toFixed(decimals), pad.l - 4, y);
  }
  // 日付（はじめ・真ん中・おわり）
  const n = daysBetween(s, e);
  ctx.textBaseline = 'top';
  [[0, 'left'], [0.5, 'center'], [1, 'right']].forEach(([f, al]) => {
    ctx.textAlign = al;
    ctx.fillText(md(addDays(s, Math.round(n * f))), pad.l + f * (w - pad.l - pad.r), h - pad.b + 6);
  });
}
function drawWeight(cv) {
  const { ctx, w, h } = setupCanvas(cv, 230);
  const [s, e] = periodRange();
  const n = daysBetween(s, e);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const k = addDays(s, i), d = data.days[k];
    if (d && d.weight != null) pts.push({ i, k, v: d.weight });
  }
  const goal = data.profile.goalWeight;
  if (!pts.length) {
    ctx.fillStyle = css('--sub'); ctx.textAlign = 'center';
    ctx.fillText('この期間の体重の記録がありません', w / 2, h / 2);
    return;
  }
  // 7日移動平均（その日を含む過去7日の平均）
  const ma = pts.map(p => {
    const vals = [];
    for (let j = 0; j < 7; j++) { const d = data.days[addDays(p.k, -j)]; if (d && d.weight != null) vals.push(d.weight); }
    return { i: p.i, v: vals.reduce((a, b) => a + b, 0) / vals.length };
  });
  let lo = Math.min(goal, ...pts.map(p => p.v)), hi = Math.max(goal, ...pts.map(p => p.v));
  const step = niceStep(Math.max(hi - lo, 1), 4);
  lo = Math.floor((lo - step * 0.3) / step) * step; hi = Math.ceil((hi + step * 0.3) / step) * step;
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const X = i => pad.l + (n ? i / n : 0.5) * (w - pad.l - pad.r);
  const Y = v => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
  drawAxes(ctx, w, h, pad, lo, hi, step, s, e, step < 1 ? 1 : 0);
  // 目標体重の横線
  ctx.strokeStyle = css('--warn'); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(pad.l, Y(goal)); ctx.lineTo(w - pad.r, Y(goal)); ctx.stroke();
  ctx.setLineDash([]);
  // 毎日の値（薄い点）
  ctx.fillStyle = css('--point');
  pts.forEach(p => { ctx.beginPath(); ctx.arc(X(p.i), Y(p.v), 3.5, 0, Math.PI * 2); ctx.fill(); });
  // 7日平均（太い線）
  ctx.strokeStyle = css('--main'); ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  ma.forEach((p, j) => { j ? ctx.lineTo(X(p.i), Y(p.v)) : ctx.moveTo(X(p.i), Y(p.v)); });
  ctx.stroke();
}
function drawKcal(cv) {
  const { ctx, w, h } = setupCanvas(cv, 210);
  const [s, e] = periodRange();
  const n = daysBetween(s, e);
  const target = planFor(e).target;
  const bars = [];
  for (let i = 0; i <= n; i++) {
    const d = data.days[addDays(s, i)];
    if (hasMeals(d)) bars.push({ i, v: intake(d) });
  }
  if (!bars.length) {
    ctx.fillStyle = css('--sub'); ctx.textAlign = 'center';
    ctx.fillText('この期間の食事の記録がありません', w / 2, h / 2);
    return;
  }
  let hi = Math.max(target, ...bars.map(b => b.v)) * 1.1;
  const step = niceStep(hi, 4);
  hi = Math.ceil(hi / step) * step;
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const slot = (w - pad.l - pad.r) / (n + 1);
  const bw = Math.max(1, slot * 0.7);
  const Y = v => pad.t + (1 - v / hi) * (h - pad.t - pad.b);
  drawAxes(ctx, w, h, pad, 0, hi, step, s, e, 0);
  bars.forEach(b => {
    ctx.fillStyle = b.v > target ? css('--warn') : css('--main');
    const x = pad.l + slot * b.i + (slot - bw) / 2;
    ctx.fillRect(x, Y(b.v), bw, Y(0) - Y(b.v));
  });
  ctx.strokeStyle = css('--text'); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(pad.l, Y(target)); ctx.lineTo(w - pad.r, Y(target)); ctx.stroke();
  ctx.setLineDash([]);
}
function renderGraph() {
  document.getElementById('title').textContent = 'グラフ';
  const per = [['1m', '1か月'], ['3m', '3か月'], ['all', '全期間']];
  view.innerHTML = `
    <div class="seg">${per.map(([k, l]) => `<button class="choice ${state.period === k ? 'on' : ''}" style="text-align:center" data-act="period" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="card">
      <h2>体重</h2>
      <canvas id="cvW"></canvas>
      <div class="chartlegend">
        <span><i style="background:var(--point);height:8px;width:8px;border-radius:50%"></i>毎日の値</span>
        <span><i style="background:var(--main)"></i>7日平均</span>
        <span><i style="background:var(--warn)"></i>目標 ${fmt1(data.profile.goalWeight)}kg</span>
      </div>
    </div>
    <div class="card">
      <h2>摂取kcal</h2>
      <canvas id="cvK"></canvas>
      <div class="chartlegend">
        <span><i style="background:var(--main)"></i>目標内</span>
        <span><i style="background:var(--warn)"></i>超過</span>
        <span><i style="background:var(--text)"></i>目標 ${fmt(planFor(todayKey()).target)}kcal</span>
      </div>
    </div>`;
  drawWeight(document.getElementById('cvW'));
  drawKcal(document.getElementById('cvK'));
}

// ===== 週のまとめ =====
function renderWeek() {
  document.getElementById('title').textContent = '週のまとめ';
  const s = state.week, e = addDays(s, 6);
  const st = weekStats(s), prev = weekStats(addDays(s, -7));
  const target = planFor(e).target;
  const wDiff = st.avgW != null && prev.avgW != null ? st.avgW - prev.avgW : null;
  const adv = makeAdvice();
  view.innerHTML = `
    <div class="card">
      <div class="monthbar">
        <button class="navbtn" data-act="week" data-d="-7">‹</button>
        <h2 style="font-size:16px">${md(s)}（月）〜${md(e)}（日）</h2>
        <button class="navbtn" data-act="week" data-d="7">›</button>
      </div>
      <div class="stats">
        <div class="stat"><div class="lb">平均摂取kcal（目標 ${fmt(target)}）</div><div class="vl">${st.avgKcal != null ? fmt(st.avgKcal) : '—'} <small>kcal</small></div></div>
        <div class="stat"><div class="lb">運動の合計</div><div class="vl">${fmt(st.exMin)} <small>分（${fmt(st.exKcal)}kcal）</small></div></div>
        <div class="stat"><div class="lb">7日平均体重</div><div class="vl">${st.avgW != null ? fmt1(st.avgW) : '—'} <small>kg</small></div></div>
        <div class="stat"><div class="lb">前週との差</div><div class="vl">${wDiff != null ? sign1(wDiff) : '—'} <small>kg</small></div></div>
        <div class="stat"><div class="lb">記録できた日</div><div class="vl">${st.recDays} <small>／7日</small></div></div>
        <div class="stat"><div class="lb">筋トレ</div><div class="vl">${st.strengthDays} <small>回（目安 週2〜3回）</small></div></div>
      </div>
      <button class="btn" data-act="copySummary">まとめをコピー</button>
      <p class="small">コピーした文章を、Claudeのチャットに貼り付けて相談できます。</p>
    </div>
    <div class="card">
      <h2>アドバイス（直近の記録から）</h2>
      ${adv.map(a => `<div class="advice ${a.lv}"><b>${a.title}</b>${a.text}</div>`).join('')}
      <p class="disclaimer">※ 決まった基準による目安です。持病がある場合や体調に不安がある場合は、医師に相談してください。運動の目安は厚生労働省「健康づくりのための身体活動・運動ガイド2023」（成人）によります。</p>
    </div>`;
}
function summaryText() {
  const p = data.profile;
  const s = state.week, e = addDays(s, 6);
  const st = weekStats(s), prev = weekStats(addDays(s, -7));
  const plan = planFor(e);
  const lines = [];
  lines.push(`【ダイエットの週まとめ】${md(s)}〜${md(e)}`);
  lines.push(`基本情報：${p.age}歳・${p.sex === 'male' ? '男性' : '女性'}・身長${p.height}cm・活動量「${ACTIVITY[p.activity].label}」・目標体重${p.goalWeight}kg`);
  lines.push(`基礎代謝${fmt(plan.bmr)}kcal／推定消費量${fmt(plan.tdee)}kcal／目標摂取${fmt(plan.target)}kcal${plan.adjust ? `（自動計算${fmt(plan.auto)}kcalから${plan.adjust > 0 ? '+' : '−'}${Math.abs(plan.adjust)}kcal調整）` : ''}`);
  lines.push('');
  lines.push(`・平均摂取kcal：${st.avgKcal != null ? fmt(st.avgKcal) + 'kcal（食事記録' + st.kcalDays + '日分）' : '記録なし'}`);
  lines.push(`・運動の合計：${fmt(st.exMin)}分（消費${fmt(st.exKcal)}kcal、息が弾む運動${fmt(st.vigMin)}分、筋トレ${st.strengthDays}回）`);
  lines.push(`・7日平均体重：${st.avgW != null ? fmt1(st.avgW) + 'kg' : '記録なし'}${st.avgW != null && prev.avgW != null ? '（前週との差 ' + sign1(st.avgW - prev.avgW) + 'kg）' : ''}`);
  lines.push(`・記録できた日：${st.recDays}／7日`);
  lines.push('');
  lines.push('日ごとの記録：');
  st.keys.forEach(k => {
    const d = data.days[k];
    if (!d) { lines.push(`${jpDate(k)} 記録なし`); return; }
    const parts = [];
    parts.push(hasMeals(d) ? `摂取${fmt(intake(d))}kcal` : '食事未入力');
    if (d.exercises.length) parts.push('運動 ' + d.exercises.map(x => `${x.name}${x.minutes}分`).join('・'));
    if (d.weight != null) parts.push(`体重${fmt1(d.weight)}kg`);
    if (d.memo) parts.push(`メモ「${d.memo.replace(/\n/g, ' ')}」`);
    lines.push(`${jpDate(k)} ${parts.join('／')}`);
  });
  lines.push('');
  lines.push('アプリの自動アドバイス：');
  makeAdvice().forEach(a => lines.push(`・${a.title}：${a.text.replace(/<br>/g, ' ')}`));
  lines.push('');
  lines.push('この内容をもとに、来週の食事と運動について相談に乗ってください。');
  return lines.join('\n');
}
function copyText(text) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* 失敗 */ }
    ta.remove();
    toast(ok ? 'コピーしました' : 'コピーできませんでした');
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('コピーしました'), fallback);
  } else fallback();
}

// ===== 設定 =====
function renderSettings() {
  document.getElementById('title').textContent = '設定';
  if (state.setup) { renderSetup(false); return; }
  const p = data.profile;
  const plan = planFor(todayKey());
  const lb = data.lastBackup ? new Date(data.lastBackup) : null;
  view.innerHTML = `
    <div class="card">
      <h2>基礎情報</h2>
      <table class="result">
        <tr><td>年齢・性別</td><td>${p.age}歳・${p.sex === 'male' ? '男性' : '女性'}</td></tr>
        <tr><td>身長</td><td>${p.height} cm</td></tr>
        <tr><td>今の体重</td><td>${fmt1(currentWeight())} kg</td></tr>
        <tr><td>活動量</td><td>${ACTIVITY[p.activity].label}（×${ACTIVITY[p.activity].factor}）</td></tr>
        <tr><td>目標体重</td><td>${fmt1(p.goalWeight)} kg</td></tr>
        <tr><td>BMI</td><td>${fmt1(plan.bmi)}（${plan.cls}）</td></tr>
        <tr><td>基礎代謝</td><td>${fmt(plan.bmr)} kcal</td></tr>
        <tr><td>推定消費量</td><td>${fmt(plan.tdee)} kcal</td></tr>
        <tr><td>目標摂取kcal</td><td>${fmt(plan.target)} kcal</td></tr>
      </table>
      <button class="btn sub" data-act="editSetup">基礎情報を変更する</button>
    </div>

    <div class="card">
      <h2>🎯 目標kcalの調整</h2>
      <table class="result">
        <tr><td>自動計算の目標</td><td>${fmt(plan.auto)} kcal</td></tr>
        <tr><td>調整</td><td>${p.kcalAdjust ? (p.kcalAdjust > 0 ? '+' : '−') + Math.abs(p.kcalAdjust) : '±0'} kcal</td></tr>
        <tr><td>今の目標</td><td style="color:var(--main)">${fmt(plan.target)} kcal</td></tr>
      </table>
      <div class="choices" style="grid-template-columns:repeat(4,1fr);margin-top:10px">
        ${[-100, -50, 50, 100].map(d => `<button class="choice" style="text-align:center;font-weight:700" data-act="adj" data-d="${d}">${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`).join('')}
      </div>
      <button class="btn line" data-act="adjReset">自動計算に戻す</button>
      ${plan.clamped ? `<p class="small" style="color:var(--warn)">※ 基礎代謝（${fmt(plan.bmr)}kcal）より下には設定できません。</p>` : ''}
      <p class="small">体重が2週間横ばいのときは、100〜200kcal下げるのが目安です。調整は−500〜+300kcalの範囲でできます。</p>
    </div>

    <div class="card">
      <h2>💾 バックアップ</h2>
      <p class="small">記録はこのiPhoneの中にだけあります。機種変更やデータ消失に備えて、ときどきファイルに書き出してください。</p>
      <p>最後のバックアップ：<b>${lb ? `${lb.getFullYear()}/${lb.getMonth() + 1}/${lb.getDate()}` : 'まだありません'}</b></p>
      <button class="btn" data-act="export">データを書き出す（保存）</button>
      <button class="btn line" data-act="import">書き出したファイルを読み込む</button>
    </div>

    ${setsCardHtml()}

    <div class="card">
      <h2>★ よく食べるもの</h2>
      <p class="small">1日の記録画面で、食事の ☆ を押すと登録できます。</p>
      <ul class="items">
        ${data.favorites.length ? data.favorites.map((f, i) => `
          <li><span class="nm">${esc(f.name)}</span><span class="kc">${fmt(f.kcal)} kcal</span>
          <button class="iconbtn" data-act="favDel" data-i="${i}">×</button></li>`).join('') : '<li class="muted">まだありません</li>'}
      </ul>
    </div>

    <div class="card">
      <h2>🏃 運動の種類を追加</h2>
      <label class="f">名前</label>
      <input type="text" id="cxName" placeholder="例：テニス">
      <label class="f">METs（強さの値）</label>
      <input type="number" inputmode="decimal" id="cxMets" placeholder="例：7.3">
      <p class="small">「運動名 METs」で検索すると値がわかります。3以上が「歩行相当以上」の強さです。</p>
      <label class="f">分類</label>
      <div class="choices" id="cxCat">
        ${['exercise', 'strength', 'activity', 'other'].map(c => `<button class="choice ${state.cxCat === c ? 'on' : ''}" data-act="cxCat" data-v="${c}">${CAT_LABEL[c]}</button>`).join('')}
      </div>
      <button class="btn" data-act="cxAdd">追加する</button>
      <ul class="items" style="margin-top:8px">
        ${data.customExercises.map((c, i) => `
          <li><span class="nm">${esc(c.name)}（${CAT_LABEL[c.cat]}）</span><span class="kc">${c.mets} METs</span>
          <button class="iconbtn" data-act="cxDel" data-i="${i}">×</button></li>`).join('')}
      </ul>
    </div>
    <p class="small" style="text-align:center">データは外部に送信されません</p>`;
}

// ===== いつもの食事セット =====
function setKcal(st) { return st.items.reduce((a, it) => a + it.kcal, 0); }
function setDraft() { if (!state.setDraft) state.setDraft = { name: '', items: [] }; return state.setDraft; }
function setsCardHtml() {
  const d = setDraft();
  return `
    <div class="card">
      <h2>🍱 いつもの食事セット</h2>
      <p class="small">何品かをまとめて登録し、記録画面から1回押すだけで追加できます。</p>
      <ul class="items">
        ${data.mealSets.length ? data.mealSets.map((st, i) => `
          <li><span class="nm">${esc(st.name)}<br><span class="small">${st.items.map(it => esc(it.name) + ' ' + fmt(it.kcal)).join('・')}</span></span>
          <span class="kc">${fmt(setKcal(st))} kcal</span>
          <button class="iconbtn" data-act="setDel" data-i="${i}">×</button></li>`).join('') : '<li class="muted">まだありません</li>'}
      </ul>
      <h3>新しいセットを作る</h3>
      <label class="f" style="margin-top:4px">セットの名前</label>
      <input type="text" data-draft="name" value="${esc(d.name)}" placeholder="例：いつもの朝食">
      <label class="f">中身</label>
      <ul class="items">
        ${d.items.map((it, i) => `<li><span class="nm">${esc(it.name)}</span><span class="kc">${fmt(it.kcal)} kcal</span>
          <button class="iconbtn" data-act="draftDel" data-i="${i}">×</button></li>`).join('')}
      </ul>
      <div class="addrow">
        <input type="text" id="dn" placeholder="品名">
        <input type="number" inputmode="numeric" pattern="[0-9]*" id="dk" placeholder="kcal">
        <button class="btn" data-act="draftAdd">追加</button>
      </div>
      ${data.favorites.length ? `<p class="small" style="margin:8px 0 4px">よく食べるものから入れる</p>
        <div class="exgrid">${data.favorites.map((f, i) => `<button class="choice" data-act="draftFav" data-i="${i}">${esc(f.name)}<span class="ex">${fmt(f.kcal)} kcal</span></button>`).join('')}</div>` : ''}
      ${d.items.length ? `<p style="margin:8px 0 0">合計 <b>${fmt(setKcal(d))} kcal</b></p>` : ''}
      <button class="btn" data-act="setSave">このセットを保存</button>
    </div>`;
}

// ===== よく食べるもの（下から出る小窓） =====
function openSheet(meal) {
  state.sheetMeal = meal;
  const sh = document.getElementById('sheet');
  const ml = MEALS.find(x => x[0] === meal)[1];
  sh.innerHTML = `<div class="panel">
    <h2>${ml}に追加</h2>
    <h3 style="margin:4px 0 6px;font-size:15px">🍱 いつもの食事セット</h3>
    ${data.mealSets.length
      ? data.mealSets.map((st, i) => `<button class="choice" style="width:100%;margin-bottom:6px" data-act="setUse" data-i="${i}">
          <span style="display:flex;justify-content:space-between"><span>${esc(st.name)}</span><b>${fmt(setKcal(st))} kcal</b></span>
          <span class="ex">${st.items.map(it => esc(it.name)).join('・')}</span></button>`).join('')
      : '<p class="small">まだありません。設定画面か、2品以上記録した食事の「セットに登録」から作れます。</p>'}
    <h3 style="margin:12px 0 6px;font-size:15px">★ よく食べるもの</h3>
    ${data.favorites.length
      ? data.favorites.map((f, i) => `<button class="choice" style="width:100%;margin-bottom:6px;display:flex;justify-content:space-between" data-act="favUse" data-i="${i}"><span>${esc(f.name)}</span><b>${fmt(f.kcal)} kcal</b></button>`).join('')
      : '<p class="muted">まだ登録がありません。食事の横の ☆ を押すと登録できます。</p>'}
    <button class="btn line" data-act="closeSheet">閉じる</button>
  </div>`;
  sh.classList.remove('hidden');
}
function closeSheet() { document.getElementById('sheet').classList.add('hidden'); }

// ===== ボタンを押したときの動き =====
const actions = {
  tab(el) { state.tab = el.dataset.tab; state.day = null; state.setup = null; window.scrollTo(0, 0); render(); },
  month(el) {
    const d = parseKey(state.month);
    state.month = keyOf(new Date(d.getFullYear(), d.getMonth() + Number(el.dataset.d), 1));
    render();
  },
  openDay(el) { state.tab = 'home'; state.day = el.dataset.k; state.exSel = null; window.scrollTo(0, 0); render(); },
  closeDay() {
    const d = parseKey(state.day);
    state.month = keyOf(new Date(d.getFullYear(), d.getMonth(), 1));
    state.day = null; window.scrollTo(0, 0); render();
  },
  dayMove(el) { state.day = addDays(state.day, Number(el.dataset.d)); render(); },

  // 食事
  mealAdd(el) {
    const m = el.dataset.m;
    const name = document.getElementById('mn-' + m).value.trim();
    const kcal = num(document.getElementById('mk-' + m).value);
    if (!name) { toast('品名を入力してください'); return; }
    if (kcal == null || kcal < 0 || kcal > 5000) { toast('kcalを数字で入力してください'); return; }
    ensureDay(state.day).meals[m].push({ name, kcal: Math.round(kcal) });
    save(); keepScroll(render);
  },
  mealDel(el) {
    const day = data.days[state.day];
    day.meals[el.dataset.m].splice(Number(el.dataset.i), 1);
    tidyDay(state.day); save(); keepScroll(render);
  },
  favAdd(el) {
    const it = data.days[state.day].meals[el.dataset.m][Number(el.dataset.i)];
    if (data.favorites.some(f => f.name === it.name && f.kcal === it.kcal)) { toast('すでに登録されています'); return; }
    data.favorites.push({ name: it.name, kcal: it.kcal });
    save(); toast('「' + it.name + '」を登録しました');
  },
  openFav(el) { openSheet(el.dataset.m); },
  favUse(el) {
    const f = data.favorites[Number(el.dataset.i)];
    ensureDay(state.day).meals[state.sheetMeal].push({ name: f.name, kcal: f.kcal });
    save(); closeSheet(); keepScroll(render); toast('追加しました');
  },
  closeSheet() { closeSheet(); },
  favDel(el) { data.favorites.splice(Number(el.dataset.i), 1); save(); keepScroll(render); },

  // 食事セット
  setUse(el) {
    const st = data.mealSets[Number(el.dataset.i)];
    const list = ensureDay(state.day).meals[state.sheetMeal];
    st.items.forEach(it => list.push({ name: it.name, kcal: it.kcal }));
    save(); closeSheet(); keepScroll(render); toast('「' + st.name + '」を追加しました');
  },
  setFromMeal(el) {
    const m = el.dataset.m;
    const ml = MEALS.find(x => x[0] === m)[1];
    const name = prompt('セットの名前を入力してください', 'いつもの' + ml);
    if (name == null) return;
    if (!name.trim()) { toast('名前を入力してください'); return; }
    const items = data.days[state.day].meals[m].map(it => ({ name: it.name, kcal: it.kcal }));
    data.mealSets.push({ name: name.trim(), items });
    save(); toast('セット「' + name.trim() + '」を登録しました');
  },
  draftAdd() {
    const name = document.getElementById('dn').value.trim();
    const kcal = num(document.getElementById('dk').value);
    if (!name) { toast('品名を入力してください'); return; }
    if (kcal == null || kcal < 0 || kcal > 5000) { toast('kcalを数字で入力してください'); return; }
    setDraft().items.push({ name, kcal: Math.round(kcal) });
    keepScroll(render);
  },
  draftFav(el) {
    const f = data.favorites[Number(el.dataset.i)];
    setDraft().items.push({ name: f.name, kcal: f.kcal });
    keepScroll(render);
  },
  draftDel(el) { setDraft().items.splice(Number(el.dataset.i), 1); keepScroll(render); },
  setSave() {
    const d = setDraft();
    if (!d.name.trim()) { toast('セットの名前を入力してください'); return; }
    if (!d.items.length) { toast('中身を1品以上入れてください'); return; }
    data.mealSets.push({ name: d.name.trim(), items: d.items });
    state.setDraft = null;
    save(); keepScroll(render); toast('セットを保存しました');
  },
  setDel(el) {
    const st = data.mealSets[Number(el.dataset.i)];
    if (!confirm('セット「' + st.name + '」を削除しますか？（記録済みの食事は消えません）')) return;
    data.mealSets.splice(Number(el.dataset.i), 1); save(); keepScroll(render);
  },
  copyPrev() {
    const prev = data.days[addDays(state.day, -1)];
    if (!hasMeals(prev)) { toast('前日の食事の記録がありません'); return; }
    if (!confirm('前日の食事をこの日に追加します。よろしいですか？')) return;
    const day = ensureDay(state.day);
    MEALS.forEach(([m]) => prev.meals[m].forEach(it => day.meals[m].push({ name: it.name, kcal: it.kcal })));
    save(); keepScroll(render); toast('前日の食事を追加しました');
  },

  // 運動
  // 種類を選ぶ（入力途中の名前や数字が消えないよう、画面は描き直さない）
  exSel(el) {
    state.exSel = Number(el.dataset.i);
    document.querySelectorAll('#exGrid .choice').forEach(b => b.classList.toggle('on', b === el));
    document.getElementById('exHint').innerHTML = exHint(allExercises()[state.exSel], currentWeight(state.day));
  },
  exAdd() {
    const e = state.exSel != null ? allExercises()[state.exSel] : null;
    if (!e) { toast('運動の種類を選んでください'); return; }
    const min = num(document.getElementById('exMin').value);
    if (min == null || min <= 0 || min > 600) { toast('時間（分）を入力してください'); return; }
    // 消費kcalが入力されていればその値を使い、空欄なら自動計算
    const kcalRaw = document.getElementById('exKcalIn').value.trim();
    const kcalIn = num(kcalRaw);
    if (kcalRaw !== '' && (kcalIn == null || kcalIn < 0 || kcalIn > 5000)) { toast('消費kcalを数字で入力してください'); return; }
    const w = currentWeight(state.day);
    const customName = document.getElementById('exName').value.trim();
    const item = { name: customName || e.name, mets: e.mets, cat: e.cat, minutes: Math.round(min), kcal: kcalIn != null ? Math.round(kcalIn) : exKcal(e.mets, w, min) };
    if (kcalIn != null) item.manual = true;
    ensureDay(state.day).exercises.push(item);
    state.exSel = null;
    save(); keepScroll(render); toast('追加しました');
  },
  exDel(el) { data.days[state.day].exercises.splice(Number(el.dataset.i), 1); tidyDay(state.day); save(); keepScroll(render); },

  // グラフ・まとめ
  period(el) { state.period = el.dataset.v; render(); },
  week(el) { state.week = addDays(state.week, Number(el.dataset.d)); render(); },
  copySummary() { copyText(summaryText()); },

  // 初回設定・基礎情報
  setSex(el) { setupValues().sex = el.dataset.v; keepScroll(render); },
  setAct(el) { setupValues().activity = el.dataset.v; keepScroll(render); },
  editSetup() { state.setup = null; setupValues(); window.scrollTo(0, 0); render(); },
  cancelSetup() { state.setup = null; window.scrollTo(0, 0); render(); },
  saveSetup() {
    const v = setupValues();
    const p = validProfile(v);
    if (!p) { toast('入力していない項目か、範囲外の値があります'); return; }
    const first = !data.profile;
    const t = todayKey();
    // 体重を変えたときは今日の体重としても記録する
    if (first || Math.abs(p.weight - currentWeight(t)) > 0.001) ensureDay(t).weight = p.weight;
    data.profile = p;
    state.setup = null;
    save(); window.scrollTo(0, 0); render();
    toast(first ? '設定しました。記録をはじめましょう' : '保存しました');
  },

  // 運動の種類の追加
  cxCat(el) { state.cxCat = el.dataset.v; document.querySelectorAll('#cxCat .choice').forEach(b => b.classList.toggle('on', b === el)); },
  cxAdd() {
    const name = document.getElementById('cxName').value.trim();
    const mets = num(document.getElementById('cxMets').value);
    if (!name) { toast('名前を入力してください'); return; }
    if (mets == null || mets <= 0 || mets > 25) { toast('METsを数字で入力してください'); return; }
    if (!state.cxCat) { toast('分類を選んでください'); return; }
    data.customExercises.push({ name, mets, cat: state.cxCat });
    state.cxCat = null;
    save(); keepScroll(render); toast('追加しました');
  },
  cxDel(el) { data.customExercises.splice(Number(el.dataset.i), 1); save(); keepScroll(render); },

  // 目標kcalの調整（基礎代謝より下には下げない）
  adj(el) {
    const p = data.profile;
    const d = Number(el.dataset.d);
    const plan = planFor(todayKey());
    if (d < 0 && plan.clamped) { toast('基礎代謝より下には設定できません'); return; }
    const next = Math.max(-500, Math.min(300, (p.kcalAdjust || 0) + d));
    if (next === (p.kcalAdjust || 0)) { toast('これ以上は調整できません'); return; }
    p.kcalAdjust = next;
    save(); keepScroll(render); toast('目標を ' + fmt(planFor(todayKey()).target) + ' kcal にしました');
  },
  adjReset() { data.profile.kcalAdjust = 0; save(); keepScroll(render); toast('自動計算に戻しました'); },

  // バックアップ
  export() {
    data.lastBackup = new Date().toISOString();
    save();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'diet-backup-' + todayKey() + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    keepScroll(render);
  },
  import() { document.getElementById('importFile').click(); }
};

// 画面を描き直しても、見ていた位置を保つ
function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el);
});
// 小窓の外側を押したら閉じる
document.getElementById('sheet').addEventListener('click', ev => { if (ev.target.id === 'sheet') closeSheet(); });

// 入力欄の変更（体重・メモ、初回設定）
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.draft) setDraft()[el.dataset.draft] = el.value;
  if (el.dataset.setup) {
    setupValues()[el.dataset.setup] = el.value;
    const r = document.getElementById('setupResult');
    if (r) r.innerHTML = resultHtml(state.setup);
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset.field && state.day) {
    const f = el.dataset.field;
    const day = ensureDay(state.day);
    if (f === 'memo') day.memo = el.value.trim();
    else {
      const v = num(el.value);
      if (v != null && (v < 30 || v > 250)) { toast('体重の値を確認してください'); return; }
      day.weight = v != null ? Math.round(v * 10) / 10 : null;
    }
    tidyDay(state.day); save();
    if (f !== 'memo') keepScroll(render);
    toast('保存しました');
  }
});

// バックアップの読み込み
document.getElementById('importFile').addEventListener('change', ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || typeof d.days !== 'object' || !d.profile) throw new Error('形式が違います');
      if (!confirm('今のデータを、読み込んだファイルの内容で置き換えます。よろしいですか？')) return;
      data = Object.assign(defaultData(), d);
      save(); render(); toast('読み込みました');
    } catch (e) { toast('このファイルは読み込めませんでした'); }
  };
  reader.readAsText(file);
});

// 画面の幅が変わったらグラフを描き直す
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.tab === 'graph') render(); }, 200);
});
// 日付が変わったあとにアプリへ戻ってきたとき、表示を更新する
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.tab === 'home' && !state.day) render(); });

render();

// オフラインでも動くようにする仕組み（サービスワーカー）を登録
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 失敗しても通常どおり使える */ });
}
