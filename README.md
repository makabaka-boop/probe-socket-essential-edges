# 探针分配 · 最小权完美二分匹配

芯片老化台换批前，把等量探针（行）分配到测试座（列）。部分探针/测试座组合禁配，
不同组合有校准代价。服务端以 **O(n³) 匈牙利算法** 精确求解最小权完美二分匹配，
页面支持编辑代价矩阵、查看方案、排除单个配对后重算替代最优。

## 目录结构

```
server/
  hungarian.js    # O(n³) 最小权完美二分匹配（匈牙利算法，禁配边=Infinity）
  validation.js   # 输入校验（n、维度、整数范围）
  server.js       # Fastify：POST /api/solve + 生产环境静态托管
src/
  App.jsx                  # 页面：编辑、请求锁定、方案展示、排除重算、本地复算
  components/MatrixGrid.jsx  # 虚拟化 n×n 矩阵（n=400 流畅）
test/
  hungarian.test.js  # 随机小矩阵 n! 穷举核对 + Hall 无解 + 大数精度
  api.test.js        # HTTP：200/409/422 + n=400 三秒性能
  app.test.jsx       # 页面：锁定编辑、编辑清旧方案、排除重算、失败清方案
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
  "totalCost": 205
}
```

`assignment[i]` 为第 i 行探针匹配的列（0 基），是一个 0..n−1 的排列，
覆盖全部行与列；`totalCost` 为精确整数总和，可用配对对原矩阵直接复算。
存在多个最优解时任选其一。

失败：

- `422 { "error": "INVALID_INPUT" }`：缺行、错维度、越界、非整数、JSON 非法等
- `409 { "error": "NO_PERFECT_ASSIGNMENT" }`：禁配关系下不存在完美匹配（违反 Hall 条件）

两类失败响应都不携带方案，页面会清除旧方案。

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

## 页面交互约定

- 请求进行中：矩阵格、规模、预设、提交按钮全部禁用（锁定编辑与提交）。
- 请求结束后任何编辑（改格、改尺寸、预设）立即清除旧方案与错误。
- 每个配对可点“排除此配对”：该格被置为禁配（✕），经同一 `/api/solve` 重算，
  展示替代最优方案；若替代问题无解则显示 409 并清除旧方案。
- 方案区对返回配对独立复算总代价并与服务端数值比对。
