/*
 * 数据层（data.js）
 * 管理画布格数据、色线库、已保存纹样块与撤销/重做历史，
 * 负责 localStorage 的读写；本文件不出现任何 DOM 操作。
 */
(function () {
  const STORAGE_KEY = "zfl31Pattern";

  // 色线库，索引 0 为底布色
  const colors = ["#f7e7c4", "#a6322d", "#1f5f78", "#d6a437", "#355b38", "#713d7b", "#1e1b18", "#e98c52"];

  const state = {
    colors: colors,
    cols: 18,
    rows: 14,
    cells: [],            // 整幅画布，每格存色线索引
    activeColor: 1,       // 当前填色索引
    stamp: "dot",         // 基础填色图章：dot | cross | diamond
    mode: "paint",        // 工具模式：paint 填色 | select 框选
    blocks: [],           // 已保存、可铺放的纹样块
    activeBlockId: null,  // 当前选中用于铺放的纹样块
    selection: null,      // 框选矩形（格坐标，含端点）：{x1,y1,x2,y2}
    undoStack: [],
    redoStack: [],
  };

  let blockSeq = 0;

  function isBlock(b) {
    return b && typeof b.name === "string"
      && Number.isInteger(b.width) && b.width > 0
      && Number.isInteger(b.height) && b.height > 0
      && Array.isArray(b.data) && b.data.length === b.width * b.height
      && b.data.every(v => Number.isInteger(v) && v >= 0 && v < colors.length);
  }

  function stripBlock(b) {
    return { id: b.id, name: b.name, width: b.width, height: b.height, data: b.data.slice() };
  }

  // 读档；无有效存档时按 fallbackCols/fallbackRows 建空白画布
  function load(fallbackCols, fallbackRows) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { saved = null; }

    const valid = saved
      && Number.isInteger(saved.cols) && Number.isInteger(saved.rows)
      && Array.isArray(saved.cells)
      && saved.cells.length === saved.cols * saved.rows;

    if (valid) {
      state.cols = saved.cols;
      state.rows = saved.rows;
      state.cells = saved.cells.slice();
      state.blocks = Array.isArray(saved.blocks)
        ? saved.blocks.filter(isBlock).map(b => ({
            id: typeof b.id === "string" && b.id ? b.id : "block_" + (++blockSeq),
            name: b.name,
            width: b.width,
            height: b.height,
            data: b.data.slice(),
          }))
        : [];
    } else {
      reset(fallbackCols, fallbackRows);
      state.blocks = [];
    }

    state.activeBlockId = state.blocks.length ? state.blocks[0].id : null;
    state.selection = null;
    state.undoStack = [];
    state.redoStack = [];
  }

  // 新建空白网格：画布与历史清空，纹样块作为资产保留
  function reset(cols, rows) {
    state.cols = cols;
    state.rows = rows;
    state.cells = Array(cols * rows).fill(0);
    state.selection = null;
    state.undoStack = [];
    state.redoStack = [];
  }

  // 本地保存（画布 + 纹样块）
  function persist() {
    const doc = {
      cols: state.cols,
      rows: state.rows,
      cells: state.cells,
      blocks: state.blocks.map(stripBlock),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  }

  // 导出 JSON（画布 + 纹样块 + 用色统计）；counts 由规则层算好传入
  function buildExport(counts) {
    return {
      cols: state.cols,
      rows: state.rows,
      cells: state.cells.slice(),
      blocks: state.blocks.map(stripBlock),
      usage: colors.map((color, i) => ({ color: color, count: counts[i] })),
    };
  }

  // ---- 撤销/重做：栈中存放整幅画布快照 ----
  function snapshot() {
    state.undoStack.push(state.cells.slice());
    state.redoStack = [];
    if (state.undoStack.length > 50) state.undoStack.shift();
  }

  function undo() {
    if (!state.undoStack.length) return false;
    state.redoStack.push(state.cells.slice());
    state.cells = state.undoStack.pop();
    state.selection = null;
    return true;
  }

  function redo() {
    if (!state.redoStack.length) return false;
    state.undoStack.push(state.cells.slice());
    state.cells = state.redoStack.pop();
    state.selection = null;
    return true;
  }

  // ---- 纹样块 ----
  function addBlock(name, width, height, data) {
    const block = {
      id: "block_" + Date.now().toString(36) + "_" + (++blockSeq),
      name: name,
      width: width,
      height: height,
      data: data.slice(),
    };
    state.blocks.push(block);
    state.activeBlockId = block.id;
    return block;
  }

  function removeBlock(id) {
    const i = state.blocks.findIndex(b => b.id === id);
    if (i < 0) return;
    state.blocks.splice(i, 1);
    if (state.activeBlockId === id) {
      state.activeBlockId = state.blocks.length
        ? state.blocks[Math.min(i, state.blocks.length - 1)].id
        : null;
    }
  }

  function findBlock(id) {
    return state.blocks.find(b => b.id === id) || null;
  }

  Object.assign(state, {
    load: load,
    reset: reset,
    persist: persist,
    buildExport: buildExport,
    snapshot: snapshot,
    undo: undo,
    redo: redo,
    addBlock: addBlock,
    removeBlock: removeBlock,
    findBlock: findBlock,
  });

  window.AppData = state;
})();
