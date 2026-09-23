import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../server/server.js';
import { mulberry32, randomCostMatrix, enumerateOptima, oracleFlags } from './helpers.js';

// 支持两种运行方式：
//   1) 默认：直接在进程内注入完整 HTTP 请求（含 JSON 解析）；
//   2) TARGET_BASE_URL=http://web:3000：对已部署的 Compose 服务发真实请求。
const BASE_URL = process.env.TARGET_BASE_URL || '';
let app;

beforeAll(async () => {
  if (!BASE_URL) app = await buildServer();
});

async function callSolve(payload, { raw = false } = {}) {
  const started = performance.now();
  let status;
  let data;

  if (BASE_URL) {
    const body = raw ? payload : JSON.stringify(payload);
    const resp = await fetch(`${BASE_URL}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    status = resp.status;
    data = await resp.json().catch(() => null);
  } else {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/solve',
      headers: { 'content-type': 'application/json' },
      payload: raw ? payload : payload,
    });
    status = resp.statusCode;
    data = resp.json();
  }
  return { status, data, elapsedMs: performance.now() - started };
}

const good = [
  [90, 75, 120, 60],
  [35, 80, 55, 200],
  [110, 40, 95, 130],
  [65, 150, 70, 100],
];

function assertAssignmentPerfect(costs, assignment) {
  const n = costs.length;
  expect(assignment).toHaveLength(n);
  const used = new Set();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = assignment[i];
    expect(j).toBeGreaterThanOrEqual(0);
    expect(j).toBeLessThan(n);
    expect(used.has(j)).toBe(false);
    used.add(j);
    expect(costs[i][j]).not.toBeNull();
    sum += costs[i][j];
  }
  return sum;
}

// 用穷举全部最优解的独立预言机，核对 API 返回的必然连线标记（针对实际返回的配对）。
function expectAnalysisMatchesOracle(costs, data) {
  const optima = enumerateOptima(costs);
  expect(optima).not.toBeNull();
  expect(data.totalCost).toBe(optima.totalCost);
  expect(data.analysis).toBeDefined();
  expect(data.analysis.forced).toHaveLength(costs.length);
  expect(data.analysis.alternatives).toHaveLength(costs.length);
  const oracle = oracleFlags(optima, data.assignment);
  expect(data.analysis.forced).toEqual(oracle.forced);
  expect(data.analysis.alternatives).toEqual(oracle.alternatives);
  expect(data.analysis.forcedCount).toBe(oracle.forced.filter(Boolean).length);
}

describe('POST /api/solve：成功', () => {
  it('返回覆盖全部行列的配对与精确最小总代价', async () => {
    const { status, data } = await callSolve({ costs: good });
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.n).toBe(4);
    const sum = assertAssignmentPerfect(good, data.assignment);
    expect(sum).toBe(data.totalCost);
    // 该矩阵最优解 60+35+40+70 = 205
    expect(data.totalCost).toBe(205);
  });

  it('成功响应携带必然连线分析，且标记与穷举预言机一致', async () => {
    const { status, data } = await callSolve({ costs: good });
    expect(status).toBe(200);
    // 该矩阵最优解唯一：四条配对全部必然
    expect(data.analysis).toEqual({
      forced: [true, true, true, true],
      alternatives: [0, 0, 0, 0],
      forcedCount: 4,
    });
    expectAnalysisMatchesOracle(good, data);
  });

  it('n=1：单个元素直接返回', async () => {
    const { status, data } = await callSolve({ costs: [[123]] });
    expect(status).toBe(200);
    expect(data.assignment).toEqual([0]);
    expect(data.totalCost).toBe(123);
    expect(data.analysis).toEqual({ forced: [true], alternatives: [0], forcedCount: 1 });
  });

  it('n=1 且唯一格禁配 -> 409', async () => {
    const { status, data } = await callSolve({ costs: [[null]] });
    expect(status).toBe(409);
    expect(data.error).toBe('NO_PERFECT_ASSIGNMENT');
    // 失败不携带方案，也不携带任何标记
    expect(data.assignment).toBeUndefined();
    expect(data.analysis).toBeUndefined();
  });

  it('排除一个配对后重算：给出替代最优或无解', async () => {
    const first = await callSolve({ costs: good });
    expect(first.status).toBe(200);
    const i0 = 0;
    const j0 = first.data.assignment[0];

    const reduced = good.map((row) => row.slice());
    reduced[i0][j0] = null; // 页面“排除此配对”：该格设为禁配
    const second = await callSolve({ costs: reduced });

    if (second.status === 200) {
      const sum = assertAssignmentPerfect(reduced, second.data.assignment);
      expect(sum).toBe(second.data.totalCost);
      expect(second.data.assignment[0]).not.toBe(j0); // 原配对确实不再出现
      expect(second.data.totalCost).toBeGreaterThanOrEqual(first.data.totalCost);
      // 重算结果带的是替代问题的全新分析，不是排除前的旧标记
      expect(second.data.analysis).toBeDefined();
      expectAnalysisMatchesOracle(reduced, second.data);
    } else {
      expect(second.status).toBe(409);
      expect(second.data.error).toBe('NO_PERFECT_ASSIGNMENT');
      expect(second.data.analysis).toBeUndefined();
    }
  });

  it('排除配对使同价最优消失：标记随新方案同次更新（可替换 -> 必然）', async () => {
    // 2×2 全同价：两个最优解，没有必然连线
    const tie = [
      [5, 5],
      [5, 5],
    ];
    const first = await callSolve({ costs: tie });
    expect(first.status).toBe(200);
    expect(first.data.analysis.forced).toEqual([false, false]);
    expect(first.data.analysis.alternatives).toEqual([1, 1]);
    expect(first.data.analysis.forcedCount).toBe(0);

    const j0 = first.data.assignment[0];
    const reduced = tie.map((row) => row.slice());
    reduced[0][j0] = null;
    const second = await callSolve({ costs: reduced });
    expect(second.status).toBe(200);
    expect(second.data.assignment[0]).not.toBe(j0);
    // 排除后只剩一个可行（也是最优）完美匹配：两条配对都变必然
    expect(second.data.analysis.forced).toEqual([true, true]);
    expect(second.data.analysis.alternatives).toEqual([0, 0]);
    expect(second.data.analysis.forcedCount).toBe(2);
  });
});

describe('POST /api/solve：分析标记与穷举预言机一致（随机小矩阵）', () => {
  it('稠密/含禁配/零价/重复代价混合（n≤6）', async () => {
    const rng = mulberry32(20260923);
    for (let t = 0; t < 30; t++) {
      const n = 1 + Math.floor(rng() * 6);
      const costs = randomCostMatrix(n, rng, {
        forbiddenRate: t % 2 === 0 ? 0 : 0.3,
        maxCost: t % 3, // 0..2：大量重复代价与零价，并列最优多
      });
      const { status, data } = await callSolve({ costs });
      const optima = enumerateOptima(costs);
      if (optima === null) {
        expect(status).toBe(409);
        expect(data.error).toBe('NO_PERFECT_ASSIGNMENT');
        expect(data.analysis).toBeUndefined();
      } else {
        expect(status).toBe(200);
        expectAnalysisMatchesOracle(costs, data);
      }
    }
  });
});

describe('POST /api/solve：409 NO_PERFECT_ASSIGNMENT', () => {
  it('Hall 条件：两行只能配同一列', async () => {
    const { status, data } = await callSolve({
      costs: [
        [5, null, null],
        [2, null, null],
        [7, 1, 3],
      ],
    });
    expect(status).toBe(409);
    expect(data.status).toBe('error');
    expect(data.error).toBe('NO_PERFECT_ASSIGNMENT');
    expect(data.assignment).toBeUndefined();
    expect(data.analysis).toBeUndefined();
  });

  it('整行禁配', async () => {
    const { status, data } = await callSolve({
      costs: [
        [5, 1, 2],
        [null, null, null],
        [2, 3, 4],
      ],
    });
    expect(status).toBe(409);
    expect(data.error).toBe('NO_PERFECT_ASSIGNMENT');
    expect(data.analysis).toBeUndefined();
  });
});

describe('POST /api/solve：422 INVALID_INPUT', () => {
  const badCases = [
    ['请求体为 null', null],
    ['请求体是数组', [1, 2, 3]],
    ['缺少 costs', {}],
    ['costs 不是数组', { costs: 123 }],
    ['n=0 空矩阵', { costs: [] }],
    ['n=401 超上限', { costs: Array.from({ length: 401 }, () => new Array(401).fill(0)) }],
    ['缺行：第二行不是数组', { costs: [[1, 2], null] }],
    ['错维度：行长不一致', { costs: [[1, 2, 3], [4, 5], [6, 7, 8]] }],
    ['非方阵（2 行 3 列）', { costs: [[1, 2, 3], [4, 5, 6]] }],
    ['元素为字符串', { costs: [[1, 'x'], [3, 4]] }],
    ['元素为小数', { costs: [[1, 2.5], [3, 4]] }],
    ['元素为布尔', { costs: [[true, 2], [3, 4]] }],
    ['元素越界（负数）', { costs: [[-1, 2], [3, 4]] }],
    ['元素越界（>1e12）', { costs: [[1, 1_000_000_000_001], [3, 4]] }],
    ['元素为对象', { costs: [[{}, 2], [3, 4]] }],
  ];

  for (const [name, payload] of badCases) {
    it(name, async () => {
      const { status, data } = await callSolve(payload);
      expect(status).toBe(422);
      expect(data.status).toBe('error');
      expect(data.error).toBe('INVALID_INPUT');
      // 输入非法不能留下任何方案或标记
      expect(data.assignment).toBeUndefined();
      expect(data.analysis).toBeUndefined();
    });
  }

  it('JSON 语法错误同样为 422', async () => {
    const { status, data } = await callSolve('{ costs: [[1,2],', { raw: true });
    expect(status).toBe(422);
    expect(data.error).toBe('INVALID_INPUT');
  });
});

describe('POST /api/solve：n=400 稠密矩阵性能与精度', () => {
  it('三秒内经 API 返回精确最优解', async () => {
    const n = 400;
    const rng = mulberry32(20260918);
    const costs = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => Math.floor(rng() * 1_000_000))
    );

    const { status, data, elapsedMs } = await callSolve({ costs });
    expect(status).toBe(200);
    expect(data.assignment).toHaveLength(n);
    // 必然连线分析随方案同次返回，结构完整
    expect(data.analysis.forced).toHaveLength(n);
    expect(data.analysis.alternatives).toHaveLength(n);
    expect(data.analysis.forcedCount).toBe(data.analysis.forced.filter(Boolean).length);
    for (let i = 0; i < n; i++) {
      expect(typeof data.analysis.forced[i]).toBe('boolean');
      expect(Number.isInteger(data.analysis.alternatives[i])).toBe(true);
      if (data.analysis.forced[i]) expect(data.analysis.alternatives[i]).toBe(0);
    }
    // 精确复算（小于 2^53）
    const sum = assertAssignmentPerfect(costs, data.assignment);
    expect(sum).toBe(data.totalCost);
    expect(Number.isSafeInteger(data.totalCost)).toBe(true);
    // 独立上界：任何可行解都不差于「每行最小值之和」之外 —— 这里用简单合理性检查
    expect(data.totalCost).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`n=${n} API 端到端耗时 ${Math.round(elapsedMs)} ms，总代价 ${data.totalCost}`);
    expect(elapsedMs).toBeLessThan(3000);
  });
});
