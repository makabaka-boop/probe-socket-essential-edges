# 探针分配 · 最小权完美二分匹配

芯片老化台换批前，把等量探针（行）分配到测试座（列）。部分探针/测试座组合禁配，
不同组合有校准代价。服务端以 **O(n³) 匈牙利算法** 精确求解最小权完美二分匹配，
并额外标注哪些连线是**所有同价最优解都必须采用的必然连线**；
页面支持编辑代价矩阵、查看方案、排除单个配对后重算替代最优。

## 目录结构

```
server/
  hungarian.js    # O(n³) 最小权完美二分匹配（匈牙利算法，禁配边=Infinity），同时产出最优对偶势
  forcedEdges.js  # 必然连线分析：等子图强连通分量（迭代 Kosaraju，O(n²)）
  validation.js   # 输入校验（n、维度、整数范围）
  server.js       # Fastify：POST /api/solve + 生产环境静态托管
src/
  App.jsx                  # 页面：编辑、请求锁定、方案展示、必然/可替换标记、排除重算、本地复算
  components/MatrixGrid.jsx  # 虚拟化 n×n 矩阵（n=400 流畅），必然连线琥珀色高亮
test/
  hungarian.test.js  # 随机小矩阵 n! 穷举核对 + Hall 无解 + 大数精度
  forcedEdges.test.js# 必然连线：独立穷举全部最优解预言机核对（唯一/并列、禁配、断开图、零价）
  api.test.js        # HTTP：200/409/422 + 标记与预言机一致 + n=400 三秒性能
  app.test.jsx       # 页面：锁定编辑、编辑清旧方案、排除重算、标记随方案同次更新
verify/
  wait-http.mjs      # verify 容器等待 web 健康
Dockerfile           # web：Vite 构建 → Fastify 托管
Dockerfile.verify    # verify：Vitest 端到端验收镜像
docker-compose.yml
```

## 快速开始（Docker Compose）

```bash
# 通过 WEB_PORT 指定宿主机发布端口（默认 8080）
WEB_PORT=8080 docker compose up --build web
# 浏览器打开 http://localhost:8080
```

验收服务（对已启动的 web 容器发真实 HTTP 请求跑全部测试）：

```bash
docker compose up -d web
docker compose run --rm verify
```

verify 容器会等待 `http://web:3000/api/health` 就绪，再以
`TARGET_BASE_URL=http://web:3000` 运行 Vitest；API 测试自动切换为真实 HTTP 模式，
包含随机小矩阵穷举核对、Hall 无解矩阵、n=400 稠密矩阵 3 秒内精确返回。

## 本地开发

```bash
npm ci
npm run dev        # Vite 5173，/api 代理到 Fastify 3000
npm start          # 另一个终端启动 Fastify
npm test           # Vitest 全量测试
npm run build      # 产出 dist/，由 Fastify 生产托管
```

## 接口

`POST /api/solve`

请求：`{ "costs": number[][] }`

- n = costs.length，1 ≤ n ≤ 400，必须为 n×n 方阵
- 元素只能是 `null`（禁配）或 `0..1_000_000_000_000` 的整数
- 行=探针，列=测试座

成功 `200`：

```json
{
  "status": "ok",
  "n": 4,
  "assignment": [3, 0, 1, 2],
  "totalCost": 205,
  "analysis": {
    "forced": [true, true, true, true],
    "alternatives": [0, 0, 0, 0],
    "forcedCount": 4
  }
}
```

`assignment[i]` 为第 i 行探针匹配的列（0 基），是一个 0..n−1 的排列，
覆盖全部行与列；`totalCost` 为精确整数总和，可用配对对原矩阵直接复算。
存在多个最优解时任选其一，`analysis` 中的标记**逐条对应本次实际返回的配对**：

- `forced[i]`（必然连线）：配对 `(i, assignment[i])` 出现在**所有**同价最优完美匹配中，
  为 `true` 时该连线不可改动；
