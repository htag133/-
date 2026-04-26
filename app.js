const STORAGE_KEY = "kt-card-gacha-state-v1";
const ROTATION_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 30;
const RARITY_ORDER = ["N", "R", "SR", "SSR", "UR"];
const RARITY_VALUES = { N: 50, R: 120, SR: 500, SSR: 2500, UR: 39000 };

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.blackoutNodes = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.master || !this.ctx) {
      return;
    }
    const now = this.ctx.currentTime;
    const target = this.enabled ? 0.75 : 0;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(target, now, 0.02);
    if (!this.enabled) {
      this.stopBlackoutHum();
    }
  }

  async prime() {
    const ctx = this.ensureContext();
    if (!ctx) {
      return false;
    }
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    return true;
  }

  ensureContext() {
    if (this.ctx) {
      return this.ctx;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.75 : 0;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  playCountdown(value) {
    const freqMap = { 3: 620, 2: 730, 1: 860 };
    const base = freqMap[value] ?? 680;
    this.playTone({ freq: base, type: "square", duration: 0.12, gain: 0.15 });
    this.playTone({ freq: base * 1.98, type: "sine", duration: 0.07, gain: 0.06, when: 0.014 });
  }

  playGo() {
    this.playTone({ freq: 780, type: "triangle", duration: 0.11, gain: 0.14 });
    this.playTone({ freq: 1020, type: "sine", duration: 0.19, gain: 0.11, when: 0.05 });
  }

  playPuchun() {
    const ctx = this.readyContext();
    if (!ctx) {
      return;
    }
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(540, t);
    osc.frequency.exponentialRampToValueAtTime(74, t + 0.22);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1300, t);
    filter.frequency.exponentialRampToValueAtTime(240, t + 0.22);

    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(0.28, t + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.24);

    this.playNoise({ duration: 0.12, gain: 0.2, filterFreq: 1600 });
  }

  startBlackoutHum() {
    this.stopBlackoutHum();
    const ctx = this.readyContext();
    if (!ctx) {
      return () => {};
    }
    const t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    const mix = ctx.createGain();
    const oscLow = ctx.createOscillator();
    const oscHigh = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    filter.type = "lowpass";
    filter.frequency.value = 190;
    mix.gain.value = 0.13;

    oscLow.type = "triangle";
    oscLow.frequency.value = 45;
    oscHigh.type = "sine";
    oscHigh.frequency.value = 92;
    lfo.type = "sine";
    lfo.frequency.value = 7.5;
    lfoGain.gain.value = 0.03;

    lfo.connect(lfoGain);
    lfoGain.connect(mix.gain);

    oscLow.connect(filter);
    oscHigh.connect(filter);
    filter.connect(mix);
    mix.connect(this.master);

    oscLow.start(t);
    oscHigh.start(t);
    lfo.start(t);

    this.blackoutNodes = { oscLow, oscHigh, lfo, mix, filter, lfoGain };
    return () => this.stopBlackoutHum();
  }

  stopBlackoutHum() {
    if (!this.blackoutNodes || !this.ctx) {
      return;
    }
    const t = this.ctx.currentTime;
    const { oscLow, oscHigh, lfo, mix, filter, lfoGain } = this.blackoutNodes;
    mix.gain.cancelScheduledValues(t);
    mix.gain.setTargetAtTime(0.0001, t, 0.05);
    const stopAt = t + 0.18;
    try {
      oscLow.stop(stopAt);
      oscHigh.stop(stopAt);
      lfo.stop(stopAt);
    } catch {
      // already stopped
    }
    window.setTimeout(() => {
      safeDisconnect(oscLow);
      safeDisconnect(oscHigh);
      safeDisconnect(lfo);
      safeDisconnect(filter);
      safeDisconnect(mix);
      safeDisconnect(lfoGain);
    }, 260);
    this.blackoutNodes = null;
  }

  playColorResult(color, blackout) {
    const config = {
      white: { notes: [780, 1170], gain: 0.12, wave: "sine", dur: 0.26 },
      blue: { notes: [560, 840], gain: 0.14, wave: "triangle", dur: 0.28 },
      green: { notes: [460, 690, 920], gain: 0.13, wave: "triangle", dur: 0.3 },
      red: { notes: [340, 510], gain: 0.17, wave: "sawtooth", dur: 0.3 },
      gold: { notes: [460, 690, 920, 1380], gain: 0.15, wave: "triangle", dur: 0.42 },
      rainbow: { notes: [420, 630, 840, 1260, 1680], gain: 0.16, wave: "sine", dur: 0.52 },
    }[color] ?? { notes: [640, 960], gain: 0.12, wave: "sine", dur: 0.26 };

    config.notes.forEach((note, index) => {
      this.playTone({
        freq: note,
        type: config.wave,
        duration: config.dur,
        gain: config.gain / Math.max(1, config.notes.length / 2),
        when: index * 0.014,
      });
    });

    if (blackout) {
      this.playTone({ freq: 120, type: "triangle", duration: 0.24, gain: 0.11, when: 0.01 });
    }
  }

  playSell() {
    this.playTone({ freq: 760, type: "square", duration: 0.08, gain: 0.08 });
    this.playTone({ freq: 980, type: "sine", duration: 0.14, gain: 0.08, when: 0.06 });
  }

  playUi() {
    this.playTone({ freq: 540, type: "sine", duration: 0.06, gain: 0.05 });
  }

  playTone({ freq, type = "sine", duration = 0.12, gain = 0.1, when = 0 }) {
    const ctx = this.readyContext();
    if (!ctx) {
      return;
    }
    const now = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freq), now);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gainNode);
    gainNode.connect(this.master);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playNoise({ duration = 0.12, gain = 0.12, filterFreq = 1400 }) {
    const ctx = this.readyContext();
    if (!ctx) {
      return;
    }
    if (!this.noiseBuffer) {
      this.noiseBuffer = buildNoiseBuffer(ctx);
    }
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gainNode = ctx.createGain();

    src.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = filterFreq;

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  readyContext() {
    if (!this.enabled) {
      return null;
    }
    const ctx = this.ensureContext();
    if (!ctx || !this.master || ctx.state !== "running") {
      return null;
    }
    return ctx;
  }
}

