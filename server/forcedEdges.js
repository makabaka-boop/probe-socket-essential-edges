// 必然连线分析：在精确最优解基础上，判断当前展示的每条配对是否出现在
// 所有同价最优完美匹配中，并给出每条配对的可替换连线数量。
//
// 理论依据（匹配论标准结论，实现不暴露给前端）：
//   设匈牙利算法求得最优对偶势 u/v，则简约代价 c(i,j)-u[i]-v[j] >= 0，
//   且一条边属于某个最优完美匹配 ⟺ 它属于“等子图”（简约代价为 0 的边）的某个完美匹配。
//   把等子图按当前匹配 M 定向：匹配边 列→行，未匹配边 行→列。
//   等子图中 M 的偶交错环 ⟺ 该有向图中的有向环，因此：
//     匹配边 (i,j) 出现在所有最优完美匹配中 ⟺ 行 i 与列 j 不在同一强连通分量。
//   同一强连通分量内、从行 i 出发的未匹配等边，每一条都落在某个最优完美匹配里，
//   其条数即为该配对的可替换连线数量（匹配边定向为 列→行，不在行的出边中）。
//
// 复杂度 O(n^2)：等子图最多 n^2 条边，Kosaraju 两遍迭代 DFS（不用递归，避免深栈）。
// 全程整数精确比较（简约代价为整数浮点），禁配边（null）天然不满足等式、不会混入。

import { hungarianDetailed } from './hungarian.js';

/**
 * @param {ReadonlyArray<ReadonlyArray<number | null>>} costs n×n，元素为 null 或 [0,1e12] 整数
 * @returns {{
 *   assignment: number[],        // 与 hungarian() 相同的任一最优配对（分析标记即对应它）
 *   totalCost: number,           // 精确最小总代价，与 hungarian() 完全一致
 *   forced: boolean[],           // forced[i]：配对 (i, assignment[i]) 是否为所有最优解共有
 *   alternatives: number[],      // alternatives[i]：该配对的可替换连线数量（必然配对恒为 0）
 *   forcedCount: number          // 必然连线总数
 * }}
 * @throws {NoPerfectAssignmentError} 不存在完美匹配时不产生任何标记
 */
export function analyzeForcedEdges(costs) {
  const n = costs.length;
  const { assignment, totalCost, u, v } = hungarianDetailed(costs);

  // 等子图定向邻接：节点 0..n-1 为行，n..2n-1 为列。
  // 未匹配等边 行→列；匹配边 列→行（每行恰好一条）。
  const adj = Array.from({ length: 2 * n }, () => []);
  for (let i = 0; i < n; i++) {
    const row = costs[i];
    const ui = u[i + 1];
    for (let j = 0; j < n; j++) {
      const c = row[j];
      if (c === null) continue; // 禁配边：不是等边
      if (c - ui - v[j + 1] !== 0) continue; // 简约代价非零：不属于任何最优完美匹配
      if (assignment[i] === j) {
        adj[n + j].push(i); // 匹配边：列→行
      } else {
        adj[i].push(n + j); // 未匹配等边：行→列
      }
    }
  }

  const comp = kosaraju(adj);

  const forced = new Array(n);
  const alternatives = new Array(n);
  let forcedCount = 0;
  for (let i = 0; i < n; i++) {
    const j = assignment[i];
    const isForced = comp[i] !== comp[n + j];
    forced[i] = isForced;
    if (isForced) {
      alternatives[i] = 0;
      forcedCount++;
    } else {
      // 行 i 指向同分量列的等边都落在某个最优完美匹配里，即为可替换连线。
      // 注意 adj[i] 只含未匹配等边（匹配边定向为 列→行，不在其中），
      // 当前配对自身不计入，无需再减 1。
      let count = 0;
      for (const t of adj[i]) {
        if (comp[t] === comp[i]) count++;
      }
      alternatives[i] = count;
    }
  }

  return { assignment, totalCost, forced, alternatives, forcedCount };
}

// Kosaraju 强连通分量（迭代实现）。返回 comp[v]：分量编号，同分量编号相同。
function kosaraju(adj) {
  const m = adj.length;

  // 反向邻接
  const radj = Array.from({ length: m }, () => []);
  for (let s = 0; s < m; s++) {
    for (const t of adj[s]) radj[t].push(s);
  }

  // 第一遍：原图 DFS，记录完成次序
  const order = [];
  const visited = new Uint8Array(m);
  for (let s = 0; s < m; s++) {
    if (visited[s]) continue;
    visited[s] = 1;
    const stack = [[s, 0]];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const node = top[0];
      if (top[1] < adj[node].length) {
        const t = adj[node][top[1]++];
        if (!visited[t]) {
          visited[t] = 1;
          stack.push([t, 0]);
        }
      } else {
        order.push(node);
        stack.pop();
      }
    }
  }

  // 第二遍：按完成次序逆序在反图上 DFS，一次 DFS 即一个分量
  const comp = new Int32Array(m).fill(-1);
  let nc = 0;
  for (let k = m - 1; k >= 0; k--) {
    const s = order[k];
    if (comp[s] !== -1) continue;
    comp[s] = nc;
    const stack = [s];
    while (stack.length > 0) {
      const node = stack.pop();
      for (const t of radj[node]) {
        if (comp[t] === -1) {
          comp[t] = nc;
          stack.push(t);
        }
      }
    }
    nc++;
  }

  return comp;
}
