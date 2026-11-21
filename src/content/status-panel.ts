/**
 * 全站狀態（#185）：視窗右上角只有一個面板，內容是 SW 算好的 StatusPanel（shared/page-status.ts）。
 *
 * 放在 top layer（popover="manual"）：網站 hover 時浮出來的標題列、控制列 z-index 再高也蓋不到它。
 * 平常收合成一行（轉圈圈＋「2 頁處理中」＋正在處理那頁的位置圖示），滑過展開成每頁一列；有要讀者處理的就一直展開。
 * 截圖時藏起來（字不能進 OCR、也不能改變 Page hash）；沒在忙也沒出問題就淡出。
 *
 * host 帶 STATUS_HOST_ATTRIBUTE（不是覆蓋層的 HOST_ATTRIBUTE，數覆蓋層時不算它）；翻頁偵測、遮擋物也把它當成自己的。
 */
import type { PageIcon, StatusAction, StatusPanel, StatusRow } from '../shared/page-status.ts';
import TOKENS from '../shared/tokens.css';

/** 給 e2e 與翻頁偵測用：全站狀態的 shadow host 的屬性。 */
export const STATUS_HOST_ATTRIBUTE = 'data-naruhodo-status';

/** 面板上的點擊、按壓不讓網站收到（點畫面翻頁的閱讀器）。 */
const SWALLOWED = ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu'] as const;

/** 收起時淡出花這麼久（ms）。 */
const FADE_MS = 200;

const STYLE = `${TOKENS}
:host { all: initial; }
.panel { display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; padding: 5px 12px; border-radius: var(--naru-radius-pill);
  background: var(--naru-tooltip-bg); color: var(--naru-tooltip-ink); box-shadow: var(--naru-shadow-2);
  font: 500 12px/1.4 var(--naru-font-sans); transition: opacity ${FADE_MS}ms; }
.panel.leaving { opacity: 0; }
.panel.open, .panel:hover { width: 250px; padding: 6px; border-radius: var(--naru-radius-md); }
.head { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.panel.open .head, .panel:hover .head { padding: 4px 8px 6px; }
.panel.open .cur, .panel:hover .cur { display: none; }
.bar { height: 4px; margin: 0 8px 6px; border-radius: var(--naru-radius-pill); background: var(--naru-tooltip-chip-on-line); overflow: hidden; }
.bar > div { height: 100%; background: var(--naru-tooltip-ink); }
.list { display: none; flex-direction: column; gap: 2px; }
.panel.open .list, .panel:hover .list { display: flex; }
.row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--naru-radius-sm); }
.row.now { background: var(--naru-tooltip-chip-bg); }
.row.bad { background: var(--naru-tooltip-danger-bg); }
.rc { display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0; }
.rt { font-weight: 700; }
.rs { display: flex; align-items: center; gap: 5px; color: var(--naru-tooltip-ink-2); }
.rs.dim, .more { color: var(--naru-tooltip-ink-3); }
.rs.err { color: var(--naru-tooltip-ruby); }
.ok { color: var(--naru-tooltip-ok); }
.more { padding: 4px 8px; }
.spin { width: 10px; height: 10px; flex-shrink: 0; box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent;
  border-radius: 50%; animation: naru-rot 0.8s linear infinite; }
@keyframes naru-rot { to { transform: rotate(360deg); } }
.ex { width: 16px; height: 16px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%;
  background: var(--naru-tooltip-ruby); color: var(--naru-tooltip-bg); font-size: 11px; font-weight: 800; }
.pi { display: inline-flex; flex-shrink: 0; align-items: center; gap: 2px; }
.pi i { display: block; width: 9px; height: 13px; border-radius: 1.5px; background: var(--naru-tooltip-chip-on-line); }
.pi i.on { background: var(--naru-tooltip-ink); }
.pi i.tall { width: 8px; height: 18px; }
.pnum { min-width: 14px; height: 18px; padding: 0 3px; box-sizing: border-box; flex-shrink: 0; display: grid; place-items: center; border-radius: 2px;
  background: var(--naru-tooltip-ink); color: var(--naru-tooltip-bg); font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
.act { flex-shrink: 0; margin: 0; padding: 4px 10px; border: 0; border-radius: var(--naru-radius-sm); cursor: pointer;
  background: var(--naru-tooltip-ink); color: var(--naru-ink); font: inherit; font-weight: 700; }
.act:hover { filter: brightness(0.9); }
.act:focus-visible { outline: 2px solid var(--naru-tooltip-ink); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; border-right-color: currentColor; opacity: 0.6; } }
`;

/** 紅色那一列的按鈕被點了。 */
export type OnStatusAction = (action: StatusAction, pageHash: string) => void;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const spinner = () => el('span', 'spin');

/** 位置圖示：亮的那格是這一頁。純裝飾，旁邊的字已經說了是哪頁。 */
function icon(page: PageIcon): HTMLElement {
  const box = page.kind === 'number' ? el('span', 'pnum', String(page.n)) : el('span', 'pi');
  if (page.kind !== 'number') {
    // Spread 是左右兩格（照畫面位置），其他是一格
    const cells = page.kind === 'spread' ? [page.side === 'left', page.side === 'right'] : [true];
    for (const on of cells) box.append(el('i', [on && 'on', page.kind === 'strip' && 'tall'].filter(Boolean).join(' ')));
  }
  box.setAttribute('aria-hidden', 'true');
  return box;
}