const rarityRank = { N: 1, R: 2, SR: 3, SSR: 4, UR: 5 };

const typeArt = {
  Fire: "linear-gradient(140deg, #f97316, #7f1d1d)",
  Water: "linear-gradient(140deg, #38bdf8, #1e3a8a)",
  Wind: "linear-gradient(140deg, #4ade80, #14532d)",
  Thunder: "linear-gradient(140deg, #facc15, #713f12)",
  Shadow: "linear-gradient(140deg, #a78bfa, #312e81)",
  Crystal: "linear-gradient(140deg, #f472b6, #831843)",
};

const typePalette = {
  Fire: { bgA: "#7f1d1d", bgB: "#fb923c", body: "#f97316", accent: "#fde047", eye: "#3f2e1c" },
  Water: { bgA: "#1e3a8a", bgB: "#38bdf8", body: "#22d3ee", accent: "#dbeafe", eye: "#172554" },
  Wind: { bgA: "#14532d", bgB: "#4ade80", body: "#34d399", accent: "#dcfce7", eye: "#14532d" },
  Thunder: { bgA: "#713f12", bgB: "#facc15", body: "#f59e0b", accent: "#fef9c3", eye: "#422006" },
  Shadow: { bgA: "#312e81", bgB: "#a78bfa", body: "#8b5cf6", accent: "#ede9fe", eye: "#1e1b4b" },
  Crystal: { bgA: "#831843", bgB: "#f472b6", body: "#ec4899", accent: "#ffe4e6", eye: "#500724" },
};

const cards = [
  { id: "c001", name: "ヒノトカゲル", rarity: "N", type: "Fire", hp: 70, atk: 58, skill: "もえるしっぽ" },
  { id: "c002", name: "アクアプチ", rarity: "N", type: "Water", hp: 76, atk: 52, skill: "しずくバブル" },
  { id: "c003", name: "フワリーフ", rarity: "N", type: "Wind", hp: 74, atk: 50, skill: "そよかぜタッチ" },
  { id: "c004", name: "ピカトン", rarity: "N", type: "Thunder", hp: 65, atk: 60, skill: "ちいさなスパーク" },
  { id: "c005", name: "カゲモコ", rarity: "N", type: "Shadow", hp: 78, atk: 49, skill: "くもりミスト" },
  { id: "c006", name: "ミニクリオ", rarity: "N", type: "Crystal", hp: 68, atk: 56, skill: "きらめきタッチ" },
  { id: "c007", name: "ブレイズキャット", rarity: "R", type: "Fire", hp: 88, atk: 71, skill: "ファイアパンチ" },
  { id: "c008", name: "マリンボア", rarity: "R", type: "Water", hp: 92, atk: 67, skill: "うずしおラッシュ" },
  { id: "c009", name: "スカイホッパー", rarity: "R", type: "Wind", hp: 84, atk: 72, skill: "エアカッター" },
  { id: "c010", name: "ボルトバード", rarity: "R", type: "Thunder", hp: 80, atk: 75, skill: "いなずまくちばし" },
  { id: "c011", name: "ナイトリンク", rarity: "R", type: "Shadow", hp: 95, atk: 64, skill: "シャドウバイト" },
  { id: "c012", name: "プリズミン", rarity: "R", type: "Crystal", hp: 82, atk: 73, skill: "スペクトラムショット" },
  { id: "c013", name: "フレアドラコ", rarity: "SR", type: "Fire", hp: 118, atk: 92, skill: "マグマダイブ" },
  { id: "c014", name: "タイダルホーン", rarity: "SR", type: "Water", hp: 124, atk: 86, skill: "ハイドロホーン" },
  { id: "c015", name: "テンペストウルフ", rarity: "SR", type: "Wind", hp: 112, atk: 94, skill: "しんくうツメ" },
  { id: "c016", name: "ライゴン", rarity: "SR", type: "Thunder", hp: 108, atk: 97, skill: "サンダーファング" },
  { id: "c017", name: "エクリプスフェザー", rarity: "SR", type: "Shadow", hp: 126, atk: 83, skill: "げつえいダイブ" },
  { id: "c018", name: "クリスタリス", rarity: "SR", type: "Crystal", hp: 110, atk: 95, skill: "ミラーランス" },
  { id: "c019", name: "インフェルノレオ", rarity: "SSR", type: "Fire", hp: 152, atk: 122, skill: "ごうえんほうこう" },
  { id: "c020", name: "アビスセイル", rarity: "SSR", type: "Water", hp: 165, atk: 110, skill: "しんえんのなみ" },
  { id: "c021", name: "ボルテックスドラ", rarity: "SSR", type: "Thunder", hp: 148, atk: 126, skill: "らいめいしんげき" },
  { id: "c022", name: "ルナノワール", rarity: "SSR", type: "Shadow", hp: 170, atk: 104, skill: "えいげつれんだん" },
  { id: "c023", name: "オーロラフェニクス", rarity: "UR", type: "Crystal", hp: 210, atk: 160, skill: "しんせいのひかり" },
  { id: "c024", name: "ジ・エンシェントゼウス", rarity: "UR", type: "Thunder", hp: 224, atk: 154, skill: "てんらいおうげき" },
];

