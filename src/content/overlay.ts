/**
 * 原地覆蓋（spec #27 第 7 節、#19 的變體 B）。
 *
 * 每個 anchor 後面插一個 shadow host 當兄弟節點（position:absolute、pointer-events:none），同一個 anchor 上的
 * 多個 Page（Spread 的 subRect）共用一個 host、各自一個 Page 層（同一個 Page 只留一層）。Page 層用 Page 原始像素排版，整層
 * translate＋scale 對到 anchor 的 offset*×subRect，捲動、祖先 transform、overflow 裁切都由瀏覽器自然套用。
 * 只在 anchor 尺寸變（ResizeObserver）、視窗大小變、主頁面把 host 丟掉（MutationObserver）時重算或重掛；
 * img 換了 src（電子書閱讀器翻頁）就拿掉上面所有 Page 層，等 SW 送新的。
 * host 是 anchor 的兄弟節點，不會跟著 anchor 被藏起來，所以 anchor 看不到時 host 也自己藏起來。
 *
 * Page Mode（#73）只決定擦字＋譯文那一層要不要顯示：學習時藏起來、保留日文原稿；hover hit-test、tooltip、
 * 高亮框兩種模式都照常運作。
 *
 * Page 上的外圈（#285、#283，shared/page-outlines.ts）也在同一個 host 裡：不縮放、截圖時藏起來。翻譯中的句子是日文上
 * 一道擦除底色的光帶掃過；被可見範圍邊緣切到、還在等的框，看得到的那一端有一個「…」小標記。譯文到了就整頁一次蓋上、同時收起外圈。
 *
 * 翻譯中、出問題的全站狀態不在這裡：視窗右上角只有一個（status-panel.ts）。
 */
import type { LineBox, LineRef, Rect } from '../shared/messages.ts';
import { ERASE_WHITE, LOOSE_OUTLINE_PAD_PX, onAnchor, staggerRanks, WASH_STAGGER_MS } from '../shared/page-outlines.ts';
import { findSamePage } from '../shared/page-hash.ts';
import type { PageMode } from '../shared/page-mode.ts';
import { DEFAULT_DISPLAY_SETTINGS, hidesTranslation, type DisplaySettings } from '../shared/display-settings.ts';
import { overlaidTexts, REVEAL_HINT, unreadableLabel, type PageText, type RatioRect, type ReadingWord, type RomajiWord } from '../shared/page-text.ts';
import { TRANSLATE_ICON } from '../shared/translate-icon.ts';
import { rubyDisplay, type RubySegment } from '../shared/ruby.ts';
import { wordUnits } from '../shared/word-units.ts';
import TOKENS from '../shared/tokens.css';
import { createTrace } from '../shared/trace.ts';
import { hoverAid } from './hover-aid.ts';
import { headingToward, HOVER_DWELL_MS, type Point } from './hover-intent.ts';
import { loadPunctuationFont, PUNCTUATION_FAMILY } from '../shared/punctuation-face.ts';
import { eraseFill, estimateFontPx, estimateOriginalLines, fitText, isVertical, layerTransform, layoutText, looseTextRegions, minLayerFontPx, pageSize, ratioToBox, separateRegions, textRegions, verticalize, type Box } from './overlay-layout.ts';

/**
 * 元素看得到（自己與祖先都不是 display:none、visibility 不是 hidden）。輪流用好幾張疊在一起的 img 的閱讀器
 * （真實的電子書閱讀器）用 visibility 藏起舊的那張、留在原地：它不是 Page，上面的覆蓋層也要藏起來。
 * opacity:0 不算：淡出結束不會有 mutation，要另外接 transitionend 才知道。
 */
export const isShown = (element: Element) => element.checkVisibility({ visibilityProperty: true });

/** 給 e2e 與頁面辨識用：shadow host 的屬性。 */
export const HOST_ATTRIBUTE = 'data-naruhodo-overlay';

/** 譯文的行高（em）。 */
const LINE_HEIGHT = 1.15;
/** Loose Text 譯文的反色描邊（#151）：paint-order: stroke 讓一半壓在字下面，字外側露出約字級的 1/8。 */
const LOOSE_STROKE_EM = 0.25;

/** 譯文蓋上、外圈收起的淡入淡出花這麼久（ms）。 */
const REVEAL_FADE_MS = 200;
/**
 * 翻譯中的外圈從 SW 說「不在翻了」到真的拿掉最多等這麼久（ms）：譯文通常緊接著到（show 還要等字型與擦除小圖），
 * 由它照閱讀順序收起；等不到（翻譯失敗、額度用完）才直接拿掉。
 */
const OUTLINE_RETIRE_MS = 1000;
/** 翻譯中的光帶掃一輪多久（ms）：前 3/4 在掃，剩下停一下，免得一整頁動個不停。 */
const WASH_MS = 2400;
/** 光帶最濃的地方的不透明度：日文像蒙上一層底色，還看得出來。 */
const WASH_ALPHA = 0.85;
/** 不要動畫（prefers-reduced-motion）時，日文上蓋一層不動的底色，這麼濃。 */
const WASH_STILL_ALPHA = 0.35;
/**
 * Balloon 的光帶是泡泡外框的內切橢圓，離外框這麼多畫面 px：字一定在泡泡裡，所以都蓋得到；
 * 不從文字框往外擴，泡泡貼著字時，長方形的四個角會壓到泡泡的框線。
 */
const WASH_BALLOON_INSET_PX = 3;
/** Loose Text 沒有泡泡：光帶是文字框往外這麼多畫面 px 的長方形。 */
const WASH_LOOSE_PAD_PX = 8;
/** 光帶邊緣往內羽化這麼寬（畫面 px）。 */
const WASH_FEATHER_PX = 10;

/**
 * 翻譯中的一句：放在外框上的透明框，裡面一塊擦除底色的光帶（Balloon 是內切橢圓，Loose Text 是長方形）。
 * 照閱讀順序錯開（rank）；輪到之前光帶還在框外，看不到。
 */
function washElement(line: LineBox, rank: number): HTMLElement {
  const element = document.createElement('div');
  element.className = 'rg t';
  element.style.setProperty('--delay', `${rank * WASH_STAGGER_MS}ms`);
  element.style.setProperty('--erase', String(line.eraseLuminance ?? ERASE_WHITE));
  const wash = document.createElement('div');
  wash.className = line.kind === 'balloon' ? 'wash oval' : 'wash';
  wash.style.inset = line.kind === 'balloon' ? `${WASH_BALLOON_INSET_PX}px` : `-${WASH_LOOSE_PAD_PX}px`;
  element.append(wash);
  return element;
}

/**
 * 等待中的一句：放在外框上的透明框，看得到的那一端（被切的另一緣）中間一個「…」小標記。
 * 不畫框：外框是被切到的那一截，捲動之後框的切口會停在泡泡中間（#283 之後的回饋）；標記只需要知道看得到的那一端。
 */
function waitingMark(line: LineBox): HTMLElement {
  const element = document.createElement('div');
  element.className = line.cut === 'top' ? 'rg w at-bottom' : 'rg w';
  const mark = document.createElement('div');
  mark.className = 'wm';
  mark.append(...Array.from({ length: 3 }, () => document.createElement('span')));
  element.append(mark);
  return element;
}

