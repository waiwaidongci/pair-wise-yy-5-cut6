/*
 * 规则层（rules.js）
 * 纯计算：图章落点、框选矩形、纹样块截取、横纵铺放（越界舍去）、
 * 以及合并画布上的用色统计、重复单元预览、断线风险。
 * 本文件不读写 state.cells 之外的任何状态，不接触 DOM。
 */
(function () {
  const data = window.AppData;

  // 格坐标 → 一维索引，越界返回 null
  function idx(cols, rows, x, y) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return null;
    return y * cols + x;
  }

  // 基础图章（单点/十字/小菱形）相对点击格的落点
  function stampTargets(i) {
    const cols = data.cols, rows = data.rows;
    const x = i % cols, y = Math.floor(i / cols);
    let points;
    if (data.stamp === "cross") {
      points = [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    } else if (data.stamp === "diamond") {
      points = [[x, y - 1], [x - 1, y], [x, y], [x + 1, y], [x, y + 1]];
    } else {
      points = [[x, y]];
    }
    return points.map(p => idx(cols, rows, p[0], p[1])).filter(v => v !== null);
  }

  // 归一化框选矩形（含两个端点）
  function normalizeRect(x1, y1, x2, y2) {
    return {
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
    };
  }

  // 判断格是否落在矩形内
  function rectContains(rect, x, y) {
    return rect && x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
  }

  // 从画布截取纹样块，返回 { width, height, data }
  function extractBlock(rect) {
    const width = rect.x2 - rect.x1 + 1;
    const height = rect.y2 - rect.y1 + 1;
    const cellsData = [];
    for (let y = rect.y1; y <= rect.y2; y++) {
      for (let x = rect.x1; x <= rect.x2; x++) {
        cellsData.push(data.cells[y * data.cols + x]);
      }
    }
    return { width: width, height: height, data: cellsData };
  }

  /*
   * 纹样块按横纵次数铺放到 (startX, startY)：
   * 只返回落在画布内的目标格 → 颜色 的覆盖列表；
   * 越界格舍去，范围外的格子不动。整块含底布色一并覆盖。
   */
  function tilePlan(block, startX, startY, repeatX, repeatY) {
    const writes = [];
    for (let ry = 0; ry < repeatY; ry++) {
      for (let rx = 0; rx < repeatX; rx++) {
        const originX = startX + rx * block.width;
        const originY = startY + ry * block.height;
        for (let by = 0; by < block.height; by++) {
          for (let bx = 0; bx < block.width; bx++) {
            const target = idx(data.cols, data.rows, originX + bx, originY + by);
            if (target !== null) {
              writes.push({ index: target, color: block.data[by * block.width + bx] });
            }
          }
        }
      }
    }
    return writes;
  }

  // 合并画布上的各色线用量
  function countColors(cells) {
    return data.colors.map((_, i) => cells.filter(v => v === i).length);
  }

  // 左上角 6×6 重复单元预览（画布不足 6 时重复现有格补齐）
  function previewUnit(cells) {
    const n = 6;
    const out = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        out.push(cells[(x % data.cols) + (y % data.rows) * data.cols] ?? 0);
      }
    }
    return out;
  }

  // 断线风险：逐行统计换色次数，超过该行格数 62% 即告警
  function brokenThreadRows(cells) {
    const riskRows = [];
    for (let y = 0; y < data.rows; y++) {
      let switches = 0;
      for (let x = 1; x < data.cols; x++) {
        if (cells[y * data.cols + x] !== cells[y * data.cols + x - 1]) switches++;
      }
      if (switches > data.cols * 0.62) riskRows.push(y + 1);
    }
    return riskRows;
  }

  window.AppRules = {
    stampTargets: stampTargets,
    normalizeRect: normalizeRect,
    rectContains: rectContains,
    extractBlock: extractBlock,
    tilePlan: tilePlan,
    countColors: countColors,
    previewUnit: previewUnit,
    brokenThreadRows: brokenThreadRows,
  };
})();
