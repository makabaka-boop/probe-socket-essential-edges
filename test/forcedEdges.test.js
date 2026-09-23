import { describe, it, expect } from 'vitest';
import { analyzeForcedEdges } from '../server/forcedEdges.js';
import { hungarian, NoPerfectAssignmentError } from '../server/hungarian.js';
import { enumerateOptima, oracleFlags, mulberry32, randomCostMatrix } from './helpers.js';

// 用穷举全部最优解的预言机，核对一次分析结果（标记必须对应实际返回的配对）。
function expectMatchesOracle(costs) {
  const optima = enumerateOptima(costs);
  if (optima === null) {
    expect(() => analyzeForcedEdges(costs)).toThrow(NoPerfectAssignmentError);
    return null;
  }
  const result = analyzeForcedEdges(costs);
  const n = costs.length;

  // 价格与配对不因分析而改变：与纯求解器完全一致
  expect(result.totalCost).toBe(optima.totalCost);
  const plain = hungarian(costs);
  expect(result.assignment).toEqual(plain.assignment);
  expect(result.totalCost).toBe(plain.totalCost);

  // 返回的配对本身必须是合法完美匹配
  expect(result.assignment).toHaveLength(n);
  expect(new Set(result.assignment).size).toBe(n);
  for (let i = 0; i < n; i++) expect(costs[i][result.assignment[i]]).not.toBeNull();

  // 与穷举预言机逐条比对（针对实际展示的配对）
  const oracle = oracleFlags(optima, result.assignment);
  expect(result.forced).toEqual(oracle.forced);
  expect(result.alternatives).toEqual(oracle.alternatives);

  // 结构不变式
  expect(result.forcedCount).toBe(result.forced.filter(Boolean).length);
  for (let i = 0; i < n; i++) {
    if (result.forced[i]) {
      expect(result.alternatives[i]).toBe(0);
    } else {
      expect(result.alternatives[i]).toBeGreaterThanOrEqual(1);
    }
  }
  return result;
}

describe('必然连线分析：穷举预言机核对（随机矩阵）', () => {
  // 稠密：代价重复多 -> 同价最优多；稀疏：禁配多 -> 结构性强约束多
  const cases = [
    { n: 1, trials: 10 },
    { n: 2, trials: 20 },
    { n: 3, trials: 20 },
    { n: 4, trials: 16 },
    { n: 5, trials: 12 },
    { n: 6, trials: 8 },
    { n: 7, trials: 4 },
    { n: 8, trials: 2 },
  ];

  for (const { n, trials } of cases) {
    for (let t = 0; t < trials; t++) {
      const mode = t % 3;
      const rng = mulberry32(5000 * n + t * 31 + 7);
      const costs =
        mode === 0
          ? randomCostMatrix(n, rng, { forbiddenRate: 0, maxCost: 3 }) // 大量重复代价，并列最优多
          : mode === 1
            ? randomCostMatrix(n, rng, { forbiddenRate: 0.3 }) // 含禁配
            : randomCostMatrix(n, rng, { forbiddenRate: 0.15, maxCost: 1 }); // 禁配 + 0/1 代价（零价+并列）

      it(`n=${n} trial=${t} 标记与全部最优解穷举一致`, () => {
        expectMatchesOracle(costs);
      });
    }
  }

  it('断开图（块对角禁配）：各块独立分析', () => {
    // 左块唯一最优（对角 1+1），右块全部同价（两个最优解）
    const costs = [
      [1, 5, null, null],
      [5, 1, null, null],
      [null, null, 2, 2],
      [null, null, 2, 2],
    ];
    const result = expectMatchesOracle(costs);
    expect(result.totalCost).toBe(6);
    expect(result.forced).toEqual([true, true, false, false]);
    expect(result.alternatives).toEqual([0, 0, 1, 1]);
    expect(result.forcedCount).toBe(2);
  });

  it('无完美匹配：抛错且不产生任何标记', () => {
    const costs = [
      [5, null, null],
      [2, null, null],
      [7, 1, 3],
    ];
    expect(enumerateOptima(costs)).toBeNull();
    expect(() => analyzeForcedEdges(costs)).toThrow(NoPerfectAssignmentError);
  });
});