const cardById = new Map(cards.map((card) => [card.id, card]));
const cardArtCache = new Map();

const machineDefs = [
  {
    id: "k100",
    name: "ライト 100KT",
    price: 100,
    lotCount: 10000,
    lotRarities: { N: 7607, R: 2000, SR: 330, SSR: 62, UR: 1 },
    poolSizes: { N: 6, R: 6, SR: 4, SSR: 3, UR: 1 },
    desc: "10,000口。低単価で回しやすい台。",
  },
  {
    id: "k1000",
    name: "ブースト 1000KT",
    price: 1000,
    lotCount: 100,
    lotRarities: { N: 4, R: 65, SR: 12, SSR: 18, UR: 1 },
    poolSizes: { N: 3, R: 5, SR: 4, SSR: 4, UR: 1 },
    desc: "100口。中当たり〜大当たりを狙う台。",
  },
  {
    id: "k10000",
    name: "ドリーム 10000KT",
    price: 10000,
    lotCount: 10,
    lotRarities: { SSR: 8, UR: 2 },
    poolSizes: { SSR: 4, UR: 2 },
    desc: "10口。超高額の一撃狙い台。",
  },
];

let machines = [];
const state = loadState();
let isAnimating = false;
let tickerId = null;
const sound = new SoundEngine();

const gachaZone = document.querySelector("#gacha-zone");
const resultStage = document.querySelector("#result-stage");
const historyList = document.querySelector("#history-list");
const collectionGrid = document.querySelector("#collection-grid");
const gachaTemplate = document.querySelector("#gacha-template");
const cardTemplate = document.querySelector("#card-template");

const ktBalanceEl = document.querySelector("#kt-balance");
const cardCountEl = document.querySelector("#card-count");
const rotationNextEl = document.querySelector("#rotation-next");
const soundBtn = document.querySelector("#sound-btn");
const chargeBtn = document.querySelector("#charge-btn");
const resetBtn = document.querySelector("#reset-btn");
const drawOverlay = document.querySelector("#draw-overlay");
const drawLabelEl = document.querySelector("#draw-label");
const drawCountEl = document.querySelector("#draw-count");
const drawColorEl = document.querySelector("#draw-color");
const drawPackEl = document.querySelector("#draw-pack");
const openPackBtn = document.querySelector("#open-pack-btn");

initialize();

function initialize() {
  ensureRotation(true);
  sound.setEnabled(state.soundEnabled);
  syncSoundButton();
  bindGlobalButtons();
  renderMachines();
  updateHud();
  renderCollection();
  renderHistory();
  if (!tickerId) {
    tickerId = window.setInterval(handleTick, 1000);
  }
}

function bindGlobalButtons() {
  if (soundBtn && soundBtn.dataset.bound !== "1") {
    soundBtn.dataset.bound = "1";
    soundBtn.addEventListener("click", async () => {
      if (state.soundEnabled) {
        state.soundEnabled = false;
        sound.setEnabled(false);
        syncSoundButton();
        saveState();
        return;
      }
      state.soundEnabled = true;
      sound.setEnabled(true);
      await sound.prime();
      sound.playUi();
      syncSoundButton();
      saveState();
    });
  }

  if (chargeBtn && chargeBtn.dataset.bound !== "1") {
    chargeBtn.dataset.bound = "1";
    chargeBtn.addEventListener("click", () => {
      state.kt += 1000;
      saveState();
      sound.playUi();
      updateHud();
      refreshButtonState();
    });
  }

  if (resetBtn && resetBtn.dataset.bound !== "1") {
    resetBtn.dataset.bound = "1";
    resetBtn.addEventListener("click", () => {
      const accepted = window.confirm("残高・コレクション・履歴を初期化します。実行しますか？");
      if (!accepted) {
        return;
      }
      state.kt = 3000;
      state.binder = {};
      state.valueBook = {};
      state.history = [];
      state.rotation = null;
      ensureRotation(true);
      saveState();
      sound.playUi();
      updateHud();
      renderMachines();
      renderCollection();
      renderHistory();
      resultStage.innerHTML = '<p class="hint">ガチャを引くとここにカードが表示される</p>';
      refreshButtonState();
    });
  }
}

