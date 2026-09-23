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

function okResp(assignment, totalCost, n = 4) {
  return jsonResponse(200, { status: 'ok', n, assignment, totalCost });
}

describe('App 页面：请求锁定 / 编辑清方案 / 排除重算', () => {
  it('请求期间锁定编辑与提交，返回后展示方案；之后编辑立即清除旧方案', async () => {
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

    // 服务器返回
    await act(async () => {
      d.resolve(okResp([3, 0, 1, 2], 205));
    });
    await findByText('最优分配方案');
    expect(getByText('205')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 请求结束后直接编辑一个格：旧方案立即消失
    const cell90 = Array.from(container.querySelectorAll('.cell-value')).find(
      (b) => b.textContent === '90'
    );
    fireEvent.click(cell90);
    const input = container.querySelector('.cell-input');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(queryByText('最优分配方案')).toBeNull();
  });

  it('排除配对：该格被设为禁配并经同一接口重算，展示替代最优方案', async () => {
    const bodies = [];
    const fetchMock = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      // 第一次：原矩阵最优；之后：排除 [0][3] 后的替代问题
      const isExcluded = body.costs[0][3] === null;
      if (!isExcluded) return okResp([3, 0, 1, 2], 205);
      // 替代方案：探针 1 改配座 3（列下标 2，代价 120）
      return okResp([2, 0, 1, 3], 295);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, getAllByText, findByText } = render(<App />);
    fireEvent.click(getByText('求解最小分配'));
    await findByText('最优分配方案');

    // 排除第一对（探针 1 → 座 4，即 [0][3]）
    const firstExclude = getAllByText('排除此配对')[0];
    fireEvent.click(firstExclude);

    await findByText('295');
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

  it('排除后返回 409 NO_PERFECT_ASSIGNMENT：展示无解且清除旧方案', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.costs[0][3] === null) {
        return jsonResponse(409, {
          status: 'error',
          error: 'NO_PERFECT_ASSIGNMENT',
          message: '禁配关系下不存在覆盖全部探针与测试座的完美匹配',
        });
      }
      return okResp([3, 0, 1, 2], 205);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, getAllByText, findByText, queryByText } = render(<App />);
    fireEvent.click(getByText('求解最小分配'));
    await findByText('最优分配方案');

    fireEvent.click(getAllByText('排除此配对')[0]);

    await findByText(/NO_PERFECT_ASSIGNMENT/);
    // 旧方案被清除
    expect(queryByText('最优分配方案')).toBeNull();
  });

  it('422 INVALID_INPUT：展示输入错误且无方案残留', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(422, {
        status: 'error',
        error: 'INVALID_INPUT',
        message: '第 2 行长度 1 与 n=2 不一致（错维度）',
      })
    );
    const { getByText, findByText, queryByText } = render(<App />);
    fireEvent.click(getByText('求解最小分配'));
    await findByText(/INVALID_INPUT/);
    expect(queryByText('最优分配方案')).toBeNull();
  });
});
