/**
 * side panel 的逐字稿（spec #27 第 8 節、#39、#70／#76）：依閱讀順序一行一句，上方「逐字稿」標題列的選單切換 Display Level，
 * 振り仮名用 rubyDisplay（alignRuby）對齊回每段漢字，頁面 ↔ panel 的 hover 同步。
 * 原文標 lang="ja"、譯文標 lang="zh-Hant"：字型跟著語言走，測試也靠它找元素。
 */
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { PageText } from '../shared/page-text.ts';
import { rubyDisplay, type RubyDisplay } from '../shared/ruby.ts';
import { displaySummary, LEVEL_LABELS, LEVELS, type Display, type DisplayLevel } from '../shared/transcript-display.ts';
import { Badge, RevealChip, SegmentedControl, Switch } from './components.tsx';

/** 側邊欄的小圖示：跟「漫畫頁面」的頁面圖示成對，標出這一行管的是側邊欄（U15）。 */
function PanelIcon() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="0.75" y="0.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M9 1v10" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <path d="M2 3.5 L5 6.5 L8 3.5" />
    </svg>
  );
}

/**
 * 「逐字稿」標題列（U15）：右邊的選單按鈕寫著目前的顯示方式，打開後閱讀時是 Display Level、學習時是振り仮名 Switch。
 * 放在逐字稿正上方，位置本身說明它只管側邊欄；選單裡也明寫頁面不變。點選單外面或按 Escape 關上。
 */
export function TranscriptHeading({
  display,
  onLevel,
  onFurigana,
}: {
  display: Display;
  onLevel: (level: DisplayLevel) => void;
  onFurigana: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const noteId = useId();
  useEffect(() => {
    const el = root.current;
    if (!open || !el) return;
    // 可能 render 在網站的 shadow root 裡（產品網站的展示）：用 composedPath 判斷點的是不是選單
    const onPointer = (e: PointerEvent) => {
      if (!e.composedPath().includes(el)) setOpen(false);
    };
    const doc = el.ownerDocument;
    doc.addEventListener('pointerdown', onPointer);
    return () => doc.removeEventListener('pointerdown', onPointer);
  }, [open]);
  // Escape 只在按鈕與選單裡處理（focus 在它們身上時），不攔整頁的鍵盤
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open || e.key !== 'Escape') return;
    e.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };
  const summary = displaySummary(display);
  const chooseLevel = (level: DisplayLevel) => {
    onLevel(level);
    setOpen(false);
  };
  return (
    <div class="transcript-head" ref={root} onKeyDown={onKeyDown}>
      <PanelIcon />
      <span class="transcript-head__label">逐字稿</span>
      <span class="transcript-head__spacer" />
      <button
        ref={button}
        type="button"
        class="naru-btn naru-btn--secondary transcript-head__menu"
        aria-label={`逐字稿顯示：${summary}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        {summary}
        <ChevronIcon />
      </button>
      {open && (
        <div id={menuId} class="transcript-menu" role="group" aria-label="逐字稿顯示" aria-describedby={noteId}>
          <p id={noteId} class="transcript-menu__note">
            只改側邊欄的逐字稿，漫畫頁面不變
          </p>
          {display.mode === 'read' ? (
            <SegmentedControl
              label="顯示層級"
              options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] }))}
              value={display.level}
              onChange={chooseLevel}
            />
          ) : (
            <Switch label="顯示讀音" checked={display.furigana} onChange={onFurigana} />
          )}
        </div>
      )}
    </div>
  );
}

/** 原文＋ルビ；對不上時退回「原文＋下面一行整句讀音」。 */
function Ruby({ ja, display }: { ja: string; display: RubyDisplay }) {
  if ('fallback' in display)
    return (
      <>
        {ja}
        <small class="reading">{display.fallback}</small>
      </>
    );
  return (
    <>
      {display.segments.map((s, i) =>
        s.rt === undefined ? (
          s.text
        ) : (
          <ruby key={i}>
            {s.text}
            <rt>{s.rt}</rt>
          </ruby>
        ),
      )}
    </>
  );
}

export interface TranscriptProps {
  text: PageText;
  translated: boolean;
  display: Display;
  /** 頁面上滑鼠所在的那句（高亮並捲過去）。 */
  hoveredId: string | undefined;
  /** 滑過這行（null＝離開）→ 頁面上那句高亮。 */
  onHover: (lineId: string | null) => void;
}

/** 逐字稿：Balloon 與 Loose Text 依閱讀順序混在同一串；Loose Text 標「框外文字」。 */
export function Transcript({ text, translated, display, hoveredId, onHover }: TranscriptProps) {
  const learn = display.mode === 'learn';
  const showRuby = learn ? display.furigana : display.level === 'withReading';
  const translationOnly = !learn && display.level === 'translationOnly';
  const lines = [
    ...text.balloons.map((b) => ({ ...b, loose: false })),
    ...text.looseText.map((l) => ({ ...l, loose: true })),
  ].sort((a, b) => a.order - b.order);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (hoveredId === undefined) return;
    list.current?.querySelector('li.hl')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoveredId]);

  return (
    <ol aria-label="逐字稿" ref={list}>
      {lines.map((line) => {
        // unreadable：OCR 原文（灰、刪除線）＋「無法辨識 · 未覆蓋」，每個層級都一樣
        const unreadable = translated && line.unreadable;
        const hasTranslation = translated && line.譯文 !== '';
        const showOriginal = unreadable || !translationOnly || !hasTranslation;
        // 要畫ルビ的句子才對齊讀音（讀音全是 LLM 推測，不另外標示）
        const ruby = showRuby && !unreadable ? rubyDisplay(line.原文, line.讀音) : undefined;
        const shownTranslation = (
          <span lang="zh-Hant" class="translation">
            {line.譯文}
          </span>
        );
        return (
          <li
            key={line.id}
            class={line.id === hoveredId ? 'hl' : undefined}
            onMouseEnter={() => onHover(line.id)}
            onMouseLeave={() => onHover(null)}
          >
            {showOriginal && (
              <span lang="ja" class={unreadable ? 'original unreadable' : ruby ? 'original with-ruby' : 'original'}>
                {ruby ? <Ruby ja={line.原文} display={ruby} /> : line.原文}
              </span>
            )}
            {line.loose && (
              <span class="badges">
                <Badge tone="loose">框外文字</Badge>
              </span>
            )}
            {unreadable && <span class="unreadable-label">無法辨識 · 未覆蓋</span>}
            {!unreadable &&
              (hasTranslation ? (
                learn ? <RevealChip>{shownTranslation}</RevealChip> : shownTranslation
              ) : (
                <span class="untranslated">未翻譯</span>
              ))}
          </li>
        );
      })}
    </ol>
  );
}
