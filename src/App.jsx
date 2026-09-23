import React, { useMemo, useState, useCallback } from 'react';
import MatrixGrid from './components/MatrixGrid.jsx';

const MAX_N = 400;
const MAX_COST = 1_000_000_000_000;

function buildMatrix(n, old = null) {
  const m = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (old && old[i] && old[i][j] !== undefined ? old[i][j] : null))
  );
  return m;
}

function randomMatrix(n, forbiddenRate = 0) {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () =>
      forbiddenRate > 0 && Math.random() < forbiddenRate ? null : Math.floor(Math.random() * 10000)
    )
  );
}

export default function App() {
  const [nInput, setNInput] = useState('4');
  const [n, setN] = useState(4);
  const [matrix, setMatrix] = useState(() =>
    buildMatrix(4, [
      [90, 75, 120, 60],
      [35, 80, 55, 200],
      [110, 40, 95, 130],
      [65, 150, 70, 100],
    ])
  );
  const [loading, setLoading] = useState(false);
  // result 一次性携带方案与必然连线分析：{ assignment, totalCost, analysis, elapsedMs }
  // 编辑/失败/排除重算都会整体置 null，不会残留与当前矩阵不符的旧标记。
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null); // { status, code, message }
  const [excludedHint, setExcludedHint] = useState(null); // 刚刚排除的格

  // 编辑（尺寸变化、改格、预设）都会立即清除旧方案与错误。
  const clearPlan = useCallback(() => {
    setResult(null);
    setError(null);
    setExcludedHint(null);
  }, []);

  const applySize = () => {
    const next = Number(nInput);
    if (Number.isInteger(next) && next >= 1 && next <= MAX_N) {
      setN(next);
      setMatrix((old) => buildMatrix(next, old));
      clearPlan();
    }
  };

  const editCell = useCallback(
    (i, j, value) => {
      setMatrix((old) => {
        if (old[i][j] === value) return old;
        const copy = old.slice();
        copy[i] = old[i].slice();
        copy[i][j] = value;
        return copy;
      });
      // 请求结束后的任何编辑立即清除旧方案
      setResult(null);
      setError(null);
      setExcludedHint(null);
    },
    []
  );

  const solve = useCallback(async (costsOverride = null) => {
    const costs = costsOverride || matrix;
    setLoading(true);
    // 请求期间锁定编辑与提交：界面禁用，状态冻结
    setError(null);
    const started = performance.now();
    try {
      const resp = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costs }),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok && data && data.status === 'ok') {
        setResult({
          assignment: data.assignment,
          totalCost: data.totalCost,
          analysis: data.analysis || null, // { forced, alternatives, forcedCount }，与本次配对同源
          elapsedMs: Math.round(performance.now() - started),
        });
      } else {
        // 两类失败（422 / 409）都清除旧方案
        setResult(null);
        setError({
          status: resp.status,
          code: data?.error || 'ERROR',
          message: data?.message || '求解失败',
        });
      }
    } catch (err) {
      setResult(null);
      setError({ status: 0, code: 'NETWORK_ERROR', message: `网络错误：${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [matrix]);

  // 排除方案中的一个配对：该格设为禁配（null），经同一接口立即重算。
  const excludePair = useCallback(
    async (i, j) => {
      setExcludedHint({ i, j });
      const next = matrix.slice();
      next[i] = matrix[i].slice();
      next[i][j] = null;
      setMatrix(next);
      setResult(null);
      setError(null);
      await solve(next);
    },
    [matrix, solve]
  );

  const matchedSet = useMemo(() => {
    if (!result) return null;
    const s = new Set();
    result.assignment.forEach((j, i) => s.add(i * n + j));
    return s;
  }, [result, n]);

  // 必然连线格集合（与 matchedSet 同源，随 result 一起更新/清空）。
  const forcedSet = useMemo(() => {
    if (!result || !result.analysis) return null;
    const s = new Set();
    result.assignment.forEach((j, i) => {
      if (result.analysis.forced[i]) s.add(i * n + j);
    });
    return s;
  }, [result, n]);

  // 用返回的配对对原始矩阵独立复算总和，精确核对服务端结果。
  const recomputed = useMemo(() => {
    if (!result) return null;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const j = result.assignment[i];
      const c = matrix[i][j];
      if (c === null) return { sum: null, ok: false };
      sum += c;
    }
    return { sum, ok: sum === result.totalCost };
  }, [result, matrix, n]);

  const forbiddenCount = useMemo(() => {
    let c = 0;
    for (const row of matrix) for (const v of row) if (v === null) c++;
    return c;
  }, [matrix]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>芯片老化台 · 探针分配</h1>
        <p className="subtitle">
          最小权完美二分匹配（O(n³) 匈牙利算法）· 行为探针，列为测试座，空/✕ 为禁配
        </p>
      </header>

      <section className="controls">
        <label className="size-control">
          规模 n
          <input
            type="number"
            min="1"
            max={MAX_N}
            value={nInput}
            disabled={loading}
            onChange={(e) => setNInput(e.target.value)}
          />
          <button onClick={applySize} disabled={loading}>
            应用
          </button>
        </label>
        <button onClick={() => { setMatrix(buildMatrix(n)); clearPlan(); }} disabled={loading}>
          全部禁配
        </button>
        <button
          onClick={() => { setMatrix(randomMatrix(n, 0)); clearPlan(); }}
          disabled={loading}
        >
          随机稠密
        </button>
        <button
          onClick={() => { setMatrix(randomMatrix(n, 0.15)); clearPlan(); }}
          disabled={loading}
        >
          随机含禁配
        </button>
        <button className="primary" onClick={() => solve()} disabled={loading}>
          {loading ? '求解中…' : '求解最小分配'}
        </button>
        <span className="meta">
          n = {n} · 禁配 {forbiddenCount} 格
        </span>
      </section>

      {loading && (
        <div className="banner loading">
          请求进行中：编辑已锁定，等待服务器返回精确最优方案……
        </div>
      )}

      {error && (
        <div className={`banner error ${error.code === 'NO_PERFECT_ASSIGNMENT' ? 'conflict' : ''}`}>
          <strong>
            {error.code === 'NO_PERFECT_ASSIGNMENT'
              ? `409 NO_PERFECT_ASSIGNMENT（${error.status}）`
              : `${error.status || ''} ${error.code}`.trim()}
          </strong>
          <span>{error.message}</span>
          {excludedHint && (
            <span className="hint">
              （已排除探针 {excludedHint.i + 1} → 测试座 {excludedHint.j + 1}，该替代问题无完美匹配）
            </span>
          )}
        </div>
      )}

      {result && (
        <section className="result">
          <div className="result-head">
            <h2>最优分配方案</h2>
            <div className="totals">
              <span>
                最小总代价：<strong>{result.totalCost.toLocaleString('zh-CN')}</strong>
              </span>
              <span className="recompute" data-ok={recomputed.ok}>
                本地复算：{recomputed.sum === null ? '存在禁配格 ✗' : recomputed.sum.toLocaleString('zh-CN')}{' '}
                {recomputed.ok ? '✓ 与服务器一致' : '✗ 不一致'}
              </span>
              <span className="meta">耗时 {result.elapsedMs} ms</span>
            </div>
          </div>
          {result.analysis && (
            <div className="legend">
              <span className="legend-item">
                <span className="badge forced">必然</span>
                所有同价最优方案都经过这条连线，不可改动
              </span>
              <span className="legend-item">
                <span className="badge replaceable">可替换</span>
                存在不经过它的同价最优方案，括号内为可替换连线数量
              </span>
              <span className="meta">
                本方案必然连线 {result.analysis.forcedCount} 条 · 可替换{' '}
                {result.assignment.length - result.analysis.forcedCount} 条
              </span>
            </div>
          )}
          <div className="pairs">
            {result.assignment.map((j, i) => (
              <div
                key={i}
                className={`pair ${
                  result.analysis
                    ? result.analysis.forced[i]
                      ? 'forced'
                      : 'replaceable'
                    : ''
                } ${excludedHint && excludedHint.i === i && excludedHint.j === j ? 'just-excluded' : ''}`}
              >
                <span className="pair-label">
                  探针 {i + 1} → 座 {j + 1}
                </span>
                <span className="pair-cost">{matrix[i][j]?.toLocaleString('zh-CN')}</span>
                {result.analysis &&
                  (result.analysis.forced[i] ? (
                    <span
                      className="badge forced"
                      title="所有同价最优方案都包含这条连线，不可改动"
                    >
                      必然
                    </span>
                  ) : (
                    <span
                      className="badge replaceable"
                      title="存在不经过这条连线的同价最优方案"
                    >
                      可替换×{result.analysis.alternatives[i]}
                    </span>
                  ))}
                <button
                  className="exclude"
                  disabled={loading}
                  title="把该格设为禁配并重新求解替代最优方案"
                  onClick={() => excludePair(i, j)}
                >
                  排除此配对
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid-section">
        <MatrixGrid
          n={n}
          matrix={matrix}
          matchedSet={matchedSet}
          forcedSet={forcedSet}
          locked={loading}
          excludedHint={excludedHint}
          onEdit={editCell}
        />
      </section>
    </div>
  );
}
