// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import App from '../src/App.jsx';

// jsdom 不提供 ResizeObserver 与真实布局，补一个空实现即可（虚拟化仍会按 overscan 渲染）。
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DEFAULT_4X4 = [
  [90, 75, 120, 60],
  [35, 80, 55, 200],
  [110, 40, 95, 130],
  [65, 150, 70, 100],
];

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function forcedAnalysis(n = 4) {
  return { forced: Array(n).fill(true), alternatives: Array(n).fill(0), forcedCount: n };
}

function replaceableAnalysis(n = 4, alt = 1) {
  return { forced: Array(n).fill(false), alternatives: Array(n).fill(alt), forcedCount: 0 };
}

function okResp(assignment, totalCost, analysis) {
  return jsonResponse(200, {
    status: 'ok',
    n: assignment.length,
    assignment,
    totalCost,
    analysis,
  });
}

// 方案区每条配对的必然/可替换标记（不含图例）。
function pairBadges(container) {
  return {
    forced: container.querySelectorAll('.pairs .badge.forced').length,
    replaceable: container.querySelectorAll('.pairs .badge.replaceable').length,
  };
}

// 矩阵网格中当前配对格 / 必然高亮格数量。
function matchedCellCount(container) {
  return {
    matched: container.querySelectorAll('.cell.matched').length,
    forcedMatched: container.querySelectorAll('.cell.matched.forced').length,
  };
}