function loadState() {
  const fallback = {
    kt: 3000,
    binder: {},
    valueBook: {},
    history: [],
    soundEnabled: true,
    rotation: null,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    const binder = parsed.binder && typeof parsed.binder === "object" ? parsed.binder : {};
    let valueBook = parsed.valueBook && typeof parsed.valueBook === "object" ? parsed.valueBook : null;
    if (!valueBook) {
      valueBook = deriveValueBook(binder);
    }

    return {
      kt: typeof parsed.kt === "number" ? parsed.kt : fallback.kt,
      binder,
      valueBook,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_LIMIT) : [],
      soundEnabled: parsed.soundEnabled !== false,
      rotation: parsed.rotation && typeof parsed.rotation === "object" ? parsed.rotation : null,
    };
  } catch {
    return fallback;
  }
}

function deriveValueBook(binder) {
  const valueBook = {};
  for (const [cardId, countRaw] of Object.entries(binder)) {
    const count = Number(countRaw);
    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }
    const rarity = cardById.get(cardId)?.rarity ?? "N";
    valueBook[cardId] = count * (RARITY_VALUES[rarity] ?? 50);
  }
  return valueBook;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function handleTick() {
  if (!isAnimating) {
    const changed = ensureRotation(false);
    if (changed) {
      renderMachines();
      refreshButtonState();
    }
  }
  updateHud();
}

function ensureRotation(forceSave) {
  const now = Date.now();
  const key = getRotationKey(now);
  let changed = false;

  if (!state.rotation || state.rotation.key !== key) {
    state.rotation = createRotationState(key);
    changed = true;
  } else if (repairRotationState(state.rotation)) {
    changed = true;
  }

  machines = buildMachinesForRotation(key);
  if (changed || forceSave) {
    saveState();
  }
  return changed;
}

function getRotationKey(timestamp) {
  return Math.floor(timestamp / ROTATION_MS);
}

function createRotationState(key) {
  const stocks = {};
  for (const def of machineDefs) {
    stocks[def.id] = {
      remainingByRarity: { ...def.lotRarities },
      remainingTotal: def.lotCount,
    };
  }
  return { key, stocks };
}

function repairRotationState(rotation) {
  if (!rotation || typeof rotation !== "object") {
    return false;
  }
  if (!rotation.stocks || typeof rotation.stocks !== "object") {
    rotation.stocks = {};
  }

  let changed = false;
  for (const def of machineDefs) {
    const stock = rotation.stocks[def.id];
    if (!stock || typeof stock !== "object") {
      rotation.stocks[def.id] = {
        remainingByRarity: { ...def.lotRarities },
        remainingTotal: def.lotCount,
      };
      changed = true;
      continue;
    }

    if (!stock.remainingByRarity || typeof stock.remainingByRarity !== "object") {
      stock.remainingByRarity = { ...def.lotRarities };
      changed = true;
    }

    let total = 0;
    for (const rarity of RARITY_ORDER) {
      const baseline = def.lotRarities[rarity] ?? 0;
      let value = Number(stock.remainingByRarity[rarity]);
      if (!Number.isFinite(value)) {
        value = baseline;
        changed = true;
      }
      value = Math.max(0, Math.min(baseline, Math.floor(value)));
      stock.remainingByRarity[rarity] = value;
      total += value;
    }
    if (stock.remainingTotal !== total) {
      stock.remainingTotal = total;
      changed = true;
    }
  }
  return changed;
}

function buildMachinesForRotation(key) {
  return machineDefs.map((def) => {
    const rarityPools = {};
    for (const rarity of RARITY_ORDER) {
      const lotCount = def.lotRarities[rarity] ?? 0;
      if (lotCount <= 0) {
        continue;
      }
      const ids = cards.filter((card) => card.rarity === rarity).map((card) => card.id);
      const poolSize = Math.max(1, Math.min(def.poolSizes?.[rarity] ?? ids.length, ids.length));
      rarityPools[rarity] = pickSeeded(ids, poolSize, `${key}:${def.id}:${rarity}`);
    }
    return {
      ...def,
      rarityPools,
      pickupIds: buildPickupIds(rarityPools),
      hook: `設計還元 約98% / 10分ごとに中身更新`,
    };
  });
}

function pickSeeded(list, size, seedText) {
  const arr = [...list];
  const random = mulberry32(hash(seedText));
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, size);
}

function buildPickupIds(rarityPools) {
  const out = [];
  for (const rarity of ["UR", "SSR", "SR"]) {
    for (const cardId of rarityPools[rarity] ?? []) {
      out.push(cardId);
      if (out.length >= 3) {
        return out;
      }
    }
  }
  return out;
}

function renderMachines() {
  gachaZone.innerHTML = "";
  for (const machine of machines) {
    const stock = getMachineStock(machine.id);
    const fragment = gachaTemplate.content.cloneNode(true);
    const box = fragment.querySelector(".gacha-box");
    box.dataset.id = machine.id;
    box.classList.toggle("soldout", stock.remainingTotal <= 0);

    fragment.querySelector(".gacha-name").textContent = machine.name;
    fragment.querySelector(".gacha-price").textContent = `${machine.price.toLocaleString("ja-JP")} KT / 1回`;
    fragment.querySelector(".gacha-desc").textContent = machine.desc;
    fragment.querySelector(".pickup-note").textContent =
      `${machine.hook} / 残り ${stock.remainingTotal.toLocaleString("ja-JP")} / ${machine.lotCount.toLocaleString("ja-JP")}口`;

    const pickupList = fragment.querySelector(".pickup-list");
    for (const pickupCard of getPickupCards(machine)) {
      const li = document.createElement("li");
      li.className = "pickup-chip";
      li.dataset.rarity = pickupCard.rarity;
      li.textContent = `${pickupCard.rarity} ${pickupCard.name}`;
      pickupList.append(li);
    }

    const singleBtn = fragment.querySelector(".draw-btn.single");
    const tenBtn = fragment.querySelector(".draw-btn.ten");
    singleBtn.addEventListener("click", () => pull(machine.id, 1));
    tenBtn.addEventListener("click", () => pull(machine.id, 10));
    gachaZone.append(fragment);
  }
  refreshButtonState();
}

