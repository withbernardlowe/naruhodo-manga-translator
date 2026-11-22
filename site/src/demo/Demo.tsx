/// <reference types="vite/client" />
/**
 * 首頁的互動展示（#109）：假的 Chrome 視窗裡放 Practice Spread 的右頁，點工具列的 Naruhodo 圖示後 side panel 滑出來，再點一次就收回去（跟外掛一樣是開關）。
 * side panel 是外掛的 SidePanel（render 在 shadow root 裡，樣式跟外掛同一份），頁面上的譯文與 tooltip 是外掛的
 * createOverlay（翻譯中的光帶、譯文、tooltip 都是它畫的）；這裡只負責假外框與「辨識中 → 翻譯中 → 完成」的計時（demo-state.ts），
 * 資料是事先錄好的 demo-page.json。
 * 外掛介面只有繁體中文，所以展示裡面維持中文；只有外框上的提示（copy）跟著網站語言。
 */
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createOverlay, type Overlay } from '../../../src/content/overlay.ts';
import logoSrc from '../../../src/icons/naruhodo-small.svg?url';
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from '../../../src/shared/display-settings.ts';
import type { LineRef } from '../../../src/shared/messages.ts';
import { translatingLines } from '../../../src/shared/page-outlines.ts';
import type { PageMode } from '../../../src/shared/page-mode.ts';
import { DEFAULT_TRANSCRIPT_DISPLAY, type TranscriptDisplay } from '../../../src/shared/transcript-display.ts';
import TOKENS from '../../../src/shared/tokens.css';
import COMPONENTS from '../../../src/ui/components.css';
import SETTINGS from '../../../src/ui/settings.css';
import SIDE_PANEL from '../../../src/ui/side-panel.css';
import { DisplaySwitches } from '../../../src/ui/display-switches.tsx';
import { SidePanel } from '../../../src/ui/index.ts';
import { SETTINGS_CATEGORIES } from '../../../src/ui/settings-route.ts';
import spreadSrc from '../../../practice-spread/practice-spread.webp?url';
import { demoPages } from './demo-page.ts';
import { clickIcon, demoView, nextPhase, type DemoPhase } from './demo-state.ts';

/**
 * shadow root 裡的樣式：host 不繼承網站的字型與顏色（all: initial），side panel 的 tokens 與元件樣式跟外掛同一份。
 * host 本身是 side panel 的捲動區（外掛裡是整個 side panel 視窗）。
 */
const PANEL_STYLE = `${TOKENS}${COMPONENTS}${SIDE_PANEL}${SETTINGS}
:host { all: initial; display: block; overflow-y: auto; background: var(--naru-surface); }`;

/**
 * 展示一開始就打開 ⚙ 的「讀音加上羅馬拼音」：讀音下面多一行羅馬拼音，滑過日文或羅馬拼音的詞兩邊一起亮（#330）。
 * 外掛預設關著，展示要讓人看到這個功能，所以開著；⚙ 可以關掉（只存在記憶體裡）。
 */
const DEMO_DISPLAY_SETTINGS: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS, romaji: true };

const DISPLAY_CATEGORY = SETTINGS_CATEGORIES.find(({ id }) => id === 'display')!.label;

/**
 * 側邊欄 ⚙ 的設定頁，只有「閱讀與顯示」的兩個開關：翻譯方式、帳號、匯出匯入在展示裡沒有意義。
 * 版面跟外掛的 PanelSettings（settings-sections.tsx）一樣。
 */
function DemoSettings({ settings, onChange }: { settings: DisplaySettings; onChange: (next: DisplaySettings) => void }) {
  return (
    <section aria-label="設定" class="naru-settings naru-settings--panel">
      <section aria-label={DISPLAY_CATEGORY} class="naru-settings__category">
        <h2 class="naru-settings__category-title">{DISPLAY_CATEGORY}</h2>
        <div class="naru-settings__switches">
          <DisplaySwitches settings={settings} onChange={onChange} />
        </div>
      </section>
    </section>
  );
}

const noop = () => {};

export interface DemoCopy {
  /** 圖示旁的提示 */
  hint: string;
}