describe('App 页面：请求锁定 / 编辑清方案 / 排除重算', () => {
  it('请求期间锁定编辑与提交，返回后展示方案与必然标记；之后编辑立即清除', async () => {
    const d = deferred();
    const fetchMock = vi.fn(() => d.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, getByDisplayValue, findByText, queryByText, container } = render(<App />);

    // 发起求解
    fireEvent.click(getByText('求解最小分配'));

    // 请求进行中：出现锁定提示，提交按钮与规模输入都被禁用
    await findByText('请求进行中：编辑已锁定，等待服务器返回精确最优方案……');
    const solveBtn = getByText('求解中…').closest('button');
    expect(solveBtn.disabled).toBe(true);
    expect(getByDisplayValue('4').disabled).toBe(true);
    // 矩阵格也被锁定（禁配标记按钮禁用）
    const lockedMarks = container.querySelectorAll('.cell button');
    expect(lockedMarks.length).toBeGreaterThan(0);
    lockedMarks.forEach((b) => expect(b.disabled).toBe(true));

    // 服务器返回（唯一最优：四条全部必然）
    await act(async () => {
      d.resolve(okResp([3, 0, 1, 2], 205, forcedAnalysis(4)));
    });
    await findByText('最优分配方案');
    expect(getByText('205')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 分析标记与方案同一次更新出现：4 个配对全是“必然”，图例与统计齐全
    expect(pairBadges(container)).toEqual({ forced: 4, replaceable: 0 });
    expect(matchedCellCount(container)).toEqual({ matched: 4, forcedMatched: 4 });
    expect(getByText('本方案必然连线 4 条 · 可替换 0 条')).toBeTruthy();

    // 请求结束后直接编辑一个格：旧方案与标记立即一起消失
    const cell90 = Array.from(container.querySelectorAll('.cell-value')).find(
      (b) => b.textContent === '90'
    );
    fireEvent.click(cell90);
    const input = container.querySelector('.cell-input');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(queryByText('最优分配方案')).toBeNull();
    expect(container.querySelectorAll('.pairs .badge').length).toBe(0);
    expect(matchedCellCount(container)).toEqual({ matched: 0, forcedMatched: 0 });
  });

  it('排除配对：重算后展示新方案与新标记（可替换→必然），同一次更新', async () => {
    const bodies = [];
    const fetchMock = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      // 第一次：原矩阵，四条配对全部可替换；之后：排除 [0][3] 后的替代问题，最优唯一
      const isExcluded = body.costs[0][3] === null;
      if (!isExcluded) return okResp([3, 0, 1, 2], 205, replaceableAnalysis(4, 1));
      // 替代方案：探针 1 改配座 3（列下标 2，代价 120）
      return okResp([2, 0, 1, 3], 295, forcedAnalysis(4));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, getAllByText, findByText, queryByText, container } = render(<App />);
    fireEvent.click(getByText('求解最小分配'));
    await findByText('最优分配方案');

    // 初始标记对应初始展示的配对：全部“可替换×1”，无必然高亮
    expect(pairBadges(container)).toEqual({ forced: 0, replaceable: 4 });
    expect(matchedCellCount(container)).toEqual({ matched: 4, forcedMatched: 0 });
    getAllByText('可替换×1'); // 数量断言见上，这里确认文案可渲染
    expect(getByText('本方案必然连线 0 条 · 可替换 4 条')).toBeTruthy();

    // 排除第一对（探针 1 → 座 4，即 [0][3]）
    const firstExclude = getAllByText('排除此配对')[0];
    fireEvent.click(firstExclude);

    // 新方案（295）与新标记同一次更新：四条全部必然，旧的可替换标记不复存在
    await findByText('295');
    expect(pairBadges(container)).toEqual({ forced: 4, replaceable: 0 });
    expect(matchedCellCount(container)).toEqual({ matched: 4, forcedMatched: 4 });
    expect(queryByText('可替换×1')).toBeNull();
    expect(getByText('本方案必然连线 4 条 · 可替换 0 条')).toBeTruthy();

    expect(bodies).toHaveLength(2);
    // 经同一接口
    expect(fetchMock.mock.calls[0][0]).toBe('/api/solve');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/solve');
    // 重算载荷中该格确为禁配，其余不变
    const nextCosts = bodies[1].costs;
    expect(nextCosts[0][3]).toBeNull();
    expect(nextCosts[0][0]).toBe(90);
    expect(nextCosts).toEqual(
      DEFAULT_4X4.map((row, i) => (i === 0 ? row.map((v, j) => (j === 3 ? null : v)) : row))
    );
  });

  it('排除后返回 409 NO_PERFECT_ASSIGNMENT：展示无解且方案与标记一并清除', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.costs[0][3] === null) {
        return jsonResponse(409, {
          status: 'error',
          error: 'NO_PERFECT_ASSIGNMENT',
          message: '禁配关系下不存在覆盖全部探针与测试座的完美匹配',
        });
      }
      return okResp([3, 0, 1, 2], 205, forcedAnalysis(4));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, getAllByText, findByText, queryByText, container } = render(<App />);
    fireEvent.click(getByText('求解最小分配'));
    await findByText('最优分配方案');
    expect(pairBadges(container)).toEqual({ forced: 4, replaceable: 0 });
    expect(matchedCellCount(container).forcedMatched).toBe(4);

    fireEvent.click(getAllByText('排除此配对')[0]);

    await findByText(/NO_PERFECT_ASSIGNMENT/);
    // 旧方案与标记全部清除，不残留排除前标记
    expect(queryByText('最优分配方案')).toBeNull();
    expect(container.querySelectorAll('.pairs .badge').length).toBe(0);
    expect(matchedCellCount(container)).toEqual({ matched: 0, forcedMatched: 0 });
  });

  it('422 INVALID_INPUT：展示输入错误且无方案、无标记残留', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(422, {
        status: 'error',
        error: 'INVALID_INPUT',
        message: '第 2 行长度 1 与 n=2 不一致（错维度）',
      })
    );
    const { getByText, findByText, queryByText, container } = render(<App />);
    fireEvent.click(getByText('求解最小分配'));
    await findByText(/INVALID_INPUT/);
    expect(queryByText('最优分配方案')).toBeNull();
    expect(container.querySelectorAll('.pairs .badge').length).toBe(0);
  });

  it('网络失败后重新求解成功：标记随成功响应出现，不沿用失败前的空状态', async () => {
    let fail = true;
    vi.stubGlobal('fetch', async () => {
      if (fail) {
        fail = false;
        throw new TypeError('Failed to fetch');
      }
      return okResp([3, 0, 1, 2], 205, replaceableAnalysis(4, 2));
    });

    const { getByText, findByText, container } = render(<App />);
    fireEvent.click(getByText('求解最小分配'));
    await findByText(/网络错误/);
    expect(container.querySelectorAll('.pairs .badge').length).toBe(0);

    fireEvent.click(getByText('求解最小分配'));
    await findByText('最优分配方案');
    expect(pairBadges(container)).toEqual({ forced: 0, replaceable: 4 });
    container.querySelectorAll('.pairs .badge.replaceable').forEach((b) => {
      expect(b.textContent).toContain('可替换×2');
    });
    expect(matchedCellCount(container)).toEqual({ matched: 4, forcedMatched: 0 });
  });
});