function getMachineStock(machineId) {
  if (!state.rotation || !state.rotation.stocks) {
    return { remainingByRarity: {}, remainingTotal: 0 };
  }
  return state.rotation.stocks[machineId] ?? { remainingByRarity: {}, remainingTotal: 0 };
}

function refreshButtonState() {
  for (const machine of machines) {
    const stock = getMachineStock(machine.id);
    const box = gachaZone.querySelector(`.gacha-box[data-id="${machine.id}"]`);
    if (!box) {
      continue;
    }
    const singleBtn = box.querySelector(".draw-btn.single");
    const tenBtn = box.querySelector(".draw-btn.ten");
    singleBtn.disabled = isAnimating || state.kt < machine.price || stock.remainingTotal < 1;
    tenBtn.disabled = isAnimating || state.kt < machine.price * 10 || stock.remainingTotal < 10;
  }
  chargeBtn.disabled = isAnimating;
  resetBtn.disabled = isAnimating;
}

async function pull(machineId, count) {
  if (isAnimating) {
    return;
  }
  ensureRotation(false);

  if (state.soundEnabled) {
    await sound.prime();
  }

  const machine = machines.find((item) => item.id === machineId);
  if (!machine) {
    return;
  }
  const stock = getMachineStock(machine.id);
  if (stock.remainingTotal < count) {
    window.alert(`残り口数が足りません。残り ${stock.remainingTotal} 口です。`);
    return;
  }

  const totalCost = machine.price * count;
  if (state.kt < totalCost) {
    window.alert("KTが足りません。+1000KTでチャージしてください。");
    return;
  }

  state.kt -= totalCost;
  const pulledCards = [];
  let pickupCount = 0;
  let payoutTotal = 0;

  for (let i = 0; i < count; i += 1) {
    const rarity = pickRarityByRemaining(stock.remainingByRarity);
    if (!rarity) {
      break;
    }
    stock.remainingByRarity[rarity] -= 1;
    stock.remainingTotal -= 1;

    const selected = pickCardByRarity(machine, rarity);
    const payout = RARITY_VALUES[rarity] ?? 50;
    pulledCards.push(selected);
    payoutTotal += payout;
    if (isPickupCard(machine, selected.id)) {
      pickupCount += 1;
    }
    state.binder[selected.id] = (state.binder[selected.id] ?? 0) + 1;
    state.valueBook[selected.id] = (state.valueBook[selected.id] ?? 0) + payout;
  }

  const effect = buildDrawEffect(pulledCards, count);
  isAnimating = true;
  refreshButtonState();
  try {
    await playDrawEffect(effect);
  } finally {
    isAnimating = false;
    refreshButtonState();
  }

  state.history.unshift({
    type: "pull",
    at: Date.now(),
    machineId,
    count,
    cards: pulledCards.map((card) => card.id),
    pickupCount,
    cost: totalCost,
    payoutTotal,
  });
  state.history = state.history.slice(0, HISTORY_LIMIT);

  saveState();
  updateHud();
  renderMachines();
  renderResult(pulledCards, machine);
  renderCollection();
  renderHistory();
}

function pickRarityByRemaining(remainingByRarity) {
  let total = 0;
  for (const rarity of RARITY_ORDER) {
    total += Math.max(0, remainingByRarity[rarity] ?? 0);
  }
  if (total <= 0) {
    return null;
  }
  let roll = Math.random() * total;
  for (const rarity of RARITY_ORDER) {
    roll -= Math.max(0, remainingByRarity[rarity] ?? 0);
    if (roll < 0) {
      return rarity;
    }
  }
  return "N";
}

function pickCardByRarity(machine, rarity) {
  const pool = machine.rarityPools[rarity] ?? [];
  if (pool.length === 0) {
    const fallback = cards.filter((card) => card.rarity === rarity);
    return fallback[Math.floor(Math.random() * fallback.length)] ?? cards[0];
  }
  const pickedId = pool[Math.floor(Math.random() * pool.length)];
  return cardById.get(pickedId) ?? cards[0];
}

function getPickupCards(machine) {
  return (machine.pickupIds ?? [])
    .map((cardId) => cardById.get(cardId))
    .filter((card) => Boolean(card));
}

function isPickupCard(machine, cardId) {
  return (machine.pickupIds ?? []).includes(cardId);
}

