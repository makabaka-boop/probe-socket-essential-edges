// 穷举 n! 种排列，取允许（非禁配）分配中的最小总代价 —— 仅用于小矩阵基准核对。
export function bruteForce(costs) {
  const n = costs.length;
  const cols = Array.from({ length: n }, (_, j) => j);
  let best = null;
  let bestPerm = null;

  const permute = (rest, picked, sum) => {
    if (rest.length === 0) {
      if (best === null || sum < best) {
        best = sum;
        bestPerm = picked.slice();
      }
      return;
    }
    const i = picked.length;
    for (let k = 0; k < rest.length; k++) {
      const j = rest[k];
      const c = costs[i][j];
      if (c === null) continue;
      picked.push(j);
      const next = rest.slice(0, k).concat(rest.slice(k + 1));
      permute(next, picked, sum + c);
      picked.pop();
    }
  };

  permute(cols, [], 0);
  return best === null ? null : { totalCost: best, assignment: bestPerm };
}

// 独立预言机：穷举全部完美匹配，收集所有同价最优解 —— 仅用于小规模必然连线核对。
// 返回 null（无完美匹配）或 { totalCost, matchings }，matchings 为全部最优排列的列表。
export function enumerateOptima(costs) {
  const n = costs.length;
  const used = new Uint8Array(n);
  const current = new Array(n);
  let best = Infinity;
  const matchings = [];

  const dfs = (i, sum) => {
    if (sum > best) return; // 已劣于已知最优，剪枝（等于仍可能并列最优，不能剪）
    if (i === n) {
      if (sum < best) {
        best = sum;
        matchings.length = 0;
      }
      matchings.push(current.slice());
      return;
    }
    for (let j = 0; j < n; j++) {
      if (used[j] === 1) continue;
      const c = costs[i][j];
      if (c === null) continue;
      used[j] = 1;
      current[i] = j;
      dfs(i + 1, sum + c);
      used[j] = 0;
    }
  };

  dfs(0, 0);
  return matchings.length === 0 ? null : { totalCost: best, matchings };
}

// 由全部最优解推出展示配对 displayed 的必然/可替换标记（预言机视角）：
// forced[i]：所有最优解在第 i 行都与 displayed 一致；
// alternatives[i]：所有最优解在第 i 行出现过的不同列数减 1（去掉当前配对自身）。
export function oracleFlags(optima, displayed) {
  const n = displayed.length;
  const forced = new Array(n);
  const alternatives = new Array(n);
  for (let i = 0; i < n; i++) {
    const cols = new Set();
    for (const m of optima.matchings) cols.add(m[i]);
    forced[i] = optima.matchings.every((m) => m[i] === displayed[i]);
    alternatives[i] = cols.size - 1;
  }
  return { forced, alternatives };
}

// 可复现的伪随机数（mulberry32），让随机测试与性能测试可重复。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomCostMatrix(n, rng, { forbiddenRate = 0, maxCost = 99 } = {}) {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () =>
      rng() < forbiddenRate ? null : Math.floor(rng() * (maxCost + 1))
    )
  );
}
