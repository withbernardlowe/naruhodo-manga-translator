/**
 * side panel 的逐字稿（spec #27 第 8 節、#39、#70／#76）：依閱讀順序一行一句，上方「逐字稿」標題列的選單切換 Display Level，
 * 振り仮名用 rubyDisplay（alignRuby）對齊回每段漢字，頁面 ↔ panel 的 hover 同步。
 * 原文標 lang="ja"、譯文標 lang="zh-Hant"：字型跟著語言走，測試也靠它找元素。
 */
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { unreadableLabel, type PageText } from '../shared/page-text.ts';
import { rubyDisplay, type RubyDisplay } from '../shared/ruby.ts';
import { displaySummary, LEVEL_LABELS, LEVELS, type Display, type DisplayLevel, type LineDisplay } from '../shared/transcript-display.ts';
import { Badge, RevealChip, SegmentedControl, Switch } from './components.tsx';
import { transcriptRows } from './transcript-rows.ts';

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
      <span class="transcript-head__label">逐字稿</span>
      <span class="transcript-head__spacer" />
      <button
        ref={button}
        type="button"
        class="naru-btn transcript-head__menu"
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
  /** 每句顯示哪些部分（shared/transcript-display.ts 的 lineDisplay）。 */
  show: LineDisplay;
  /** 頁面上滑鼠所在的那句（高亮並捲過去）。 */
  hoveredId: string | undefined;
  /** 滑過這行（null＝離開）→ 頁面上那句高亮。 */
  onHover: (lineId: string | null) => void;
}

/**
 * 逐字稿：Balloon 與 Loose Text 依閱讀順序混在同一串；Loose Text 標「框外文字」。
 * 框外文字裡無法辨識的段收到這頁最後的收合列（U17，規則在 transcript-rows.ts）；每頁從收起開始。
 * 編號直接顯示閱讀順序（order），行被收走也不會重編，跟頁面上的編號一致（U10）。
 */
export function Transcript({ text, translated, show, hoveredId, onHover }: TranscriptProps) {
  const { ruby: showRuby, translationOnly, hideTranslation } = show;
  const [expanded, setExpanded] = useState(false);
  const foldedId = useId();
  const lines = [...text.balloons.map((b) => ({ ...b, loose: false })), ...text.looseText.map((l) => ({ ...l, loose: true }))];
  const rows = transcriptRows(lines, { translated, expanded, hoveredId });
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hoveredId === undefined) return;
    root.current?.querySelector('li.hl')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoveredId]);

  const renderLine = (line: (typeof lines)[number]) => {
    const unreadable = translated && line.unreadable;
    const hasTranslation = translated && line.譯文 !== '';
    const showOriginal = unreadable || !translationOnly || !hasTranslation;
    // 要畫ルビ的句子才對齊讀音（讀音全是 LLM 推測，不另外標示）
    const ruby = showRuby && !unreadable ? rubyDisplay(line.原文, line.讀音) : undefined;
    // 框外的雜訊：灰、刪除線；Balloon 讀不出來：原文不劃掉，警告色標籤，看起來跟雜訊不一樣（U17）
    const originalClass = unreadable ? (line.loose ? 'original unreadable' : 'original unreadable-balloon') : ruby ? 'original with-ruby' : 'original';
    const shownTranslation = (
      <span lang="zh-Hant" class="translation">
        {line.譯文}
      </span>
    );
    return (
      <li
        key={line.id}
        data-order={line.order}
        class={line.id === hoveredId ? 'hl' : undefined}
        onMouseEnter={() => onHover(line.id)}
        onMouseLeave={() => onHover(null)}
      >
        {showOriginal && (
          <span lang="ja" class={originalClass}>
            {ruby ? <Ruby ja={line.原文} display={ruby} /> : line.原文}
          </span>
        )}
        {showOriginal && show.romaji && !unreadable && line.羅馬拼音 && (
          <span lang="ja-Latn" class="romaji">
            {line.羅馬拼音}
          </span>
        )}
        {line.loose && !unreadable && (
          <span class="badges">
            <Badge tone="loose">框外文字</Badge>
          </span>
        )}
        {unreadable && <span class={line.loose ? 'unreadable-label' : 'unreadable-label unreadable-label--balloon'}>{unreadableLabel(line.loose)}</span>}
        {!unreadable &&
          (hasTranslation ? (
            hideTranslation ? <RevealChip>{shownTranslation}</RevealChip> : shownTranslation
          ) : (
            <span class="untranslated">未翻譯</span>
          ))}
      </li>
    );
  };

  return (
    <div class="transcript" ref={root}>
      <ol aria-label="逐字稿">{rows.inline.map(renderLine)}</ol>
      {rows.folded.length > 0 && (
        <div class={rows.revealed.length > 0 ? 'transcript-fold open' : 'transcript-fold'}>
          <button
            type="button"
            class={rows.folded.some((l) => l.id === hoveredId) ? 'transcript-fold__toggle hl' : 'transcript-fold__toggle'}
            aria-expanded={expanded}
            aria-controls={foldedId}
            onClick={() => setExpanded(!expanded)}
          >
            <FoldIcon expanded={expanded} />
            <span>
              {expanded ? '' : '另有 '}
              <b>{rows.folded.length} 段</b>框外文字無法辨識
            </span>
            <span class="transcript-fold__orders">{expanded ? '收起' : rows.folded.map((l) => l.order).join('・')}</span>
          </button>
          <ol id={foldedId} aria-label="無法辨識的框外文字">
            {rows.revealed.map(renderLine)}
          </ol>
          {expanded && <p class="transcript-fold__hint">這裡面有該翻的字？可以用最下面的「回報翻譯問題」告訴我們。</p>}
        </div>
      )}
    </div>
  );
}

function FoldIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={expanded ? 'M2.5 4 L6 7.5 L9.5 4' : 'M4 2.5 L7.5 6 L4 9.5'} />
    </svg>
  );
}