export function createStatusPanel({ onAction }: { onAction: OnStatusAction }) {
  let host: HTMLElement | undefined;
  let panelElement: HTMLElement | undefined;
  let fade: ReturnType<typeof setTimeout> | undefined;
  let capturing = false;

  function button(label: string, action: StatusAction, pageHash: string): HTMLButtonElement {
    const element = el('button', 'act', label);
    element.type = 'button';
    element.addEventListener('click', (event) => {
      // 不讓網站收到這次點擊（點畫面翻頁的閱讀器）
      event.stopPropagation();
      event.preventDefault();
      onAction(action, pageHash);
    });
    return element;
  }

  function rowElement({ pageHash, icon: rowIcon, title, state }: StatusRow): HTMLElement {
    const row = el('div', `row${state.kind === 'working' ? ' now' : state.kind === 'failed' ? ' bad' : ''}`);
    const content = el('div', 'rc');
    const line = el('span', 'rs');
    if (state.kind === 'working') line.append(spinner(), state.text);
    else if (state.kind === 'queued') {
      line.classList.add('dim');
      line.textContent = '排隊中';
    } else if (state.kind === 'done') line.append(el('span', 'ok', '✓'), '翻好了');
    else {
      line.classList.add('err');
      line.textContent = '翻譯失敗';
    }
    content.append(el('span', 'rt', title), line);
    row.append(icon(rowIcon), content);
    if (state.kind === 'failed') row.append(button('重試', 'retry', pageHash));
    return row;
  }

  function render(panel: StatusPanel): HTMLElement {
    const root = el('div', `panel${panel.expanded ? ' open' : ''}`);
    for (const type of SWALLOWED) root.addEventListener(type, (event) => event.stopPropagation());
    const head = el('div', 'head');
    if (panel.header.kind === 'working') head.append(spinner());
    else head.append(el('span', 'ex', '!'));
    head.append(panel.header.text);
    if (panel.current) {
      const current = icon(panel.current);
      current.classList.add('cur');
      head.append(current);
    }
    root.append(head);
    if (panel.header.kind === 'working' && panel.header.progress !== undefined) {
      const bar = el('div', 'bar');
      const fill = el('div');
      fill.style.width = `${Math.round(panel.header.progress * 100)}%`;
      bar.append(fill);
      root.append(bar);
    }
    const list = el('div', 'list');
    for (const problem of panel.problems) {
      const row = el('div', 'row bad');
      const content = el('div', 'rc');
      content.append(el('span', 'rt', problem.title), el('span', 'rs err', problem.detail));
      row.append(el('span', 'ex', '!'), content, button(problem.label, problem.action, problem.pageHash));
      list.append(row);
    }
    for (const row of panel.rows) list.append(rowElement(row));
    if (panel.more > 0) list.append(el('div', 'more', `還有 ${panel.more} 頁`));
    root.append(list);
    return root;
  }

  /** 回傳放面板的地方（讀螢幕的人聽得到狀態變化的 live region）。 */
  function ensureHost(): HTMLElement {
    const existing = host?.isConnected ? host.shadowRoot?.querySelector<HTMLElement>('[role=status]') : undefined;
    if (existing) return existing;
    // 網站把它拿掉了（整個換掉 body 之類）：重建，舊的內容跟著舊的 shadow root 丟掉
    host?.remove();
    panelElement = undefined;
    const created = document.createElement('div');
    created.setAttribute(STATUS_HOST_ATTRIBUTE, '');
    created.popover = 'manual';
    // 蓋掉 popover 預設的置中、邊框與底色：固定在視窗右上角
    Object.assign(created.style, {
      position: 'fixed',
      inset: '12px 16px auto auto',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      overflow: 'visible',
      width: 'auto',
      height: 'auto',
      visibility: capturing ? 'hidden' : 'visible',
    });
    const root = created.attachShadow({ mode: 'open' });
    const live = el('div');
    live.setAttribute('role', 'status');
    const style = el('style');
    style.textContent = STYLE;
    root.append(style, live);
    document.documentElement.append(created);
    host = created;
    return live;
  }

  /**
   * 放到 top layer 的最上面：網站之後才放進 top layer 的（全螢幕的閱讀器、自己的 popover、dialog）會疊在先放的上面，
   * 所以每次更新、切換全螢幕都重放一次（同一個 task 裡關了再開，不會閃）。
   */
  function raise(): void {
    if (!host?.isConnected) return;
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  }
  document.addEventListener('fullscreenchange', raise);

  function remove(): void {
    clearTimeout(fade);
    fade = undefined;
    host?.remove();
    host = undefined;
    panelElement = undefined;
  }

  return {
    /** 換成 SW 送來的內容；undefined＝淡出收起。 */
    set(panel: StatusPanel | undefined): void {
      if (!panel) {
        if (!panelElement || fade) return;
        panelElement.classList.add('leaving');
        fade = setTimeout(remove, FADE_MS);
        return;
      }
      clearTimeout(fade);
      fade = undefined;
      const live = ensureHost();
      const next = render(panel);
      // 換內容時保留 hover 展開的樣子（:hover 跟著同一個位置的新元素）
      if (panelElement) panelElement.replaceWith(next);
      else live.append(next);
      panelElement = next;
      raise();
    },
    /** 截圖前藏起來（不管覆蓋層藏不藏）。 */
    hideForCapture(): void {
      capturing = true;
      if (host) host.style.visibility = 'hidden';
    },
    restoreAfterCapture(): void {
      capturing = false;
      if (host) host.style.visibility = 'visible';
    },
    stop(): void {
      document.removeEventListener('fullscreenchange', raise);
      remove();
    },
  };
}

export type StatusPanelView = ReturnType<typeof createStatusPanel>;