/** tooltip 與高亮框的顏色、字型取自 design tokens（跟 side panel 同一份，#71）；擦字與譯文的顏色跟著原稿算。 */
const STYLE = `${TOKENS}
:host { all: initial; }
.pl { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
.er { position: absolute; border-radius: 3px; }
.er.img { border-radius: 0; }
.tx { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  text-align: center; line-height: ${LINE_HEIGHT}; overflow: hidden; font-family: '${PUNCTUATION_FAMILY}', var(--naru-font-sans); font-weight: 700; overflow-wrap: anywhere; }
.tx.v { writing-mode: vertical-rl; text-orientation: mixed; }
.tx .u { text-combine-upright: all; }
.tx .s { text-orientation: sideways; }
.tx .r { text-orientation: upright; }
.tx > span { white-space: nowrap; }
.tx[data-wrap] > span { white-space: normal; }
.tx[data-fit="3"] { align-items: flex-start; justify-content: flex-start; }
.tx.ol { -webkit-text-stroke-width: ${LOOSE_STROKE_EM}em; paint-order: stroke fill; }
:host([data-page-mode="learn"]) .er, :host([data-page-mode="learn"]) .tx { visibility: hidden; }
.tip { position: absolute; display: none; box-sizing: border-box; padding: 0.6em 0.8em; border-radius: 0.6em;
  background: var(--naru-tooltip-bg); color: var(--naru-tooltip-ink); font-weight: 500; line-height: 1.4; white-space: pre-wrap;
  font-family: var(--naru-font-sans); z-index: 2; }
.tip.on { display: block; }
.tip-ja { font-family: var(--naru-font-ja); font-size: 1.1em; line-height: 2; color: var(--naru-tooltip-ink-2); }
.tip-ja rt, .tip-guess { color: var(--naru-tooltip-ruby); }
.tip-ja rt { font-size: 0.6em; font-weight: 400; }
.tip-guess { font-size: 0.75em; }
/* 羅馬拼音：原文下一行，比振り仮名淡，不跟譯文搶 */
.tip-romaji { margin: -0.1em 0 0.35em; font-size: 0.9em; color: var(--naru-tooltip-ink-3); letter-spacing: 0.02em; }
/* 羅馬拼音按詞（#330）：滑過任一邊的詞，原文與羅馬拼音同一個詞一起亮（半透明品牌黃）。原文的詞是 inline-block、上方留讀音的高度，色塊才蓋得住振り仮名 */
.tip .w { border-radius: 3px; }
.tip-ja .w { display: inline-block; line-height: 1.25; padding: var(--naru-word-ruby-padding); }
.tip .w.on { background: var(--naru-tooltip-word-highlight); color: var(--naru-tooltip-word-highlight-ink); }
.tip-ja .w.on rt { color: var(--naru-tooltip-word-highlight-ruby); }
.tip-unreadable { color: var(--naru-tooltip-ink-3); text-decoration: line-through dotted; }
.tip-zh { font-size: 1.15em; font-family: '${PUNCTUATION_FAMILY}', var(--naru-font-sans); }
.tip.learn .tip-ja { font-size: 1.4em; color: var(--naru-tooltip-ink); }
.tip-reveal { display: flex; align-items: center; gap: 0.6em; box-sizing: border-box; min-height: 3em; margin: 0.3em 0;
  padding: 0.6em 0.75em; border-radius: 0.6em; background: var(--naru-tooltip-chip-bg); border: 1px dashed var(--naru-tooltip-chip-line);
  transition: background-color 0.2s ease, border-color 0.2s ease; }
.tip-reveal.on { background: var(--naru-tooltip-chip-on-bg); border-color: var(--naru-tooltip-chip-on-line); }
/* 翻譯圖示（兩個對話框）：揭露時「あ」退後變淡、「文」亮起來往前跳一下 */
.tip-reveal-icon { flex: none; width: 1.6em; height: 1.6em; overflow: visible; }
.tip-reveal-icon g { transform-box: fill-box; transform-origin: center;
  transition: opacity 0.24s ease, transform 0.26s cubic-bezier(0.3, 1.4, 0.5, 1); }
.tip-reveal-icon .bubble { fill: var(--naru-tooltip-chip-bg); stroke-width: 1.3; transition: fill 0.2s ease, stroke 0.24s ease; }
.tip-reveal-icon .glyph { transition: fill 0.24s ease; }
.tip-reveal-icon .src .bubble { stroke: var(--naru-tooltip-chip-line); }
.tip-reveal-icon .src .glyph { fill: var(--naru-tooltip-ruby); }
.tip-reveal-icon .dst .bubble { stroke: var(--naru-tooltip-ink-3); }
.tip-reveal-icon .dst .glyph { fill: var(--naru-tooltip-ink-3); }
.tip-reveal.on .tip-reveal-icon .bubble { fill: var(--naru-tooltip-chip-on-bg); }
.tip-reveal.on .tip-reveal-icon .src { opacity: 0.5; transform: scale(0.92); }
.tip-reveal.on .tip-reveal-icon .dst { transform: scale(1.08); }
.tip-reveal.on .tip-reveal-icon .dst .bubble { stroke: var(--naru-tooltip-ink); }
.tip-reveal.on .tip-reveal-icon .dst .glyph { fill: var(--naru-on-accent); }
/* 譯文與提示疊在同一格：區塊大小取兩者較大的，揭露前後不變，tooltip 不會跳。藏著的那層用 visibility（淡出完才藏），讀屏也讀不到 */
.tip-reveal-body { display: grid; flex: 1; min-width: 0; font-family: '${PUNCTUATION_FAMILY}', var(--naru-font-sans); }
.tip-reveal-body > div { grid-area: 1 / 1;
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1), visibility 0s; }
.tip-reveal-hint { align-self: center; color: var(--naru-tooltip-chip-hint); }
.tip-reveal-zh { color: var(--naru-on-accent); font-size: 1.15em; visibility: hidden; opacity: 0; transform: translateY(5px);
  transition-delay: 0s, 0s, 0.2s; }
.tip-reveal.on .tip-reveal-zh { visibility: visible; opacity: 1; transform: none; transition-delay: 0s; }
.tip-reveal.on .tip-reveal-hint { visibility: hidden; opacity: 0; transform: translateY(-5px); transition-delay: 0s, 0s, 0.2s; }
.hl { position: absolute; display: none; box-sizing: border-box; border-style: solid; border-color: var(--naru-highlight);
  background: var(--naru-highlight-fill); }
.hl.on { display: block; }
/* 側邊欄開著時高亮框左上角的編號（U10）：跟側邊欄高亮那行同號同色（--naru-brand），中心在框角不擋字；
   學習模式 tooltip 放在句子上方時底邊貼著框角，編號疊在 tooltip 上面（z-index 比 .tip 高） */
.num { position: absolute; display: none; place-items: center; box-sizing: border-box; min-width: 1.6em; height: 1.6em; padding: 0 0.35em;
  transform: translate(-50%, -50%); border-radius: 999px; background: var(--naru-brand); color: var(--naru-ink);
  font: 700 1em/1 var(--naru-font-sans); font-variant-numeric: tabular-nums; box-shadow: var(--naru-shadow-1); z-index: 3; }
.num.on { display: grid; }
/* 長 Page 截圖時擦除與譯文不藏，tooltip、高亮框與編號藏（hideForCapture） */
:host([data-capturing]) .tip, :host([data-capturing]) .hl, :host([data-capturing]) .num { visibility: hidden; }
/* anchor 重新出現、截圖還沒確認上面是同一頁（#276）：譯文先藏著，Page 上的狀態照常顯示 */
:host([data-unverified]) .pl { visibility: hidden; }
/* Page 上的外圈（#285、#283）：跟 anchor 一樣大、不縮放，大小是畫面 px。t＝翻譯中（底色掃光），w＝等待中（看得到的那一端的小標記） */
.rings { position: absolute; pointer-events: none; }
.rg { position: absolute; overflow: visible; }
/* 標記跨在外框的上緣（被切的是上緣時放下緣）正中間；白邊讓它壓在泡泡的黑線上也看得清楚 */
.wm { position: absolute; left: 50%; top: 0; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center;
  gap: 4px; width: 36px; height: 16px; border-radius: 999px; background: var(--naru-highlight); box-shadow: 0 0 0 2px #fff; }
.rg.at-bottom .wm { top: 100%; }
.wm span { width: 4px; height: 4px; border-radius: 50%; background: #fff; animation: naru-dot 1.2s ease-in-out infinite; }
.wm span:nth-child(2) { animation-delay: 0.2s; }
.wm span:nth-child(3) { animation-delay: 0.4s; }
@keyframes naru-dot { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
.rg.out { animation: naru-out ${REVEAL_FADE_MS}ms ease-out forwards; }
/*
 * 翻譯中：日文上一道擦除底色（--erase）的直立光帶由右往左掃過（跟直書的行一樣方向），Balloon 蓋泡泡的內切橢圓、Loose Text 蓋文字框外面一小圈，邊緣羽化；不畫框，大部分泡泡不是方的。
 * 光帶不斜：斜的光帶在直長的框上，停下來時兩端還留在框裡，下一輪又從另一角跳出來
 */
.wash { position: absolute; mask-composite: intersect;
  mask-image: linear-gradient(90deg, transparent, #000 ${WASH_FEATHER_PX}px, #000 calc(100% - ${WASH_FEATHER_PX}px), transparent),
    linear-gradient(180deg, transparent, #000 ${WASH_FEATHER_PX}px, #000 calc(100% - ${WASH_FEATHER_PX}px), transparent); }
.wash.oval { mask-image: radial-gradient(ellipse closest-side, #000 calc(100% - ${WASH_FEATHER_PX}px), transparent); }
.wash::before { content: ''; position: absolute; inset: 0; background: no-repeat 0 0 / 300% 100%
  linear-gradient(90deg, rgb(var(--erase) var(--erase) var(--erase) / 0) 35%, rgb(var(--erase) var(--erase) var(--erase) / ${WASH_ALPHA}) 50%, rgb(var(--erase) var(--erase) var(--erase) / 0) 65%);
  animation: naru-wash ${WASH_MS}ms ease-in-out var(--delay, 0ms) infinite; }
@keyframes naru-wash { 75%, 100% { background-position: 100% 0; } }
@keyframes naru-out { to { opacity: 0; } }
@keyframes naru-in { from { opacity: 0; } }
/* 截圖時用 visibility 藏（不能被 OCR 讀到）：display:none 會讓動畫從頭開始，每截一次明暗就跳一下 */
:host([data-capturing]) .rings, :host([data-outlines-hidden]) .rings { visibility: hidden; }
@media (prefers-reduced-motion: reduce) {
  .wm span { animation: none; opacity: 1; }
  .wash::before { animation: none; background: rgb(var(--erase) var(--erase) var(--erase) / ${WASH_STILL_ALPHA}); }
  /* 「譯」區塊只淡入淡出，不位移、不縮放 */
  .tip-reveal .tip-reveal-body > div, .tip-reveal .tip-reveal-icon g { transform: none !important; }
}
`;