export function Demo({ copy }: { copy: DemoCopy }) {
  const [phase, setPhase] = useState<DemoPhase>('closed');
  const [pageMode, setPageMode] = useState<PageMode>('read');
  const [transcriptDisplay, setTranscriptDisplay] = useState<TranscriptDisplay>(DEFAULT_TRANSCRIPT_DISPLAY);
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(DEMO_DISPLAY_SETTINGS);
  const [hovered, setHovered] = useState<LineRef | undefined>(undefined);
  const image = useRef<HTMLImageElement>(null);
  const panelHost = useRef<HTMLDivElement>(null);
  const panelMount = useRef<HTMLElement>(undefined);
  const overlay = useRef<Overlay>(undefined);
  const view = demoView(phase, demoPages);

  // 辨識中 → 翻譯中 → 完成
  useEffect(() => {
    const step = nextPhase(phase);
    if (!step) return;
    const timer = setTimeout(() => setPhase(step.phase), step.afterMs);
    return () => clearTimeout(timer);
  }, [phase]);

  // 啟動就建覆蓋層（翻譯中的光帶也畫在上面）；停止（再點一次圖示或按「停止」）就整個拿掉
  useEffect(() => {
    if (!view.running) return;
    const created = createOverlay({ onHover: (line) => setHovered(line ?? undefined) });
    created.setPageMode(pageMode);
    created.setDisplaySettings(displaySettings);
    // 展示裡覆蓋層存在時 side panel 一定開著：閱讀模式 hover 跟外掛一樣是編號、不出 tooltip（hover-aid.ts）
    created.setPanelOpen(view.panelOpen);
    overlay.current = created;
    return () => {
      created.clear();
      overlay.current = undefined;
      setHovered(undefined);
    };
    // pageMode、displaySettings 由下面的 effect 同步，不重建覆蓋層
  }, [view.running]);

  // 翻譯中：每一句照閱讀順序有光帶掃過；圖是整張跨頁，跟外掛一樣用 sub 只蓋右半張
  useEffect(() => {
    const img = image.current;
    if (!view.washing || !img) return;
    overlay.current?.setOutlines(demoPages.map((page) => ({ anchor: img, sub: page.sub, translating: translatingLines(page.text), waiting: [] })));
  }, [view.running, view.washing]);

  // 翻完蓋上譯文：光帶同時收起、譯文淡入（overlay.show）
  useEffect(() => {
    const img = image.current;
    const current = overlay.current;
    if (!view.overlay || !img || !current) return;
    void img.decode().then(() => Promise.all(demoPages.map((page) => current.show(img, page.sub, page.text, page.pageHash))));
  }, [view.running, view.overlay]);

  useEffect(() => overlay.current?.setPageMode(pageMode), [pageMode]);
  useEffect(() => overlay.current?.setDisplaySettings(displaySettings), [displaySettings]);

  // SidePanel render 在 shadow root 裡：網站的樣式進不去，side panel 的樣式也不會漏出來
  useEffect(() => {
    const host = panelHost.current!;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_STYLE;
    const mount = document.createElement('div');
    root.replaceChildren(style, mount);
    panelMount.current = mount;
    return () => render(null, mount);
  }, []);

  useEffect(() => {
    const mount = panelMount.current;
    if (!mount) return;
    if (!view.panelOpen) {
      render(null, mount);
      return;
    }
    render(
      <SidePanel
        running={view.running}
        pages={view.pages}
        modelStatus={{ state: 'idle' }}
        access={{ mode: 'hosted', signedIn: true }}
        consent="agreed"
        pageMode={pageMode}
        hovered={hovered}
        logoSrc={logoSrc}
        onPageModeChange={setPageMode}
        displaySettings={displaySettings}
        transcriptDisplay={transcriptDisplay}
        onTranscriptDisplayChange={setTranscriptDisplay}
        onScan={noop}
        onTranslate={noop}
        onRetranslate={noop}
        onStop={() => setPhase('closed')}
        onLineHover={(line) => overlay.current?.highlight(line)}
        onAcceptConsent={noop}
        onUseOwnKey={noop}
        onSignIn={noop}
        quota={{ plan: 'free', remaining: view.remaining }}
        renderSettings={() => <DemoSettings settings={displaySettings} onChange={setDisplaySettings} />}
      />,
      mount,
    );
  });

  return (
    <div class={`demo-chrome${view.panelOpen ? ' is-open' : ''}`}>
      <div class="demo-chrome__tabs" aria-hidden="true">
        <span class="demo-chrome__dots">
          <i />
          <i />
          <i />
        </span>
        <span class="demo-chrome__tab">
          <span class="demo-chrome__favicon" />
          第12話 ｜ Sample Manga
        </span>
      </div>
      <div class="demo-chrome__bar">
        <span class="demo-chrome__nav" aria-hidden="true">
          ← → ↻
        </span>
        <span class="demo-chrome__url">manga.example.com/sample-series/chapter-12</span>
        <button
          type="button"
          class={`demo-chrome__ext${view.running ? '' : ' is-pulsing'}`}
          aria-label="Naruhodo"
          aria-pressed={view.running}
          onClick={() => setPhase(clickIcon)}
        >
          <img src={logoSrc} alt="" width={20} height={20} />
          {!view.running && <span class="demo-chrome__hint">{copy.hint}</span>}
        </button>
      </div>
      <div class="demo-chrome__body">
        <div class="demo-chrome__page">
          <div class="demo-chrome__manga">
            <img ref={image} src={spreadSrc} width={2000} height={1342} alt="" />
          </div>
        </div>
        <div class="demo-chrome__drawer">
          <div class="demo-chrome__panel" ref={panelHost} />
        </div>
      </div>
    </div>
  );
}