function buildDrawEffect(pulledCards, count) {
  const highest = pulledCards.reduce((max, card) => Math.max(max, rarityRank[card.rarity] ?? 1), 1);
  const baseBlackoutChance = count >= 10 ? 0.42 : 0.24;
  const blackout = highest >= 4 || Math.random() < baseBlackoutChance;
  let color = "white";

  if (blackout) {
    if (highest >= 5) {
      color = "rainbow";
    } else if (highest >= 4) {
      color = Math.random() < 0.74 ? "gold" : "red";
    } else {
      const roll = Math.random();
      color = roll < 0.62 ? "red" : roll < 0.94 ? "gold" : "rainbow";
    }
  } else if (highest >= 3) {
    color = "green";
  } else if (highest >= 2) {
    color = Math.random() < 0.7 ? "blue" : "green";
  } else {
    const roll = Math.random();
    color = roll < 0.72 ? "white" : roll < 0.93 ? "blue" : "green";
  }

  return {
    blackout,
    color,
  };
}

async function playDrawEffect(effect) {
  if (!drawOverlay || !drawLabelEl || !drawCountEl || !drawColorEl) {
    return;
  }

  resetDrawOverlay();
  setPackColor("white");
  drawOverlay.classList.remove("hidden");
  drawOverlay.setAttribute("aria-hidden", "false");
  await wait(120);

  for (const value of [3, 2, 1]) {
    drawLabelEl.textContent = "カウントダウン";
    drawCountEl.textContent = String(value);
    drawColorEl.textContent = "";
    drawOverlay.classList.add("count-pulse");
    sound.playCountdown(value);
    await wait(820);
    drawOverlay.classList.remove("count-pulse");
    await wait(180);
  }

  drawCountEl.textContent = "GO";
  drawLabelEl.textContent = "ジャッジ中";
  drawColorEl.textContent = "パック判定";
  sound.playGo();
  await wait(320);

  if (effect.blackout) {
    await playPuchunBlackout();
  }

  setPackColor(effect.color);
  if (effect.blackout) {
    drawOverlay.classList.add("reveal-glow");
  }
  drawOverlay.classList.add(`flash-${effect.color}`);
  drawOverlay.classList.add("pack-reveal");
  drawLabelEl.textContent = effect.blackout ? "覚醒パック出現" : "パック出現";
  drawCountEl.textContent = "";
  drawColorEl.textContent = effect.blackout ? "暗転ルート突破" : "通常ルート";
  sound.playColorResult(effect.color, effect.blackout);
  await wait(effect.blackout ? 1280 : 820);

  drawOverlay.classList.add("await-open");
  drawLabelEl.textContent = "パックが出現した";
  drawColorEl.textContent = "ボタンで開封";
  showOpenPackButton();
  await waitForPackOpen();
  hideOpenPackButton();
  drawOverlay.classList.remove("await-open");
  sound.playUi();

  drawOverlay.classList.add("burst");
  await wait(320);

  drawOverlay.classList.add("hidden");
  drawOverlay.setAttribute("aria-hidden", "true");
  await wait(180);
  resetDrawOverlay();
}

async function playPuchunBlackout() {
  drawLabelEl.textContent = "ぷちゅん！";
  drawCountEl.textContent = "";
  drawColorEl.textContent = "暗転突入";
  sound.playPuchun();
  drawOverlay.classList.add("puchun-impact", "puchun-flash", "puchun-shutter");
  await wait(240);

  drawOverlay.classList.remove("puchun-impact", "puchun-flash", "puchun-shutter");
  drawOverlay.classList.add("puchun-closed", "blackout-lock");
  const stopHum = sound.startBlackoutHum();
  drawLabelEl.textContent = "BLACK OUT";
  drawCountEl.textContent = "";
  drawColorEl.textContent = "";
  await wait(3000);

  stopHum();
  drawOverlay.classList.add("puchun-release");
  drawOverlay.classList.remove("puchun-closed");
  await wait(180);
  drawOverlay.classList.remove("puchun-release", "blackout-lock");
}

function resetDrawOverlay() {
  sound.stopBlackoutHum();
  hideOpenPackButton();
  drawOverlay.classList.remove(
    "count-pulse",
    "blackout-lock",
    "pack-reveal",
    "await-open",
    "reveal-glow",
    "burst",
    "puchun-impact",
    "puchun-flash",
    "puchun-shutter",
    "puchun-closed",
    "puchun-release",
    "flash-white",
    "flash-blue",
    "flash-green",
    "flash-red",
    "flash-gold",
    "flash-rainbow",
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function setPackColor(color) {
  if (!drawPackEl) {
    return;
  }
  drawPackEl.classList.remove("pack-white", "pack-blue", "pack-green", "pack-red", "pack-gold", "pack-rainbow");
  drawPackEl.classList.add(`pack-${color}`);
}

function showOpenPackButton() {
  if (!openPackBtn) {
    return;
  }
  openPackBtn.classList.remove("hidden");
  openPackBtn.focus();
}

function hideOpenPackButton() {
  if (!openPackBtn) {
    return;
  }
  openPackBtn.classList.add("hidden");
}

function waitForPackOpen() {
  if (!openPackBtn) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onClick = () => {
      openPackBtn.removeEventListener("click", onClick);
      resolve();
    };
    openPackBtn.addEventListener("click", onClick, { once: true });
  });
}

function syncSoundButton() {
  if (!soundBtn) {
    return;
  }
  soundBtn.textContent = state.soundEnabled ? "SE ON" : "SE OFF";
  soundBtn.classList.toggle("sound-off", !state.soundEnabled);
}

