/**
 * ⚙「閱讀與顯示」的兩個開關：學習模式直接顯示譯文、讀音加上羅馬拼音（shared/display-settings.ts）。
 * 只管畫與回報，不讀寫 chrome.storage：外掛的設定頁與側邊欄（settings-sections.tsx）存進 storage，
 * 產品網站的展示（site/src/demo）只放在記憶體裡。
 */
import type { DisplaySettings } from '../shared/display-settings.ts';
import { Switch } from './components.tsx';

export function DisplaySwitches({ settings, onChange }: { settings: DisplaySettings; onChange: (next: DisplaySettings) => void }) {
  return (
    <>
      <Switch
        label="學習模式直接顯示譯文"
        description="學習模式下，tooltip 與逐字稿的譯文不用先把游標移到譯文區塊上就看得到。漫畫頁面一樣只留日文原文。"
        checked={settings.learnShowsTranslation}
        onChange={(checked) => onChange({ ...settings, learnShowsTranslation: checked })}
      />
      <Switch
        label="讀音加上羅馬拼音"
        description="有顯示讀音的地方，原文下面多一行羅馬拼音，例如 kinō wa rāmen o tabemashita。"
        checked={settings.romaji}
        onChange={(checked) => onChange({ ...settings, romaji: checked })}
      />
    </>
  );
}