- `alternatives[i]`（可替换连线数量）：在不抬高总代价的前提下，
  第 i 行探针可以改配的其他列数（`forced[i]=true` 时恒为 0）；
- `forcedCount`：必然连线总数。

分析不改变求解结果：`assignment` 与 `totalCost` 与未加分析时完全一致；
响应只返回稳定的布尔/计数结论，不暴露势函数等算法中间态。

失败：

- `422 { "error": "INVALID_INPUT" }`：缺行、错维度、越界、非整数、JSON 非法等
- `409 { "error": "NO_PERFECT_ASSIGNMENT" }`：禁配关系下不存在完美匹配（违反 Hall 条件）

两类失败响应都不携带方案，也不携带 `analysis`，页面会清除旧方案与旧标记。
输入变化、无完美匹配或求解失败后，任何标记都不会残留；
“排除此配对”的重算与普通求解走同一接口，分析随新方案重新计算，不沿用排除前标记。

## 算法说明

标准 Hungarian（Kuhn–Munkres）势函数增广：维护行势 `u`、列势 `v` 与当前匹配 `p`，
每轮把一个新行挂到虚拟列 0，沿等势交错树用松弛 `a[i][j]-u[i]-v[j]` 扩展，
取最小 delta 平移势函数直到到达自由列，再回溯翻转增广。共 n 轮，每轮 O(n²)，
总计 **O(n³)**，不枚举任何排列。

- 禁配边以 `Infinity` 存储（`Float64Array.fill(Infinity)`），不参与松弛；
  若最小 delta 为 Infinity，说明自由列在允许子图中不可达（Hall 条件被破坏），
  立即返回无完美匹配。
- 代价最大 1e12、n 最大 400，总代价上界 4e14，小于 2^53，全程整数精确；
  总和直接对输入整数矩阵求和复算，不依赖势函数中间值。

### 必然连线分析（等子图强连通分量）

匈牙利算法终止时的对偶势满足 `c(i,j)-u[i]-v[j] >= 0`；简约代价为 0 的边构成
**等子图（equality graph）**，标准结论：一条边属于某个最优完美匹配，当且仅当它是
等子图边且属于等子图中的某个完美匹配。把等子图按当前匹配 M 定向
（匹配边 列→行、未匹配等边 行→列），则等子图中 M 的偶交错环与该有向图的有向环一一对应：

- 配对 `(i,j)` 出现在所有最优完美匹配中 ⟺ 行 i 与列 j 不在同一强连通分量（SCC）；
- 行 i 所在 SCC 内、从行 i 出发的每条未匹配等边都落在某个最优完美匹配里，
  其条数即 `alternatives[i]`。

SCC 用两遍迭代 DFS（Kosaraju，避免 n=400 深栈）计算，等子图最多 n² 条边，分析为
**O(n²)**，与 n=400 的求解合计仍远在三秒预算内。禁配边（`null`）不是等子图边，
天然不会混入；零价边与重复代价照常处理。正确性由独立穷举**全部**完美匹配的
预言机（`test/helpers.js` 的 `enumerateOptima`，仅用于小矩阵）对随机矩阵与构造用例
逐标记核对，覆盖唯一最优、多个同价最优、禁配与断开图。

## 页面交互约定

- 请求进行中：矩阵格、规模、预设、提交按钮全部禁用（锁定编辑与提交）。
- 请求结束后任何编辑（改格、改尺寸、预设）立即清除旧方案与错误。
- 每个配对可点“排除此配对”：该格被置为禁配（✕），经同一 `/api/solve` 重算，
  展示替代最优方案；若替代问题无解则显示 409 并清除旧方案。
  重算响应自带新的必然/可替换标记，与方案同一次更新，不会沿用排除前标记。
- 方案区对返回配对独立复算总代价并与服务端数值比对。
- 每条配对带 **必然 / 可替换×k** 标记：琥珀色“必然”表示所有同价最优方案都经过
  这条连线，绿色“可替换”表示存在不经过它的同价最优方案、括号内为可替换连线数量；
  对应矩阵格同步以琥珀色描边高亮必然连线。