const WHOLE_PAGE: RatioRect = { x: 0, y: 0, w: 1, h: 1 };
/** 截圖前等重繪最多這麼久：tab 不在前景時 rAF 不會跑（那時也截不到它）。 */
const FRAME_TIMEOUT_MS = 200;
/** tooltip 的畫面字級。 */
const TOOLTIP_SCREEN_PX = 15;
/** 高亮框的畫面邊框粗細。 */
const HIGHLIGHT_SCREEN_PX = 2;
/** 高亮框編號的畫面字級。 */
const NUMBER_SCREEN_PX = 11;
/**
 * 學習時 tooltip 四周的緩衝（畫面 px）：tooltip 緊貼在句子的框旁邊，滑鼠從句子斜著移進 tooltip 時可能擦過框外一點點。
 * 只在 tooltip 已經顯示時才算，而且只有這麼窄，不會吃掉閱讀網站翻頁感應區的正常使用（spec #70 Further Notes）。
 */
const TOOLTIP_BUFFER_SCREEN_PX = 8;

/** 畫面座標 (x, y) 在 rect 往外擴 margin 的範圍內。 */
const within = (r: DOMRect, x: number, y: number, margin = 0) =>
  x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;

/** 頁面上可以 hover 的一句（Balloon 或 Loose Text），座標是 Page 原始像素。 */
interface HoverLine {
  id: string;
  /** 閱讀順序：側邊欄開著時標在高亮框上的編號，跟側邊欄那行一樣（U10）。 */
  order: number;
  /** Loose Text（unreadable 時的說明跟 Balloon 不同，U17）。 */
  loose: boolean;
  box: Box;
  原文: string;
  讀音: string;
  讀音分詞?: ReadingWord[];
  羅馬拼音?: string;
  羅馬拼音分詞?: RomajiWord[];
  譯文: string;
  unreadable: boolean;
}

interface PageLayer {
  /** Page 身分（pageHash），hover 同步用：同一個 anchor 上的兩個 Page 各自一個。 */
  pageHash: string;
  sub: RatioRect;
  size: { width: number; height: number };
  element: HTMLElement;
  tip: HTMLElement;
  /** 高亮框（滑過頁面或 side panel 那行時）。 */
  highlight: HTMLElement;
  /** 高亮框的編號（側邊欄開著時）。 */
  orderBadge: HTMLElement;
  lines: HoverLine[];
}

interface Entry {
  anchor: HTMLElement;
  host: HTMLElement;
  root: ShadowRoot;
  layers: Map<string, PageLayer>;
  /** Page 上的外圈（#285、#283）；沒有＝這個 anchor 上沒有外圈。key＝outlineKey。 */
  outlines?: { layer: HTMLElement; items: Map<string, Outline> };
}

/** 畫在 anchor 上的一個外圈。 */
interface Outline {
  element: HTMLElement;
  state: 'translating' | 'waiting';
  /** 所在的 Page（subKey）。 */
  sub: string;
  id: string;
  order: number;
  /** SW 說不在翻了、等譯文來收的計時（OUTLINE_RETIRE_MS）。 */
  retire?: ReturnType<typeof setTimeout>;
  /** 譯文到了，正在照順序收起：排好的計時。 */
  leaving?: ReturnType<typeof setTimeout>[];
}

/** 一個 Page 上要畫的外圈（SW 送來的 PageOutlines，anchorId 已換成元素）。 */
export interface OutlinesOnAnchor {
  anchor: HTMLElement;
  /** Page 在 anchor 裡的範圍；省略＝整個 anchor。 */
  sub?: RatioRect;
  translating: LineBox[];
  waiting: LineBox[];
}

