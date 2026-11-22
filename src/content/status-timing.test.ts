import { describe, expect, it } from 'vitest';
import type { StatusPanel } from '../shared/page-status.ts';
import { nextStep, type PanelTiming } from './status-timing.ts';

const panel = (header: StatusPanel['header'], expanded = false): StatusPanel => ({ header, rows: [], more: 0, problems: [], expanded });
const working = panel({ kind: 'working', text: '2 頁處理中' });
const problem = panel({ kind: 'problem', text: '需要你處理' }, true);
const settled = panel({ kind: 'settled', text: '2 頁套用快取（沒扣額度）' });

const hidden: PanelTiming = { showing: undefined, fading: false, settledShown: false };

describe('處理中：過一下才出現，命中快取的頁不先閃', () => {
  it('還沒出現：先等', () => {
    expect(nextStep(hidden, working)).toEqual({ do: 'delay' });
  });

  it('處理中已經在畫面上（淡出中也算）：馬上換，不先消失再出現', () => {
    expect(nextStep({ ...hidden, showing: 'working' }, working)).toEqual({ do: 'show', linger: false });
    expect(nextStep({ ...hidden, showing: 'working', fading: true }, working)).toEqual({ do: 'show', linger: false });
  });

  it('上一批的摘要還在：新的處理中照樣先等，接著命中快取時不會從摘要閃成處理中', () => {
    expect(nextStep({ showing: 'settled', fading: false, settledShown: true }, working)).toEqual({ do: 'delay' });
  });

  it('要讀者處理的：馬上出現', () => {
    expect(nextStep(hidden, problem)).toEqual({ do: 'show', linger: false });
  });
});

describe('這一批的摘要：停一下再收起', () => {
  it('第一次收到：馬上出現並開始計時（等著的處理中不畫了）', () => {
    expect(nextStep(hidden, settled)).toEqual({ do: 'show', linger: true });
  });

  it('同一批重送（內容變了）：換內容，不重新計時', () => {
    expect(nextStep({ showing: 'settled', fading: false, settledShown: true }, settled)).toEqual({ do: 'show', linger: false });
  });

  it('已經收起（淡出中或收完了）：同一批不再出現', () => {
    expect(nextStep({ showing: 'settled', fading: true, settledShown: true }, settled)).toEqual({ do: 'keep' });
    expect(nextStep({ ...hidden, settledShown: true }, settled)).toEqual({ do: 'keep' });
  });
});

it('沒在忙也沒出問題：收起', () => {
  expect(nextStep({ ...hidden, showing: 'working' }, undefined)).toEqual({ do: 'hide' });
});