describe('必然连线分析：构造用例', () => {
  it('唯一最优解：全部配对必然，可替换数为 0', () => {
    const costs = [
      [1, 9, 9],
      [9, 2, 9],
      [9, 9, 3],
    ];
    const result = expectMatchesOracle(costs);
    expect(result.totalCost).toBe(6);
    expect(result.forced).toEqual([true, true, true]);
    expect(result.alternatives).toEqual([0, 0, 0]);
    expect(result.forcedCount).toBe(3);
  });

  it('全零矩阵（n=3）：全部配对可替换，可替换数 n-1', () => {
    const costs = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = expectMatchesOracle(costs);
    expect(result.totalCost).toBe(0);
    expect(result.forced).toEqual([false, false, false]);
    expect(result.alternatives).toEqual([2, 2, 2]);
    expect(result.forcedCount).toBe(0);
  });

  it('2×2 全部同价：两个同价最优解，无必然连线', () => {
    const costs = [
      [5, 5],
      [5, 5],
    ];
    const result = expectMatchesOracle(costs);
    expect(result.totalCost).toBe(10);
    expect(result.forced).toEqual([false, false]);
    expect(result.alternatives).toEqual([1, 1]);
  });

  it('禁配造就必然连线：唯一允许列的行必然占用它', () => {
    const costs = [
      [1, null, null],
      [2, 3, 4],
      [5, 6, 7],
    ];
    // 最优 11：探针1→座1 必然；后两行 3+7 与 4+6 同价，可互换
    const result = expectMatchesOracle(costs);
    expect(result.totalCost).toBe(11);
    expect(result.forced).toEqual([true, false, false]);
    expect(result.alternatives).toEqual([0, 1, 1]);
    expect(result.forcedCount).toBe(1);
  });

  it('零价参与的唯一最优：总代价 0 也可以全部必然', () => {
    const costs = [
      [0, 0],
      [0, 1],
    ];
    // 唯一最优：探针1→座2、探针2→座1，总代价 0
    const result = expectMatchesOracle(costs);
    expect(result.totalCost).toBe(0);
    expect(result.assignment).toEqual([1, 0]);
    expect(result.forced).toEqual([true, true]);
    expect(result.alternatives).toEqual([0, 0]);
  });

  it('零价与重复代价同价：两个最优解，无必然连线', () => {
    const costs = [
      [0, 0],
      [1, 1],
    ];
    // [0,1]=0+1=1 与 [1,0]=0+1=1 并列最优
    const result = expectMatchesOracle(costs);
    expect(result.totalCost).toBe(1);
    expect(result.forced).toEqual([false, false]);
    expect(result.alternatives).toEqual([1, 1]);
  });

  it('n=1：唯一配对必然', () => {
    const result = expectMatchesOracle([[123]]);
    expect(result.assignment).toEqual([0]);
    expect(result.forced).toEqual([true]);
    expect(result.alternatives).toEqual([0]);
    expect(result.forcedCount).toBe(1);
  });

  it('n=1 禁配：无解', () => {
    expect(() => analyzeForcedEdges([[null]])).toThrow(NoPerfectAssignmentError);
  });

  it('重复调用结果稳定，且不修改输入矩阵', () => {
    const costs = [
      [1, null, null],
      [2, 3, 4],
      [5, 6, 7],
    ];
    const snapshot = JSON.stringify(costs);
    const a = analyzeForcedEdges(costs);
    const b = analyzeForcedEdges(costs);
    expect(a).toEqual(b);
    expect(JSON.stringify(costs)).toBe(snapshot);
  });

  it('大数 1e12 与 0 混合：标记仍与穷举一致（n=5）', () => {
    const rng = mulberry32(777);
    const costs = randomCostMatrix(5, rng, { forbiddenRate: 0.2, maxCost: 1_000_000_000_000 });
    expectMatchesOracle(costs);
  });
});