const subKey = (sub: RatioRect) => `${sub.x},${sub.y},${sub.w},${sub.h}`;
const outlineKey = (sub: RatioRect, state: Outline['state'], id: string) => `${subKey(sub)}|${state}|${id}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** canvas 的 width/height、img 的 naturalWidth/Height；其他元素不知道。 */
export function intrinsicSize(anchor: Element): { width: number; height: number } {
  if (anchor instanceof HTMLCanvasElement) return { width: anchor.width, height: anchor.height };
  if (anchor instanceof HTMLImageElement) return { width: anchor.naturalWidth, height: anchor.naturalHeight };
  return { width: 0, height: 0 };
}

function setBox(el: HTMLElement, box: Box): void {
  Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
}

/** 擦除底色的元素（怎麼畫由 eraseFill 決定）：小圖用 img，矩形用塗色的 div。 */
function eraseElement(text: Parameters<typeof eraseFill>[0], rect: Box, size: { width: number; height: number }): HTMLElement {
  const fill = eraseFill(text);
  if (fill.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'er img';
    img.src = fill.image;
    setBox(img, ratioToBox(fill.box, size));
    return img;
  }
  const div = document.createElement('div');
  div.className = 'er';
  setBox(div, rect);
  div.style.background = `rgb(${fill.luminance}, ${fill.luminance}, ${fill.luminance})`;
  return div;
}

function textDiv(className: string, text: string): HTMLElement {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return div;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 「譯」區塊的翻譯圖示（兩個對話框，形狀見 translate-icon.ts）；顏色與動畫在 STYLE 的 .tip-reveal-icon。 */
function translateIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'tip-reveal-icon');
  svg.setAttribute('viewBox', TRANSLATE_ICON.viewBox);
  svg.setAttribute('aria-hidden', 'true');
  for (const [className, shape] of [['src', TRANSLATE_ICON.source], ['dst', TRANSLATE_ICON.target]] as const) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', className);
    for (const part of ['bubble', 'glyph'] as const) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', part);
      path.setAttribute('d', shape[part]);
      g.append(path);
    }
    svg.append(g);
  }
  return svg;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * 等兩個 rAF（確定已重繪）；tab 在背景時 rAF 不會跑，最多等 FRAME_TIMEOUT_MS。
 * 回傳有沒有真的重繪：false＝頁面沒在產生新畫面，這時截圖拿到的是舊 frame（#197）。
 */
export const untilRepainted = () =>
  Promise.race([
    nextFrame().then(nextFrame).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FRAME_TIMEOUT_MS)),
  ]);

/** 滑鼠移到哪一句上（null＝離開）。 */
export type OnHover = (line: LineRef | null) => void;

const trace = createTrace('content');

export function createOverlay({ onHover }: { onHover?: OnHover } = {}) {
  const entries = new Map<HTMLElement, Entry>();
  /** 被我們從 static 改成 relative 的父元素 → 原本的 inline position，停止時還原。 */
  const changedParents = new Map<HTMLElement, string>();
  let pageMode: PageMode = 'read';
  let displaySettings: DisplaySettings = DEFAULT_DISPLAY_SETTINGS;
  let capturing = false;
  /** 截圖中也不藏的 anchor（長 Page）。 */
  let keptDuringCapture: ReadonlySet<Element> = new Set();
  let hiddenAt: number | undefined;
  /** 截圖中：Page 上的外圈藏著（截圖途中才建的 host 也要藏）。 */
  let outlinesHidden = false;
  /** 所有 Page 的譯文都淡入完的時間（performance.now()）：淡入（#285）還沒結束時不算「覆蓋層畫好了」。 */
  let revealUntil = 0;
  let stopped = false;

  const resizeObserver = new ResizeObserver((records) => {
    for (const record of records) {
      const entry = entries.get(record.target as HTMLElement);
      if (entry) place(entry);
    }
  });
  const mutationObserver = new MutationObserver((records) => {
    // img 換了 src（電子書閱讀器翻頁、視窗大小變了重新產生合成圖）：上面已經不是那些 Page，舊覆蓋先拿掉，
    // 等 SW 重新擷取後送新的（同一頁就從記住的結果重送，overlay-sync.ts）
    for (const record of records) {
      const entry = record.attributeName === 'src' ? entries.get(record.target as HTMLElement) : undefined;
      if (!entry) continue;
      // 外圈也是上一頁的
      for (const key of [...(entry.outlines?.items.keys() ?? [])]) dropOutline(entry, key);
      if (entry.layers.size > 0) removeLayers(entry, 'anchor 的 src 換了');
    }
    for (const entry of entries.values()) {
      reattach(entry);
      // style／class 變了：anchor（或祖先）可能被藏起來或重新顯示
      applyVisibility(entry);
    }
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class'] });
  const onResize = () => entries.forEach(place);
  window.addEventListener('resize', onResize);
  /** 滑鼠目前在哪一句上（頁面 hover）。 */
  let hovered: { layer: PageLayer; line: HoverLine } | undefined;
  /** side panel 那邊滑過的那句。 */
  let panelHighlight: LineRef | undefined;
  /** 這個分頁的側邊欄開著沒（side panel 接上的 port，U10）：開著時閱讀模式不出 tooltip，高亮框標編號。 */
  let panelOpen = false;
  /** 學習時 tooltip 的「譯」區塊是否揭露中（滑鼠在區塊上）。 */
  let revealed = false;
  /** 上一次 pointermove 的位置：判斷滑鼠往哪個方向移。 */
  let lastPointer: Point | undefined;
  /** 學習時朝 tooltip 前進中、先不換句；滑鼠停住這麼久就照實際位置換。 */
  let dwellTimer: ReturnType<typeof setTimeout> | undefined;
  const onPointerMove = (event: PointerEvent) => updateHover(event.clientX, event.clientY);
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });

  /** host 要不要顯示：不在截圖中（或截圖時不藏的長 Page）、anchor 看得到。 */
  const isVisible = (entry: Entry) => (!capturing || keptDuringCapture.has(entry.anchor)) && isShown(entry.anchor);

  function applyVisibility(entry: Entry): void {
    const visibility = isVisible(entry) ? 'visible' : 'hidden';
    // 只在真的變了才寫：自己的 MutationObserver 也看 style，寫一樣的值會一直被叫回來
    if (entry.host.style.visibility === visibility) return;
    if (!capturing)
      trace('overlay:anchorVisibility', { pageHashes: [...entry.layers.values()].map((layer) => layer.pageHash), shown: visibility === 'visible' });
    // anchor 被藏起來（不是截圖時藏 host）：再出現時上面可能已經換頁了，canvas 重畫沒有 src 可看（#276）。
    // 譯文先藏著，等截圖確認（confirm）或新的譯文到（show）。學習時譯文本來就不顯示，不用等。
    if (!capturing && visibility === 'hidden' && entry.layers.size > 0 && pageMode !== 'learn') entry.host.dataset.unverified = '';
    entry.host.style.visibility = visibility;
    if (visibility === 'hidden' && hovered && [...entry.layers.values()].includes(hovered.layer)) setHovered(undefined);
  }

  /** host 插回 anchor 後面；父元素是 static 就改成 relative（唯一碰主頁面樣式的地方）。 */
  function attach(entry: Entry): void {
    entry.anchor.after(entry.host);
    const parent = entry.host.parentElement;
    if (parent && !changedParents.has(parent) && getComputedStyle(parent).position === 'static') {
      changedParents.set(parent, parent.style.position);
      parent.style.position = 'relative';
    }
    // 跟 anchor 疊在同一層之上
    const z = parseInt(getComputedStyle(entry.anchor).zIndex, 10);
    entry.host.style.zIndex = String(Number.isNaN(z) ? 1 : z + 1);
  }

  /** 主頁面重繪把 host 丟掉（或把 anchor 搬走）就重掛；anchor 不在了就先拿掉 host，等它回來。 */
  function reattach(entry: Entry): void {
    const pageHashes = () => [...entry.layers.values()].map((layer) => layer.pageHash);
    if (!entry.anchor.isConnected) {
      if (entry.host.isConnected) {
        entry.host.remove();
        trace('overlay:detach', { pageHashes: pageHashes(), reason: 'anchor 不在 DOM 裡' });
      }
      return;
    }
    if (entry.host.isConnected && entry.host.previousElementSibling === entry.anchor) return;
    trace('overlay:reattach', { pageHashes: pageHashes(), reason: entry.host.isConnected ? 'host 被移到別處' : 'host 被移除' });
    attach(entry);
    place(entry);
  }

  function removeLayers(entry: Entry, reason: string): void {
    trace('overlay:removeLayers', { pageHashes: [...entry.layers.values()].map((layer) => layer.pageHash), reason });
    if (hovered && [...entry.layers.values()].includes(hovered.layer)) setHovered(undefined);
    for (const layer of entry.layers.values()) layer.element.remove();
    entry.layers.clear();
  }

  /** 截圖確認 anchor 上剩下的覆蓋層還是同一頁：先藏著的譯文顯示回來（#276）。 */
  function confirm(anchor: HTMLElement): void {
    const entry = entries.get(anchor);
    if (!entry || !('unverified' in entry.host.dataset)) return;
    trace('overlay:confirm', { pageHashes: [...entry.layers.values()].map((layer) => layer.pageHash) });
    delete entry.host.dataset.unverified;
  }

  /** 拿掉 anchor 上這幾頁的覆蓋層：截圖看到 anchor 上已經換成別頁（canvas 重畫沒有 src 可看，#276）。 */
  function remove(anchor: HTMLElement, pageHashes: readonly string[]): void {
    const entry = entries.get(anchor);
    if (!entry) return;
    const olds = [...entry.layers].filter(([, layer]) => pageHashes.includes(layer.pageHash));
    if (olds.length === 0) return;
    trace('overlay:remove', { pageHashes: olds.map(([, layer]) => layer.pageHash), reason: '截圖看到 anchor 上換頁了' });
    for (const [key, layer] of olds) {
      if (hovered?.layer === layer) setHovered(undefined);
      entry.layers.delete(key);
      layer.element.remove();
    }
  }

  function place(entry: Entry): void {
    for (const layer of entry.layers.values()) {
      const t = layerTransform(entry.anchor, layer.sub, layer.size);
      layer.element.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scaleX}, ${t.scaleY})`;
    }
    // 不縮放：跟 anchor 一樣大的框，外圈的線寬是畫面 px
    const t = layerTransform(entry.anchor, WHOLE_PAGE, { width: 1, height: 1 });
    const element = entry.outlines?.layer;
    if (element) Object.assign(element.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.scaleX}px`, height: `${t.scaleY}px` });
  }

  function dropOutline(entry: Entry, key: string): void {
    const outline = entry.outlines?.items.get(key);
    if (!entry.outlines || !outline) return;
    clearTimeout(outline.retire);
    outline.leaving?.forEach(clearTimeout);
    outline.element.remove();
    entry.outlines.items.delete(key);
    if (entry.outlines.items.size > 0) return;
    entry.outlines.layer.remove();
    entry.outlines = undefined;
  }

  /**
   * 畫一個外圈（已經有就只更新位置）：位置用 anchor 的百分比，anchor 縮放時跟著走。翻譯中是外框上的底色光帶；
   * 等待中是看得到的那一端的小標記，Loose Text 的框往外擴一點、標記不壓在字上。
   */
  function drawOutline(entry: Entry, key: string, state: Outline['state'], sub: RatioRect, line: LineBox, rank: number): void {
    // 正在收起的同一句又要畫（重試）：換一個新的
    if (entry.outlines?.items.get(key)?.leaving) dropOutline(entry, key);
    if (!entry.outlines) {
      const layer = document.createElement('div');
      layer.className = 'rings';
      // 放在 Page 層前面：譯文與 tooltip 蓋在外圈上面
      entry.root.querySelector('style')!.after(layer);
      entry.outlines = { layer, items: new Map() };
    }
    let outline = entry.outlines.items.get(key);
    if (!outline) {
      const element = state === 'translating' ? washElement(line, rank) : waitingMark(line);
      element.dataset.outline = state;
      element.dataset.lineId = line.id;
      entry.outlines.layer.append(element);
      outline = { element, state, sub: subKey(sub), id: line.id, order: line.order };
      entry.outlines.items.set(key, outline);
    }
    clearTimeout(outline.retire);
    outline.retire = undefined;
    const { x, y, w, h } = onAnchor(line.box, sub);
    // 翻譯中的外框不往外擴：光帶的範圍在 washElement 裡相對外框算
    const pad = state === 'waiting' && line.kind === 'loose' ? LOOSE_OUTLINE_PAD_PX : 0;
    Object.assign(outline.element.style, {
      left: `calc(${x * 100}% - ${pad}px)`,
      top: `calc(${y * 100}% - ${pad}px)`,
      width: `calc(${w * 100}% + ${2 * pad}px)`,
      height: `calc(${h * 100}% + ${2 * pad}px)`,
    });
  }

  /**
   * 換掉所有 Page 上的外圈（#285、#283）；沒列到的拿掉。等待中的馬上拿掉；翻譯中的先留著，等譯文來收（retireOutlines），
   * 等不到才拿掉：SW 說「翻完了」跟譯文畫上去之間隔著字型與擦除小圖的載入。
   */
  function setOutlines(pages: OutlinesOnAnchor[]): void {
    if (stopped) return;
    const wanted = new Map<Entry, Map<string, () => void>>();
    for (const { anchor, sub = WHOLE_PAGE, translating, waiting } of pages) {
      const entry = entryFor(anchor);
      const draws = wanted.get(entry) ?? new Map<string, () => void>();
      wanted.set(entry, draws);
      const ranks = staggerRanks(translating);
      for (const line of translating) {
        const key = outlineKey(sub, 'translating', line.id);
        draws.set(key, () => drawOutline(entry, key, 'translating', sub, line, ranks.get(line.id) ?? 0));
      }
      for (const line of waiting) {
        const key = outlineKey(sub, 'waiting', line.id);
        draws.set(key, () => drawOutline(entry, key, 'waiting', sub, line, 0));
      }
    }
    for (const entry of entries.values()) {
      for (const [key, outline] of [...(entry.outlines?.items ?? [])]) {
        if (wanted.get(entry)?.has(key) || outline.leaving) continue;
        if (outline.state === 'waiting') dropOutline(entry, key);
        else outline.retire ??= setTimeout(() => dropOutline(entry, key), OUTLINE_RETIRE_MS);
      }
    }
    for (const [entry, draws] of wanted) {
      for (const draw of draws.values()) draw();
      place(entry);
    }
    if (__DEBUG__)
      trace('overlay:outlines', {
        pages: pages.map(({ sub, translating, waiting }) => ({ sub, translating: translating.length, waiting: waiting.length })),
      });
  }

  /**
   * 譯文到了：這個 Page 上這幾句翻譯中的外圈一起收起。回傳收掉外圈的句子（它們的譯文同時淡入）；
   * 沒有外圈的句子不在裡面（直接出現：快取的頁、長 Page 之前翻好的句子）。
   */
  function retireOutlines(entry: Entry, sub: RatioRect, ids: ReadonlySet<string>): Set<string> {
    const mine = [...(entry.outlines?.items ?? [])].filter(([, o]) => o.state === 'translating' && !o.leaving && o.sub === subKey(sub) && ids.has(o.id));
    for (const [key, outline] of mine) {
      clearTimeout(outline.retire);
      outline.retire = undefined;
      outline.element.classList.add('out');
      outline.leaving = [setTimeout(() => dropOutline(entry, key), REVEAL_FADE_MS)];
    }
    return new Set(mine.map(([, outline]) => outline.id));
  }

  function entryFor(anchor: HTMLElement): Entry {
    let entry = entries.get(anchor);
    if (entry) return entry;
    const host = document.createElement('div');
    host.setAttribute(HOST_ATTRIBUTE, '');
    host.dataset.pageMode = pageMode;
    if (outlinesHidden) host.dataset.outlinesHidden = '';
    host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;margin:0;padding:0;border:0;';
    // 譯文是繁中：字型（缺字時 Chrome 補的字型也是）跟著 lang 挑，不跟著日文網頁的 lang="ja"；tooltip 的原文另外標 ja
    host.lang = 'zh-Hant';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.append(style);
    entry = { anchor, host, root, layers: new Map() };
    entries.set(anchor, entry);
    applyVisibility(entry);
    attach(entry);
    resizeObserver.observe(anchor);
    return entry;
  }

  /** 一行一段、中間 <br>（行在哪裡斷由 layoutText 決定，不讓瀏覽器自動換行，#81、#129）。 */
  function setLines(inner: HTMLElement, lines: string[], vertical: boolean): void {
    inner.replaceChildren();
    for (const [i, text] of lines.entries()) {
      if (i > 0) inner.append(document.createElement('br'));
      appendRuns(inner, text, vertical);
    }
  }

  const RUN_CLASS = { combine: 'u', sideways: 's', upright: 'r' } as const;

  function appendRuns(inner: HTMLElement, text: string, vertical: boolean): void {
    for (const run of vertical ? verticalize(text) : [{ text, form: 'plain' as const }]) {
      if (run.form === 'plain') inner.append(run.text);
      else {
        const span = document.createElement('span');
        span.className = RUN_CLASS[run.form];
        span.textContent = run.text;
        inner.append(span);
      }
    }
  }

  /** 把一個 Page 的譯文覆蓋在 anchor 上；同一個 Page（subRect）再呼叫就換成新的。pageHash＝hover 同步用的 Page 身分。 */
  async function show(anchor: HTMLElement, sub: RatioRect = WHOLE_PAGE, text: PageText, pageHash = ''): Promise<void> {
    const { balloons, looseText } = overlaidTexts(text);
    // 字型好了才量縮字
    await loadPunctuationFont();
    if (stopped) return;
    const entry = entryFor(anchor);
    const size = pageSize(intrinsicSize(anchor), sub, anchor);
    const element = document.createElement('div');
    element.className = 'pl';
    Object.assign(element.style, { width: `${size.width}px`, height: `${size.height}px` });
    const tip = document.createElement('div');
    tip.className = 'tip';
    const highlight = document.createElement('div');
    highlight.className = 'hl';
    const orderBadge = document.createElement('div');
    orderBadge.className = 'num';
    const toHoverLine = (t: PageText['balloons'][number] | PageText['looseText'][number], bbox: RatioRect, loose: boolean): HoverLine => ({
      id: t.id,
      order: t.order,
      loose,
      box: ratioToBox(bbox, size),
      原文: t.原文,
      讀音: t.讀音,
      ...(t.讀音分詞 === undefined ? {} : { 讀音分詞: t.讀音分詞 }),
      ...(t.羅馬拼音 === undefined ? {} : { 羅馬拼音: t.羅馬拼音 }),
      ...(t.羅馬拼音分詞 === undefined ? {} : { 羅馬拼音分詞: t.羅馬拼音分詞 }),
      譯文: t.譯文,
      unreadable: t.unreadable,
    });
    // 不覆蓋的段（unreadable、Sound Effect）滑過時一樣有 tooltip、一樣跟 side panel 同步
    const lines: HoverLine[] = [
      ...text.balloons.map((b) => toHoverLine(b, b.balloonBbox, false)),
      ...text.looseText.map((l) => toHoverLine(l, l.bbox, true)),
    ];
    const layer: PageLayer = { pageHash, sub, size, element, tip, highlight, orderBadge, lines };

    // Balloon 與 Loose Text 一起排、一起 separateRegions；frame 是判斷直書橫書的框，Loose Text 的排版區是文字框本身（#151）
    const overlaid = [
      ...balloons.map((b) => {
        const frame = ratioToBox(b.balloonBbox, size);
        const textBox = ratioToBox(b.textBbox, size);
        // Balloon 的排版區跟排版矩形取交集（#150）；Loose Text 不取
        const fit = b.erase?.fit;
        return { kind: 'balloon' as const, line: b, frame, regions: { text: textBox, ...textRegions(frame, textBox, fit && ratioToBox(fit, size)) } };
      }),
      ...looseText.map((l) => {
        const textBox = ratioToBox(l.bbox, size);
        return { kind: 'loose' as const, line: l, frame: textBox, regions: { text: textBox, ...looseTextRegions(textBox) } };
      }),
    ];
    separateRegions(overlaid.map((o) => o.regions));
    const items = overlaid.map(({ kind, line, frame, regions }) => {
      const luminance = line.eraseLuminance ?? ERASE_WHITE;
      const erase = eraseElement(line, regions.erase, size);
      erase.dataset.eraseId = line.id;
      const vertical = isVertical(line.orientation, frame);
      const box = document.createElement('div');
      box.className = `tx${vertical ? ' v' : ''}`;
      const [ink, stroke] = luminance < 128 ? ['#fff', '#111'] : ['#111', '#fff'];
      box.style.color = ink;
      if (kind === 'loose') {
        box.classList.add('ol');
        box.dataset.looseId = line.id;
        // Loose Text 的反色描邊：黑字配白邊、白字配黑邊（Balloon 不加）
        box.style.webkitTextStrokeColor = stroke;
      } else box.dataset.balloonId = line.id;
      const originalLines = estimateOriginalLines(regions.text, line.原文, vertical);
      const inner = document.createElement('span');
      box.append(inner);
      return { kind, line, regions, erase, box, inner, vertical, originalLines };
    });
    // 擦除小圖解碼完才放上去：之後會截「帶覆蓋層的樣子」，還沒解碼的圖會露出原文
    await Promise.all(items.map(({ erase }) => (erase instanceof HTMLImageElement ? erase.decode().catch(() => {}) : undefined)));
    if (stopped) return;
    // 擦除底色全部在譯文之前：偵測框重疊時，後一段的底色才不會蓋掉前一段的譯文
    element.append(...items.map((item) => item.erase), ...items.map((item) => item.box), highlight, tip, orderBadge);

    // 換掉同一個範圍上的舊層，以及同一個 Page 在別的範圍上的舊層：視窗大小變了、合成圖重畫後，同一頁量到的
    // subRect 會變，舊的那層不拿掉就會留在舊位置、跟新的疊在一起
    const olds = [...entry.layers].filter(([key, l]) => key === subKey(sub) || (pageHash !== '' && findSamePage([l], pageHash)));
    for (const [key, old] of olds) {
      if (hovered?.layer === old) setHovered(undefined);
      entry.layers.delete(key);
    }
    entry.layers.set(subKey(sub), layer);
    // 新的譯文是 SW 依這次截圖送的：anchor 上確實是這一頁
    delete entry.host.dataset.unverified;
    // 翻譯中的外圈（#285）一起收起，擦除與譯文同時淡入：整頁一次顯示，不照順序錯開
    // 只收這次有結果的句子：長 Page 另一截還在翻的句子也在 text 裡（還沒有譯文），它們的外圈留著
    const answered = lines.filter((line) => line.譯文 !== '' || line.unreadable);
    const revealed = retireOutlines(entry, sub, new Set(answered.map((line) => line.id)));
    for (const { line, erase, box } of items) {
      if (!revealed.has(line.id)) continue;
      for (const el of [erase, box]) {
        el.style.animation = `naru-in ${REVEAL_FADE_MS}ms ease-out backwards`;
        // 播完（或被打斷）就拿掉：留著的話，host 被網站搬動、重新顯示時動畫會從頭播，譯文又閃一次
        const settle = () => (el.style.animation = '');
        el.addEventListener('animationend', settle, { once: true });
        el.addEventListener('animationcancel', settle, { once: true });
      }
    }
    if (revealed.size > 0) trace('overlay:reveal', { pageHash, lines: revealed.size });
    // 先縮放再放進 DOM：Page 像素大小的層一放進去就可能超出視窗、撐出捲軸，place() 量到的就是被擠窄的 anchor；
    // 捲軸在同一段同步程式裡又消失，ResizeObserver 看不到這次變化，層就一直對在錯的位置（試翻頁右頁往左偏）
    place(entry);
    entry.root.append(element);
    for (const [, old] of olds) old.element.remove();

    // 縮字只在建立時量一次（實際量測是否溢出）；縮放不重排。最小字級用當下的畫面倍率換算，起始字級每框各自估（#80、#81）。
    // Loose Text 大小差很多（標題、旁白、小註記），各自依文字框估，不夾在整頁 Balloon 的中位數附近
    const screenScale = (anchor.getBoundingClientRect().width * sub.w) / size.width || 1;
    const minLayerPx = minLayerFontPx(screenScale);
    const sizing = (item: (typeof items)[number]) => ({ text: item.regions.text, 譯文: item.line.譯文 });
    const balloonItems = items.filter((item) => item.kind === 'balloon');
    const balloonSizes = new Map(estimateFontPx(balloonItems.map(sizing)).map((px, i) => [balloonItems[i]!, px]));
    const startSizes = items.map((item) => balloonSizes.get(item) ?? estimateFontPx([sizing(item)])[0]!);
    const fits: Record<string, unknown>[] = [];
    for (const [i, { kind, line, regions, box, inner, vertical, originalLines }] of items.entries()) {
      const target = {
        setLines: (lines: string[]) => setLines(inner, lines, vertical),
        apply(region: Box, px: number) {
          setBox(box, region);
          box.style.fontSize = `${px}px`;
        },
        overflows: () =>
          inner.offsetWidth > box.clientWidth + 1 ||
          inner.offsetHeight > box.clientHeight + 1 ||
          box.scrollWidth > box.clientWidth + 1 ||
          box.scrollHeight > box.clientHeight + 1,
      };
      let result = layoutText(target, line.譯文, originalLines, regions, minLayerPx, startSizes[i]);
      // 每個候選行數都排不下（譯文範圍跟文字框的形狀差太多）就讓瀏覽器自動換行再試，最差跟 #81 之前一樣
      const wrapped = result.stage === 3;
      if (wrapped) {
        box.dataset.wrap = '';
        result = { lines: result.lines, ...fitText(target, regions, minLayerPx, startSizes[i]) };
      }
      box.dataset.fit = String(result.stage);
      if (__DEBUG__) {
        // 填充率＝譯文實際佔的面積 ÷ 文字框面積；renderedLines 是畫面上實際排出的行數（#81 的評估指標）
        const textArea = regions.text.w * regions.text.h;
        const fillRate = textArea > 0 ? (inner.offsetWidth * inner.offsetHeight) / textArea : null;
        const renderedLines = Math.round((vertical ? inner.offsetWidth : inner.offsetHeight) / (result.size * LINE_HEIGHT));
        fits.push({
          id: line.id,
          kind,
          譯文: line.譯文,
          vertical,
          startPx: startSizes[i],
          originalLines,
          wrapped,
          renderedLines,
          fillRate,
          ...result,
          regions,
          eraseLuminance: line.eraseLuminance,
        });
      }
    }
    if (__DEBUG__) {
      const anchorRect = anchor.getBoundingClientRect();
      const skipped = (t: PageText['balloons'][number] | PageText['looseText'][number]) => ({ id: t.id, unreadable: t.unreadable, sfx: t.sfx, 譯文: t.譯文 });
      trace('overlay:show', {
        pageHash,
        sub,
        pageSize: size,
        anchorRect: { x: anchorRect.x, y: anchorRect.y, width: anchorRect.width, height: anchorRect.height },
        screenScale,
        minLayerPx,
        skipped: [...text.balloons.filter((b) => !balloons.includes(b)), ...text.looseText.filter((l) => !looseText.includes(l))].map(skipped),
        fits,
      });
    }
    tip.style.fontSize = `${TOOLTIP_SCREEN_PX / screenScale}px`;
    tip.style.maxWidth = `${size.width * 0.8}px`;
    highlight.style.borderWidth = `${HIGHLIGHT_SCREEN_PX / screenScale}px`;
    orderBadge.style.fontSize = `${NUMBER_SCREEN_PX / screenScale}px`;
    highlight.style.borderRadius = `${(2 * HIGHLIGHT_SCREEN_PX) / screenScale}px`;
    renderHighlights();
    // 等畫到畫面上才 resolve：呼叫端接著會截「帶覆蓋層的樣子」，太早截會截到還沒畫出來的畫面；淡入的也要等淡完
    // 別的 Page 還在蓋（Spread 的另一頁）也等：那次截圖截的是整個畫面，會把蓋到一半的樣子記成那一頁
    if (revealed.size > 0) revealUntil = Math.max(revealUntil, performance.now() + REVEAL_FADE_MS);
    while (!stopped && performance.now() < revealUntil) await sleep(revealUntil - performance.now());
    await untilRepainted();
  }

  /**
   * 覆蓋層一律 pointer-events:none，hover 靠座標自己 hit-test（spec 第 7.1 節）：Page 層的畫面 rect（含捲動與
   * 祖先 transform）換算回 Page 原始像素，找包含滑鼠的最小那句。aim＝學習時正朝 tooltip 前進就先不換句。
   */
  function updateHover(x: number, y: number, aim = true): void {
    clearTimeout(dwellTimer);
    const from = lastPointer;
    lastPointer = { x, y };
    // 滑鼠在顯示中的 tooltip 上（含緩衝）：tooltip 留著，在「譯」區塊上就揭露譯文，在詞上就亮那個詞
    if (hovered && keepsTooltip(hovered.layer.tip) && within(hovered.layer.tip.getBoundingClientRect(), x, y, TOOLTIP_BUFFER_SCREEN_PX)) {
      const { tip } = hovered.layer;
      const chip = tip.querySelector('.tip-reveal');
      setRevealed(chip !== null && within(chip.getBoundingClientRect(), x, y));
      setHoveredWord(tip, { x, y });
      return;
    }
    // 出了 tooltip：裡面亮著的詞熄掉（直接回到同一句的框上時 setHovered 不重畫 tooltip）
    if (hovered) setHoveredWord(hovered.layer.tip, undefined);
    let hit: { layer: PageLayer; line: HoverLine; area: number } | undefined;
    for (const entry of entries.values()) {
      if (entry.host.style.visibility === 'hidden' || 'unverified' in entry.host.dataset) continue;
      for (const layer of entry.layers.values()) {
        const r = layer.element.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const px = ((x - r.left) / r.width) * layer.size.width;
        const py = ((y - r.top) / r.height) * layer.size.height;
        for (const line of layer.lines) {
          const { box } = line;
          if (px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h) continue;
          const area = box.w * box.h;
          if (!hit || area < hit.area) hit = { layer, line, area };
        }
      }
    }
    const next = hit && { layer: hit.layer, line: hit.line };
    // 從句子移向 tooltip（「譯」區塊或詞），途中擦過別句的框或空白（安全三角形）：先留著這句，停住夠久才換
    if (aim && from && hovered && keepsTooltip(hovered.layer.tip) && next?.line !== hovered.line) {
      const r = hovered.layer.tip.getBoundingClientRect();
      const m = TOOLTIP_BUFFER_SCREEN_PX;
      if (headingToward(from, { x, y }, { left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m })) {
        dwellTimer = setTimeout(() => updateHover(x, y, false), HOVER_DWELL_MS);
        return;
      }
    }
    setHovered(next);
  }

  function setHovered(next: { layer: PageLayer; line: HoverLine } | undefined): void {
    if (next?.layer === hovered?.layer && next?.line === hovered?.line) return;
    const previous = hovered;
    hovered = next;
    previous?.layer.tip.classList.remove('on');
    if (next) showTooltip(next.layer, next.line);
    renderHighlights();
    if (next) onHover?.({ pageHash: next.layer.pageHash, lineId: next.line.id });
    else if (previous) onHover?.(null);
  }

  /**
   * tooltip：原文＋ルビ＋譯文（全文，第 3 階截斷的也看得到）。學習時譯文藏在「譯」區塊後面，
   * 滑進區塊才揭露；每次顯示都重新藏起來。
   */
  function showTooltip(layer: PageLayer, line: HoverLine): void {
    const { tip } = layer;
    revealed = false;
    if (!hoverAid({ pageMode, panelOpen }).tooltip) {
      tip.classList.remove('on');
      return;
    }
    const ja = document.createElement('div');
    ja.className = 'tip-ja';
    ja.lang = 'ja';
    const parts: Node[] = [ja];
    if (line.unreadable) {
      ja.classList.add('tip-unreadable');
      ja.textContent = line.原文;
      parts.push(textDiv('tip-zh', unreadableLabel(line.loose)));
    } else {
      const display = rubyDisplay(line.原文, line.讀音, line.讀音分詞);
      // 羅馬拼音（⚙ 的「讀音加上羅馬拼音」）：tooltip 一律有讀音，所以只看設定
      const showRomaji = displaySettings.romaji && line.羅馬拼音 !== undefined && line.羅馬拼音 !== '';
      // 按詞（#330）：原文與羅馬拼音都切成詞，data-word 一樣的兩邊一起亮（updateHover）；沒有詞資料就照舊整句一行
      const units = showRomaji ? wordUnits(line.原文, display, line.羅馬拼音分詞) : null;
      const romaji = textDiv('tip-romaji', '');
      romaji.lang = 'ja-Latn';
      if (units) {
        units.forEach((unit, i) => {
          const word = document.createElement('span');
          word.className = 'w';
          appendSegments(word, unit.segments);
          ja.append(word);
          if (unit.羅馬拼音 === '') return;
          word.dataset.word = String(i);
          const latin = document.createElement('span');
          latin.className = 'w';
          latin.dataset.word = String(i);
          latin.textContent = unit.羅馬拼音;
          if (romaji.childNodes.length > 0) romaji.append(' ');
          romaji.append(latin);
        });
      } else if ('segments' in display) appendSegments(ja, display.segments);
      else ja.append(line.原文);
      // 對不上：原文＋整句讀音
      if ('fallback' in display) ja.append(textDiv('tip-guess', display.fallback));
      if (showRomaji) {
        if (!units) romaji.textContent = line.羅馬拼音!;
        parts.push(romaji);
      }
      // 譯文：閱讀直接顯示；學習藏在「譯」區塊後面，除非開了「學習模式直接顯示譯文」。沒有譯文就都不放
      const hideTranslation = hidesTranslation(pageMode, displaySettings);
      if (line.譯文) parts.push(hideTranslation ? revealChip(line.譯文) : textDiv('tip-zh', line.譯文));
    }
    tip.classList.toggle('learn', pageMode === 'learn');
    tip.replaceChildren(...parts);
    tip.classList.add('on');
    placeTooltip(layer, line);
  }

  /** 分段的原文接到 parent 後面：漢字段包成 <ruby>。 */
  function appendSegments(parent: HTMLElement, segments: readonly RubySegment[]): void {
    for (const segment of segments) {
      if (segment.rt === undefined) parent.append(segment.text);
      else {
        const ruby = document.createElement('ruby');
        const rt = document.createElement('rt');
        rt.textContent = segment.rt;
        ruby.append(segment.text, rt);
        parent.append(ruby);
      }
    }
  }

  /** 滑鼠在 tooltip 的哪個詞上（#330）：原文與羅馬拼音 data-word 一樣的一起亮；不在詞上（或沒有 pointer）就都熄。 */
  function setHoveredWord(tip: HTMLElement, pointer: Point | undefined): void {
    const words = [...tip.querySelectorAll<HTMLElement>('[data-word]')];
    const index = pointer && words.find((w) => within(w.getBoundingClientRect(), pointer.x, pointer.y))?.dataset.word;
    for (const w of words) w.classList.toggle('on', w.dataset.word === index);
  }

  /**
   * 滑鼠移進 tooltip 時 tooltip 留著：學習時要移進「譯」區塊；tooltip 裡有按詞的羅馬拼音時（#330）要 hover 得到那些詞，
   * 閱讀時也一樣。其他時候閱讀模式照舊，滑出那句就收起。
   */
  const keepsTooltip = (tip: HTMLElement) => tip.classList.contains('on') && (pageMode === 'learn' || tip.querySelector('[data-word]') !== null);

  /**
   * 「譯」區塊（RevealChip 深色版）：翻譯圖示＋提示與譯文疊在同一格。譯文一開始就排進版面（藏著），
   * 所以揭露前後區塊一樣大，tooltip 不必重新定位；揭露只切換 class，交給 CSS 淡入淡出。
   */
  function revealChip(譯文: string): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'tip-reveal';
    const zh = textDiv('tip-reveal-zh', 譯文);
    zh.lang = 'zh-Hant';
    const body = document.createElement('div');
    body.className = 'tip-reveal-body';
    body.append(zh, textDiv('tip-reveal-hint', REVEAL_HINT));
    chip.append(translateIcon(), body);
    return chip;
  }

  function setRevealed(next: boolean): void {
    const chip = hovered?.layer.tip.querySelector('.tip-reveal');
    if (!hovered || !chip || next === revealed) return;
    revealed = next;
    chip.classList.toggle('on', revealed);
  }

  /** 置中在那句的框下方，夾在 Page 內；下方放不下就放上方。 */
  function placeTooltip(layer: PageLayer, line: HoverLine): void {
    const { tip } = layer;
    const { box } = line;
    const left = box.x + box.w / 2 - tip.offsetWidth / 2;
    tip.style.left = `${Math.max(0, Math.min(left, layer.size.width - tip.offsetWidth))}px`;
    const below = box.y + box.h;
    const above = below + tip.offsetHeight > layer.size.height;
    tip.style.top = `${above ? Math.max(0, box.y - tip.offsetHeight) : below}px`;
  }

  /** 每個 Page 層最多一個高亮框：頁面 hover 優先，其次是 side panel 滑過的那句。 */
  function renderHighlights(): void {
    for (const entry of entries.values()) {
      for (const layer of entry.layers.values()) {
        const line =
          hovered?.layer === layer
            ? hovered.line
            : panelHighlight?.pageHash === layer.pageHash
              ? layer.lines.find((l) => l.id === panelHighlight!.lineId)
              : undefined;
        layer.highlight.classList.toggle('on', line !== undefined);
        if (line) setBox(layer.highlight, line.box);
        const badged = line !== undefined && hoverAid({ pageMode, panelOpen }).orderBadge;
        layer.orderBadge.classList.toggle('on', badged);
        if (badged) {
          layer.orderBadge.textContent = String(line.order);
          Object.assign(layer.orderBadge.style, { left: `${line.box.x}px`, top: `${line.box.y}px` });
        }
      }
    }
  }

  /** side panel 滑過那行 → 頁面上那句高亮；null＝取消。 */
  function highlight(line: LineRef | null): void {
    panelHighlight = line ?? undefined;
    renderHighlights();
  }
  /** 這個分頁的側邊欄開了或關了（U10）：顯示中的 tooltip 與編號跟著換。 */
  function setPanelOpen(open: boolean): void {
    if (open === panelOpen) return;
    trace('overlay:panelOpen', { panelOpen: open });
    panelOpen = open;
    if (hovered) showTooltip(hovered.layer, hovered.line);
    renderHighlights();
  }

  /** Page Mode：學習時藏起擦字＋譯文（用 visibility，藏著時仍能量測排版）；顯示中的 tooltip 換成新模式的內容。 */
  function setPageMode(mode: PageMode): void {
    if (mode === pageMode) return;
    trace('overlay:pageMode', { pageMode: mode });
    pageMode = mode;
    for (const entry of entries.values()) {
      entry.host.dataset.pageMode = mode;
      // 學習時不等截圖確認（見 applyVisibility）；切回翻譯時沒有等著的確認，不能一直藏著
      delete entry.host.dataset.unverified;
    }
    if (hovered) showTooltip(hovered.layer, hovered.line);
  }

  /** ⚙ 的顯示設定（學習模式直接顯示譯文、羅馬拼音）：只影響 tooltip；顯示中的 tooltip 換成新內容。 */
  function setDisplaySettings(settings: DisplaySettings): void {
    displaySettings = settings;
    if (hovered) showTooltip(hovered.layer, hovered.line);
  }

  /**
   * 截圖前：隱藏 host（學習時也藏，tooltip 與高亮框不能進截圖），等兩個 rAF（確定已重繪）。
   * keep 裡的 anchor（長 Page，spec #142）的擦除與譯文不藏：截圖裡跟已收 Line 重疊的框本來就會丟掉，藏了反而每次捲動停下
   * 都閃回日文。它的 tooltip 與高亮框照樣藏：它們不在已收 Line 的框裡，會被偵測成新的字、弄髒橫條指紋。
   */
  async function hideForCapture(keep: ReadonlySet<Element> = new Set()): Promise<void> {
    capturing = true;
    keptDuringCapture = keep;
    entries.forEach(applyVisibility);
    const kept = [...entries.values()].filter((entry) => keep.has(entry.anchor));
    for (const entry of kept) entry.host.dataset.capturing = '';
    const hidesHost = [...entries.keys()].some((anchor) => !keep.has(anchor));
    const hidesHover = kept.some((entry) => [...entry.layers.values()].some((l) => l.tip.classList.contains('on') || l.highlight.classList.contains('on')));
    if (!hidesHost && !hidesHover) return;
    // 只藏了 tooltip／高亮框不算「覆蓋層被藏」
    if (hidesHost) hiddenAt = performance.now();
    await untilRepainted();
  }

  /** 截圖前藏起 Page 上的外圈（不管覆蓋層藏不藏）。 */
  function hideOutlinesForCapture(): void {
    outlinesHidden = true;
    for (const entry of entries.values()) entry.host.dataset.outlinesHidden = '';
  }

  /** 截完立刻還原；回傳覆蓋層被藏了多久（ms），沒藏就是 undefined。 */
  function restoreAfterCapture(): number | undefined {
    capturing = false;
    outlinesHidden = false;
    keptDuringCapture = new Set();
    for (const entry of entries.values()) {
      delete entry.host.dataset.capturing;
      delete entry.host.dataset.outlinesHidden;
    }
    entries.forEach(applyVisibility);
    const ms = hiddenAt === undefined ? undefined : performance.now() - hiddenAt;
    hiddenAt = undefined;
    return ms;
  }

  /** 這個 anchor 上正顯示著覆蓋層的 Page（pageHash）；學習（頁面上沒蓋任何東西）或 host 不在畫面上就是空的。 */
  function shownPages(anchor: Element): string[] {
    const entry = entries.get(anchor as HTMLElement);
    if (!entry || pageMode === 'learn' || stopped || !entry.host.isConnected) return [];
    return [...entry.layers.values()].map((layer) => layer.pageHash);
  }

  /** 這個 anchor 上會出現在截圖裡的擦除與譯文（畫面 CSS px）；學習時它們藏著，是空的。長 Page 算橫條指紋時避開。 */
  function coveredRects(anchor: Element): Rect[] {
    const entry = entries.get(anchor as HTMLElement);
    if (!entry || pageMode === 'learn' || stopped || !entry.host.isConnected) return [];
    return [...entry.root.querySelectorAll('.er, .tx')].map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    });
  }

  /** 停止：拿掉所有 host、還原被改成 relative 的父元素。 */
  function clear(): void {
    stopped = true;
    mutationObserver.disconnect();
    resizeObserver.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('pointermove', onPointerMove, { capture: true });
    clearTimeout(dwellTimer);
    hovered = undefined;
    panelHighlight = undefined;
    for (const entry of entries.values()) {
      for (const key of [...(entry.outlines?.items.keys() ?? [])]) dropOutline(entry, key);
      entry.host.remove();
    }
    entries.clear();
    for (const [parent, position] of changedParents) parent.style.position = position;
    changedParents.clear();
  }

  /** 這個元素的 style 被我們改過（static → relative）。 */
  function ownsStyleOf(element: Element): boolean {
    return changedParents.has(element as HTMLElement);
  }

  return { show, remove, confirm, highlight, setPageMode, setDisplaySettings, setPanelOpen, setOutlines, hideForCapture, hideOutlinesForCapture, restoreAfterCapture, shownPages, coveredRects, clear, ownsStyleOf };
}

export type Overlay = ReturnType<typeof createOverlay>;