function updateHud() {
  ktBalanceEl.textContent = `${state.kt.toLocaleString("ja-JP")} KT`;
  cardCountEl.textContent = `${getOwnedCardCount().toLocaleString("ja-JP")} 枚`;
  if (rotationNextEl) {
    const key = state.rotation?.key ?? getRotationKey(Date.now());
    const remainMs = Math.max(0, (key + 1) * ROTATION_MS - Date.now());
    rotationNextEl.textContent = `${formatRemain(remainMs)} で更新`;
  }
}

function formatRemain(remainMs) {
  const totalSec = Math.floor(remainMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getOwnedCardCount() {
  return Object.values(state.binder).reduce((sum, amount) => sum + amount, 0);
}

function renderResult(pulledCards, machine) {
  resultStage.innerHTML = "";

  for (const card of pulledCards) {
    const node = makeCardNode(card, state.binder[card.id] ?? 0, "result", {
      isPickup: isPickupCard(machine, card.id),
    });
    resultStage.append(node);
  }
}

function renderHistory() {
  historyList.innerHTML = "";
  if (state.history.length === 0) {
    const li = document.createElement("li");
    li.textContent = "まだ履歴はありません。";
    historyList.append(li);
    return;
  }

  for (const record of state.history) {
    const li = document.createElement("li");
    const time = new Date(record.at).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    if (record.type === "sell") {
      const cardName = cardById.get(record.cardId)?.name ?? "カード";
      li.innerHTML = `<span>売却: ${cardName} +${Math.round(record.payout)}KT</span><span>${time}</span>`;
    } else {
      const machine = machineDefs.find((item) => item.id === record.machineId);
      const name = machine ? machine.name : "不明ガチャ";
      const lead = (record.cards ?? [])
        .slice(0, 2)
        .map((id) => cardById.get(id)?.name ?? "カード")
        .join(" / ");
      const more = record.cards && record.cards.length > 2 ? ` ほか${record.cards.length - 2}枚` : "";
      const pickupLabel = record.pickupCount > 0 ? ` / PICK UP ${record.pickupCount}枚` : "";
      li.innerHTML = `<span>${name} ${record.count}連: ${lead}${more}${pickupLabel} (-${record.cost ?? 0}KT / 売値合計 ${record.payoutTotal ?? 0}KT)</span><span>${time}</span>`;
    }

    historyList.append(li);
  }
}

function renderCollection() {
  collectionGrid.innerHTML = "";

  const sorted = [...cards].sort((a, b) => {
    const rarityDiff = rarityRank[b.rarity] - rarityRank[a.rarity];
    if (rarityDiff !== 0) {
      return rarityDiff;
    }
    return a.name.localeCompare(b.name, "ja");
  });

  for (const card of sorted) {
    const owned = state.binder[card.id] ?? 0;
    const node = makeCardNode(card, owned, "collection", { isPickup: false });
    const sellBtn = node.querySelector(".sell-btn");
    const sellValue = node.querySelector(".sell-value");

    if (owned > 0) {
      sellBtn.addEventListener("click", () => sellOneCard(card.id));
      sellValue.textContent = `+${getSellPrice(card.id)}KT`;
    } else {
      node.style.opacity = "0.5";
      node.querySelector(".card-name").textContent = "????";
      node.querySelector(".card-skill").textContent = "未入手";
      node.querySelector(".owned-chip").textContent = "0";
      sellBtn.disabled = true;
      sellValue.textContent = "未所持";
    }

    collectionGrid.append(node);
  }
}

function getSellPrice(cardId) {
  const count = state.binder[cardId] ?? 0;
  if (count <= 0) {
    return 0;
  }
  const rarity = cardById.get(cardId)?.rarity ?? "N";
  const totalValue = state.valueBook[cardId] ?? count * (RARITY_VALUES[rarity] ?? 50);
  const avgValue = totalValue / count;
  return Math.max(1, Math.round(avgValue));
}

function sellOneCard(cardId) {
  const count = state.binder[cardId] ?? 0;
  if (count <= 0) {
    return;
  }

  const rarity = cardById.get(cardId)?.rarity ?? "N";
  const totalValue = state.valueBook[cardId] ?? count * (RARITY_VALUES[rarity] ?? 50);
  const avgValue = totalValue / count;
  const payout = Math.max(1, Math.round(avgValue));

  state.kt += payout;

  if (count === 1) {
    delete state.binder[cardId];
    delete state.valueBook[cardId];
  } else {
    state.binder[cardId] = count - 1;
    state.valueBook[cardId] = Math.max(0, totalValue - avgValue);
  }

  state.history.unshift({
    type: "sell",
    at: Date.now(),
    cardId,
    payout,
    valueBasis: avgValue,
  });
  state.history = state.history.slice(0, HISTORY_LIMIT);

  saveState();
  sound.playSell();
  updateHud();
  refreshButtonState();
  renderCollection();
  renderHistory();
}

function makeCardNode(card, owned, mode = "collection", options = {}) {
  const { isPickup = false } = options;
  const fragment = cardTemplate.content.cloneNode(true);
  const cardEl = fragment.querySelector(".card");
  const rarityEl = fragment.querySelector(".rarity");
  const typeEl = fragment.querySelector(".type");
  const artEl = fragment.querySelector(".card-art");
  const artImageEl = fragment.querySelector(".card-art-image");
  const sellBtnEl = fragment.querySelector(".sell-btn");
  const sellValueEl = fragment.querySelector(".sell-value");
  const actionsEl = fragment.querySelector(".card-actions");

  cardEl.dataset.rarity = card.rarity;
  if (isPickup) {
    cardEl.classList.add("is-pickup");
  }
  rarityEl.textContent = card.rarity;
  typeEl.textContent = card.type;
  fragment.querySelector(".card-name").textContent = card.name;
  fragment.querySelector(".card-skill").textContent = card.skill;
  fragment.querySelector(".hp").textContent = `HP ${card.hp}`;
  fragment.querySelector(".atk").textContent = `ATK ${card.atk}`;
  fragment.querySelector(".owned-chip").textContent = `x${owned}`;

  artEl.style.setProperty("--art", typeArt[card.type] ?? "linear-gradient(135deg, #475569, #0f172a)");
  artImageEl.src = getCardArtDataUri(card);
  artImageEl.alt = `${card.name} のアート`;

  if (mode === "result") {
    actionsEl.style.display = "none";
    sellBtnEl.disabled = true;
    sellValueEl.textContent = "";
  } else {
    sellBtnEl.disabled = owned <= 0;
    sellValueEl.textContent = owned > 0 ? `+${getSellPrice(card.id)}KT` : "未所持";
  }

  return cardEl;
}

function getCardArtDataUri(card) {
  if (cardArtCache.has(card.id)) {
    return cardArtCache.get(card.id);
  }

  const seed = hash(card.id + card.name);
  const random = mulberry32(seed);
  const palette = typePalette[card.type] ?? typePalette.Fire;

  const earSpread = 20 + Math.floor(random() * 9);
  const earTilt = 6 + Math.floor(random() * 9);
  const eyeSize = 4 + Math.floor(random() * 2);
  const spotY = 78 + Math.floor(random() * 10);
  const tailLift = 15 + Math.floor(random() * 12);

  const sparkles = Array.from({ length: 6 }, (_, i) => {
    const x = 18 + i * 36 + Math.floor(random() * 12);
    const y = 16 + Math.floor(random() * 70);
    const size = 2 + Math.floor(random() * 3);
    return sparklePolygon(x, y, size);
  }).join("");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bgA}"/>
      <stop offset="100%" stop-color="${palette.bgB}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.65" cy="0.25" r="0.8">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="240" height="140" fill="url(#bg)"/>
  <rect x="0" y="0" width="240" height="140" fill="url(#glow)"/>
  ${sparkles}

  <ellipse cx="120" cy="116" rx="66" ry="10" fill="#000000" fill-opacity="0.18"/>

  <g transform="translate(0, 1)">
    <ellipse cx="98" cy="66" rx="${earSpread}" ry="${earTilt}" fill="${palette.body}" transform="rotate(-30 98 66)"/>
    <ellipse cx="142" cy="66" rx="${earSpread}" ry="${earTilt}" fill="${palette.body}" transform="rotate(30 142 66)"/>

    <ellipse cx="120" cy="84" rx="51" ry="34" fill="${palette.body}"/>
    <ellipse cx="102" cy="74" rx="19" ry="18" fill="${palette.body}"/>
    <ellipse cx="138" cy="74" rx="19" ry="18" fill="${palette.body}"/>
    <ellipse cx="120" cy="90" rx="36" ry="24" fill="${palette.accent}" fill-opacity="0.3"/>

    <circle cx="106" cy="78" r="${eyeSize}" fill="${palette.eye}"/>
    <circle cx="134" cy="78" r="${eyeSize}" fill="${palette.eye}"/>
    <circle cx="105" cy="76" r="1.2" fill="#ffffff"/>
    <circle cx="133" cy="76" r="1.2" fill="#ffffff"/>

    <path d="M111 95 Q120 101 129 95" stroke="${palette.eye}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
    <circle cx="96" cy="90" r="2.2" fill="#ffffff" fill-opacity="0.65"/>
    <circle cx="144" cy="90" r="2.2" fill="#ffffff" fill-opacity="0.65"/>

    <path d="M166 100 C184 96 192 88 199 ${84 - tailLift} C202 ${90 - tailLift} 195 99 184 104" fill="none" stroke="${palette.body}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="170" cy="${spotY}" r="5" fill="${palette.accent}" fill-opacity="0.45"/>
    <circle cx="76" cy="${spotY - 5}" r="4" fill="${palette.accent}" fill-opacity="0.35"/>
  </g>
</svg>`;

  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
  cardArtCache.set(card.id, uri);
  return uri;
}

function buildNoiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.35);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  return buffer;
}

function safeDisconnect(node) {
  if (!node) {
    return;
  }
  try {
    node.disconnect();
  } catch {
    // ignore
  }
}

function sparklePolygon(x, y, size) {
  const points = [
    `${x},${y - size * 2}`,
    `${x + size * 0.7},${y - size * 0.7}`,
    `${x + size * 2},${y}`,
    `${x + size * 0.7},${y + size * 0.7}`,
    `${x},${y + size * 2}`,
    `${x - size * 0.7},${y + size * 0.7}`,
    `${x - size * 2},${y}`,
    `${x - size * 0.7},${y - size * 0.7}`,
  ].join(" ");
  return `<polygon points="${points}" fill="#ffffff" fill-opacity="0.75"/>`;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
