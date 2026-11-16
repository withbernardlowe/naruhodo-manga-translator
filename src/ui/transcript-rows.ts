/**
 * 逐字稿怎麼排（U17）：框外文字（Loose Text）裡無法辨識的段多半是招牌、墓碑、廣告字或被誤判的狀聲詞
 * （ADR 0009 的盤點：被擋下的框外文字多為設計字的亂碼），收到這頁最後一列；Balloon 幾乎都是對白，
 * 讀不出來時留在原位讓讀者看得到。
 */

export interface RowLine {
  id: string;
  /** 閱讀順序，也是側邊欄與頁面上顯示的編號。 */
  order: number;
  loose: boolean;
  unreadable: boolean;
}

export interface TranscriptRowsInput {
  /** 還沒翻好時 unreadable 還不算數（LLM 還沒回），全部照原位。 */
  translated: boolean;
  expanded: boolean;
  hoveredId: string | undefined;
}

export interface TranscriptRows<L> {
  /** 照閱讀順序留在原位的行。 */
  inline: L[];
  /** 收進頁尾收合列的行（照閱讀順序）。 */
  folded: L[];
  /** 收合列裡現在露出來的行：展開時全部；收起時只有頁面上滑鼠所在的那段（清單只多一行，不會被推走）。 */
  revealed: L[];
}

export function transcriptRows<L extends RowLine>(lines: readonly L[], { translated, expanded, hoveredId }: TranscriptRowsInput): TranscriptRows<L> {
  const sorted = [...lines].sort((a, b) => a.order - b.order);
  const isFolded = (l: L) => translated && l.loose && l.unreadable;
  const folded = sorted.filter(isFolded);
  return {
    inline: sorted.filter((l) => !isFolded(l)),
    folded,
    revealed: expanded ? folded : folded.filter((l) => l.id === hoveredId),
  };
}
