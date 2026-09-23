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
