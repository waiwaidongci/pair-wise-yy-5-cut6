/*
 * 规则层：纹样块的捕获、铺放、越界裁剪、撤销快照，
 * 以及铺完后按“合并画布”重算的用色统计、重复单元预览、断线风险，还有导出数据组装。
 * 不碰 DOM，纯数据运算，方便交互层直接调用。
 */
const Rules = {
  // ---- 坐标工具 ----
  inBounds(x, y) {
    return x >= 0 && x < Store.cols && y >= 0 && y < Store.rows;
  },
  indexOf(x, y) {
    return this.inBounds(x, y) ? y * Store.cols + x : null;
  },

  newBlankCells(cols, rows) {
    return Array(cols * rows).fill(0);
  },

  // 把拖动起止点规范化为左上 / 右下（含端点）
  normalizeSelection(ax, ay, bx, by) {
    return {
      x0: Math.max(0, Math.min(ax, bx)),
      y0: Math.max(0, Math.min(ay, by)),
      x1: Math.min(Store.cols - 1, Math.max(ax, bx)),
      y1: Math.min(Store.rows - 1, Math.max(ay, by))
    };
  },

  // 从合并画布上把矩形区域捕获成一个可保存的纹样块
  captureBlock(name, sel) {
    const w = sel.x1 - sel.x0 + 1;
    const h = sel.y1 - sel.y0 + 1;
    const data = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        data.push(Store.cells[(sel.y0 + y) * Store.cols + (sel.x0 + x)]);
      }
    }
    return {
      id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || "未命名纹样",
      w, h,
      cells: data
    };
  },

  findBlock(id) {
    return Store.blocks.find(b => b.id === id) || null;
  },

  // 基础笔刷落点（沿用原有单点 / 十字 / 小菱形规则）
  brushTargets(i) {
    const x = i % Store.cols;
    const y = Math.floor(i / Store.cols);
    const idx = (a, b) => this.indexOf(a, b);
    if (Store.brush === "cross") {
      return [i, idx(x - 1, y), idx(x + 1, y), idx(x, y - 1), idx(x, y + 1)]
        .filter(v => v !== null);
    }
    if (Store.brush === "diamond") {
      return [idx(x, y - 1), idx(x - 1, y), i, idx(x + 1, y), idx(x, y + 1)]
        .filter(v => v !== null);
    }
    return [i];
  },

  // ---- 撤销：每次铺放 / 每次落笔只算一次撤销 ----
  snapshot() {
    Store.undoStack.push([...Store.cells]);
    Store.redoStack = [];
    if (Store.undoStack.length > 50) Store.undoStack.shift();
  },
  undo() {
    if (!Store.undoStack.length) return false;
    Store.redoStack.push([...Store.cells]);
    Store.cells = Store.undoStack.pop();
    return true;
  },
  redo() {
    if (!Store.redoStack.length) return false;
    Store.undoStack.push([...Store.cells]);
    Store.cells = Store.redoStack.pop();
    return true;
  },

  paintWithBrush(i) {
    const targets = this.brushTargets(i);
    targets.forEach(t => { Store.cells[t] = Store.activeColor; });
    return targets.length;
  },

  // 计算纹样块从锚点 (anchorX, anchorY) 起、按横纵次数铺放时实际落到画布的格子。
  // 越界的副本与格子直接舍去；范围内（含块内的地色 0）原样覆盖，
  // 铺放范围外的画布颜色不动。
  stampFootprint(block, anchorX, anchorY, repeatX, repeatY) {
    const cells = []; // {index, color}
    let clippedCells = 0; // 落在画布外被舍去的块格数
    for (let ry = 0; ry < repeatY; ry++) {
      for (let rx = 0; rx < repeatX; rx++) {
        for (let by = 0; by < block.h; by++) {
          for (let bx = 0; bx < block.w; bx++) {
            const x = anchorX + rx * block.w + bx;
            const y = anchorY + ry * block.h + by;
            const color = block.cells[by * block.w + bx];
            const idx = this.indexOf(x, y);
            if (idx === null) clippedCells++;
            else cells.push({ index: idx, color });
          }
        }
      }
    }
    return { cells, clippedCells };
  },

  // 执行一次铺放（调用方负责先 snapshot，保证整次铺放算一次撤销）
  applyStamp(block, anchorX, anchorY, repeatX, repeatY) {
    const fp = this.stampFootprint(block, anchorX, anchorY, repeatX, repeatY);
    fp.cells.forEach(c => { Store.cells[c.index] = c.color; });
    return {
      painted: fp.cells.length,
      clippedCells: fp.clippedCells,
      totalCells: block.w * block.h * repeatX * repeatY
    };
  },

  // ---- 以下三项均按合并后的当前画布重算 ----

  // 用色统计
  colorUsage() {
    return COLORS.map((color, i) => ({
      color,
      index: i,
      count: Store.cells.filter(v => v === i).length
    }));
  },

  // 重复单元预览：取画布左上角 6×6（越界列回退到已有列，沿用原口径）
  repeatUnit(span = 6) {
    const out = [];
    for (let i = 0; i < span * span; i++) {
      const x = i % span;
      const y = Math.floor(i / span);
      const idx = x < Store.cols && y < Store.rows ? y * Store.cols + x : null;
      out.push(idx === null ? null : Store.cells[idx]);
    }
    return out;
  },

  // 断线风险：某一行换色次数超过该行格子数的 62% 即提示
  breakRisk() {
    const riskyRows = [];
    for (let y = 0; y < Store.rows; y++) {
      let switches = 0;
      for (let x = 1; x < Store.cols; x++) {
        if (Store.cells[y * Store.cols + x] !== Store.cells[y * Store.cols + x - 1]) switches++;
      }
      if (switches > Store.cols * 0.62) riskyRows.push(y + 1);
    }
    return riskyRows;
  },

  // 导出 JSON：画布与纹样块块库一并带上
  exportData() {
    return {
      cols: Store.cols,
      rows: Store.rows,
      cells: Store.cells,
      blocks: Store.blocks,
      usage: this.colorUsage()
    };
  }
};
