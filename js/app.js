/*
 * 交互层：填色 / 框选存块 / 铺放三种模式的界面与鼠标交互，
 * 数据存取交给 data.js，铺放与统计算法交给 rules.js。
 */
(() => {
  const $ = sel => document.querySelector(sel);
  const grid = $("#grid");
  const paletteEl = $("#palette");
  const statsEl = $("#stats");
  const previewEl = $("#preview");
  const riskEl = $("#risk");
  const blockListEl = $("#blockList");
  const selInfoEl = $("#selInfo");
  const saveSelBtn = $("#saveSelBtn");
  const stampNameEl = $("#stampName");

  let paintDragging = false;

  const MODE_HINTS = {
    paint: "点击填色，按住拖动可连续填色；一次拖动算一次撤销。",
    select: "在网格上按住拖出矩形选框，松手后起名，保存为可铺放的纹样块。",
    stamp: "点击画布即以该格为左上角，按横纵次数铺放当前纹样块；越界舍去，范围外颜色不动，整次铺放算一次撤销。"
  };

  // ---------- 初始化 ----------
  function init(loadSaved = true) {
    const saved = loadSaved && Persistence.load();
    if (saved && Number.isInteger(saved.cols) && Number.isInteger(saved.rows) && Array.isArray(saved.cells)) {
      Store.cols = saved.cols;
      Store.rows = saved.rows;
      Store.cells = saved.cells.length === saved.cols * saved.rows
        ? saved.cells
        : Rules.newBlankCells(saved.cols, saved.rows);
      Store.blocks = Array.isArray(saved.blocks) ? saved.blocks : [];
    } else {
      Store.cols = Number($("#cols").value) || Store.cols;
      Store.rows = Number($("#rows").value) || Store.rows;
      Store.cells = Rules.newBlankCells(Store.cols, Store.rows);
    }
    $("#cols").value = Store.cols;
    $("#rows").value = Store.rows;
    Store.mode = "paint";
    Store.brush = "dot";
    Store.selection = null;
    Store.selecting = null;
    Store.hoverIndex = null;
    Store.stampBlockId = null;
    Store.undoStack = [];
    Store.redoStack = [];
    Store.blocks.forEach(b => { Store.repeats[b.id] = Store.repeats[b.id] || { x: 1, y: 1 }; });
    renderAll();
  }

  function newGrid() {
    Store.cols = Math.min(36, Math.max(6, Number($("#cols").value) || Store.cols));
    Store.rows = Math.min(32, Math.max(6, Number($("#rows").value) || Store.rows));
    $("#cols").value = Store.cols;
    $("#rows").value = Store.rows;
    Store.cells = Rules.newBlankCells(Store.cols, Store.rows);
    Store.undoStack = [];
    Store.redoStack = [];
    Store.selection = null;
    Store.selecting = null;
    Store.hoverIndex = null;
    Store.stampBlockId = null;
    Store.mode = "paint";
    renderAll();
    setStatus("已新建 " + Store.cols + "×" + Store.rows + " 空白网格，纹样块库保留。");
  }

  function renderAll() {
    renderPalette();
    renderBrushes();
    renderGrid();
    bindCells();
    renderBlockList();
    renderStats();
    updateModeUI();
  }

  // ---------- 色线库与笔刷 ----------
  function renderPalette() {
    paletteEl.innerHTML = COLORS.map((c, i) =>
      '<button type="button" class="swatch ' + (i === Store.activeColor ? "active" : "") +
      '" data-color="' + i + '" style="background:' + c + '" title="色线' + i + '"></button>'
    ).join("");
  }

  function renderBrushes() {
    document.querySelectorAll("[data-brush]").forEach(btn => {
      btn.classList.toggle("active", Store.mode === "paint" && btn.dataset.brush === Store.brush);
    });
  }

  paletteEl.addEventListener("click", e => {
    const el = e.target.closest("[data-color]");
    if (!el) return;
    Store.activeColor = Number(el.dataset.color);
    renderPalette();
  });

  document.querySelectorAll("[data-brush]").forEach(btn => {
    btn.addEventListener("click", () => {
      Store.brush = btn.dataset.brush;
      Store.mode = "paint";
      renderBrushes();
      updateModeUI();
    });
  });

  // ---------- 画布网格 ----------
  function renderGrid() {
    grid.style.gridTemplateColumns = "repeat(" + Store.cols + ", 1fr)";
    grid.dataset.mode = Store.mode;
    grid.innerHTML = Store.cells.map((v, i) =>
      '<div class="cell" data-i="' + i + '" style="background:' + COLORS[v] + '"></div>'
    ).join("");
  }

  function bindCells() {
    grid.querySelectorAll(".cell").forEach(el => {
      el.addEventListener("pointerdown", onCellDown);
      el.addEventListener("pointerenter", onCellEnter);
    });
  }

  function cellXY(el) {
    const i = Number(el.dataset.i);
    return { i, x: i % Store.cols, y: Math.floor(i / Store.cols) };
  }

  function onCellDown(e) {
    const { i, x, y } = cellXY(e.currentTarget);
    if (Store.mode === "paint") {
      paintDragging = true;
      Rules.snapshot();                 // 一次落笔只压一次撤销栈
      Rules.paintWithBrush(i);
      refreshCanvasColors();
    } else if (Store.mode === "select") {
      Store.selecting = { ax: x, ay: y, bx: x, by: y };
      updateOverlay();
    } else if (Store.mode === "stamp") {
      doStamp(i);
    }
  }

  function onCellEnter(e) {
    const { i, x, y } = cellXY(e.currentTarget);
    if (Store.mode === "paint") {
      if (!paintDragging) return;
      Rules.paintWithBrush(i);
      refreshCanvasColors();
    } else if (Store.mode === "select") {
      if (!Store.selecting) return;
      Store.selecting.bx = x;
      Store.selecting.by = y;
      updateOverlay();
    } else if (Store.mode === "stamp") {
      Store.hoverIndex = i;
      updateOverlay();
    }
  }

  window.addEventListener("pointerup", () => {
    paintDragging = false;
    if (Store.mode === "select" && Store.selecting) {
      const s = Store.selecting;
      Store.selection = Rules.normalizeSelection(s.ax, s.ay, s.bx, s.by);
      Store.selecting = null;
      renderSelectPanel();
      updateOverlay();
    }
  });

  grid.addEventListener("pointerleave", () => {
    if (Store.mode === "stamp") {
      Store.hoverIndex = null;
      updateOverlay();
    }
  });

  // 画布像素变化后只刷颜色，不重建格子（保留选框/落点高亮）
  function refreshCanvasColors() {
    for (let i = 0; i < Store.cells.length; i++) {
      grid.children[i].style.background = COLORS[Store.cells[i]];
    }
    renderStats();
  }

  // ---------- 模式切换 ----------
  $("#modePaintBtn").addEventListener("click", () => switchMode("paint"));
  $("#modeSelectBtn").addEventListener("click", () => switchMode("select"));
  $("#modeStampBtn").addEventListener("click", () => {
    if (!Store.blocks.length) {
      setStatus("纹样块库还是空的：请先用“框选存块”拖框保存一个纹样块。");
      return;
    }
    startStamp(Store.stampBlockId || Store.blocks[0].id);
  });

  function switchMode(mode) {
    Store.mode = mode;
    Store.selecting = null;
    Store.hoverIndex = null;
    if (mode !== "stamp") Store.stampBlockId = null;
    renderBrushes();
    updateModeUI();
  }

  function updateModeUI() {
    $("#modePaintBtn").classList.toggle("active", Store.mode === "paint");
    $("#modeSelectBtn").classList.toggle("active", Store.mode === "select");
    $("#modeStampBtn").classList.toggle("active", Store.mode === "stamp");
    grid.dataset.mode = Store.mode;
    $("#selectPanel").hidden = Store.mode !== "select";
    $("#stampPanel").hidden = Store.mode !== "stamp";
    $("#modeHint").textContent = MODE_HINTS[Store.mode];
    renderBrushes();
    renderSelectPanel();
    renderStampPanel();
    updateOverlay();
  }

  // ---------- 选框高亮 / 铺放落点预显 ----------
  function updateOverlay() {
    const kids = grid.children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.remove("selected", "stamp-hit", "stamp-anchor");
    }
    if (Store.mode === "select") {
      const rect = Store.selecting
        ? Rules.normalizeSelection(Store.selecting.ax, Store.selecting.ay, Store.selecting.bx, Store.selecting.by)
        : Store.selection;
      if (rect) markRect(kids, rect, "selected");
    } else if (Store.mode === "stamp" && Store.hoverIndex !== null) {
      const block = Rules.findBlock(Store.stampBlockId);
      if (block) {
        const ax = Store.hoverIndex % Store.cols;
        const ay = Math.floor(Store.hoverIndex / Store.cols);
        const fp = Rules.stampFootprint(block, ax, ay, Store.stampRepeatX, Store.stampRepeatY);
        fp.cells.forEach(c => kids[c.index].classList.add("stamp-hit"));
        kids[Store.hoverIndex].classList.add("stamp-anchor");
      }
    }
  }

  function markRect(kids, rect, cls) {
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        kids[y * Store.cols + x].classList.add(cls);
      }
    }
  }

  // ---------- 框选存块 ----------
  function renderSelectPanel() {
    if (!Store.selection) {
      selInfoEl.textContent = "尚未框选：在左侧网格上按住并拖出矩形。";
      saveSelBtn.disabled = true;
      return;
    }
    const s = Store.selection;
    const w = s.x1 - s.x0 + 1, h = s.y1 - s.y0 + 1;
    selInfoEl.textContent = "选区：第" + (s.y0 + 1) + "–" + (s.y1 + 1) + "行、第" +
      (s.x0 + 1) + "–" + (s.x1 + 1) + "列，共 " + w + "×" + h + " 格。";
    saveSelBtn.disabled = false;
  }

  saveSelBtn.addEventListener("click", () => {
    if (!Store.selection) return;
    const input = $("#blockName");
    const name = input.value.trim() || ("纹样块" + (Store.blocks.length + 1));
    const block = Rules.captureBlock(name, Store.selection);
    Store.blocks.push(block);
    Store.repeats[block.id] = { x: 1, y: 1 };
    Store.selection = null;
    input.value = "";
    patchStorage({ blocks: Store.blocks });
    renderBlockList();
    renderSelectPanel();
    updateOverlay();
    setStatus("已保存纹样块「" + name + "」（" + block.w + "×" + block.h + "），可在纹样块库中点“铺放”。");
  });

  $("#cancelSelBtn").addEventListener("click", () => {
    Store.selection = null;
    Store.selecting = null;
    renderSelectPanel();
    updateOverlay();
  });

  // ---------- 纹样块库 ----------
  function renderBlockList() {
    if (!Store.blocks.length) {
      blockListEl.innerHTML = '<div class="empty">暂无纹样块。切到“框选存块”，在网格上拖框起名保存。</div>';
      return;
    }
    blockListEl.innerHTML = Store.blocks.map(b => {
      const rep = Store.repeats[b.id] || (Store.repeats[b.id] = { x: 1, y: 1 });
      const tiles = b.cells.map(c =>
        '<span class="mini" style="background:' + COLORS[c] + '"></span>'
      ).join("");
      return '<div class="block-card" data-block-id="' + b.id + '">' +
        '<div class="block-head">' +
          '<span class="block-name">' + escapeHtml(b.name) + '</span>' +
          '<span class="block-size">' + b.w + '×' + b.h + '</span>' +
          '<button type="button" class="mini-btn stamp-use">铺放</button>' +
          '<button type="button" class="mini-btn secondary block-del" title="删除">删</button>' +
        "</div>" +
        '<div class="block-thumb-wrap"><div class="block-thumb" style="grid-template-columns:repeat(' + b.w + ',12px)">' +
          tiles +
        "</div></div>" +
        '<div class="block-repeat">' +
          '<label>横铺次数<input type="number" min="1" max="99" class="rep-x" value="' + rep.x + '"></label>' +
          '<label>纵铺次数<input type="number" min="1" max="99" class="rep-y" value="' + rep.y + '"></label>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  blockListEl.addEventListener("click", e => {
    const card = e.target.closest(".block-card");
    if (!card) return;
    const id = card.dataset.blockId;
    if (e.target.closest(".stamp-use")) startStamp(id);
    else if (e.target.closest(".block-del")) {
      const block = Rules.findBlock(id);
      if (!block) return;
      if (!window.confirm("确定删除纹样块「" + block.name + "」？画布上已铺好的颜色不受影响。")) return;
      Store.blocks = Store.blocks.filter(b => b.id !== id);
      delete Store.repeats[id];
      if (Store.stampBlockId === id) switchMode("paint");
      patchStorage({ blocks: Store.blocks });
      renderBlockList();
      setStatus("已删除纹样块「" + block.name + "」。");
    }
  });

  blockListEl.addEventListener("input", e => {
    const card = e.target.closest(".block-card");
    if (!card) return;
    const id = card.dataset.blockId;
    const rep = Store.repeats[id] || (Store.repeats[id] = { x: 1, y: 1 });
    if (e.target.classList.contains("rep-x")) rep.x = clampRepeat(e.target.value);
    if (e.target.classList.contains("rep-y")) rep.y = clampRepeat(e.target.value);
  });

  function clampRepeat(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.min(99, Math.max(1, n));
  }

  // ---------- 铺放 ----------
  function startStamp(id) {
    const block = Rules.findBlock(id);
    if (!block) return;
    const rep = Store.repeats[id] || (Store.repeats[id] = { x: 1, y: 1 });
    Store.mode = "stamp";
    Store.stampBlockId = id;
    Store.stampRepeatX = rep.x;
    Store.stampRepeatY = rep.y;
    Store.hoverIndex = null;
    updateModeUI();
    setStatus("铺放「" + block.name + "」：在画布上点选左上角落点（横 " + rep.x + " 次、纵 " + rep.y + " 次）。");
  }

  function renderStampPanel() {
    const block = Rules.findBlock(Store.stampBlockId);
    stampNameEl.textContent = block
      ? "「" + block.name + "」单元 " + block.w + "×" + block.h + " 格"
      : "未选择纹样块";
    $("#stampRepeatX").value = Store.stampRepeatX;
    $("#stampRepeatY").value = Store.stampRepeatY;
  }

  function syncStampRepeats() {
    Store.stampRepeatX = clampRepeat($("#stampRepeatX").value);
    Store.stampRepeatY = clampRepeat($("#stampRepeatY").value);
    if (Store.stampBlockId) Store.repeats[Store.stampBlockId] = { x: Store.stampRepeatX, y: Store.stampRepeatY };
    $("#stampRepeatX").value = Store.stampRepeatX;
    $("#stampRepeatY").value = Store.stampRepeatY;
  }

  ["#stampRepeatX", "#stampRepeatY"].forEach(sel => {
    $(sel).addEventListener("input", () => {
      syncStampRepeats();
      updateOverlay();
    });
  });

  $("#cancelStampBtn").addEventListener("click", () => switchMode("paint"));

  function doStamp(i) {
    const block = Rules.findBlock(Store.stampBlockId);
    if (!block) {
      setStatus("请先在纹样块库中点“铺放”选择一个纹样块。");
      return;
    }
    syncStampRepeats();
    const ax = i % Store.cols;
    const ay = Math.floor(i / Store.cols);
    Rules.snapshot();                       // 整次铺放只算一次撤销
    const r = Rules.applyStamp(block, ax, ay, Store.stampRepeatX, Store.stampRepeatY);
    Store.hoverIndex = null;
    refreshCanvasColors();
    updateOverlay();
    let msg = "已铺放「" + block.name + "」" + Store.stampRepeatX + "×" + Store.stampRepeatY +
      "：落格 " + r.painted + " 格";
    msg += r.clippedCells ? "，越界舍去 " + r.clippedCells + " 格。" : "。";
    setStatus(msg + " 可撤销。");
  }

  // ---------- 撤销重做 / 新建 / 保存 / 导出 ----------
  $("#undoBtn").addEventListener("click", () => {
    if (Rules.undo()) {
      refreshCanvasColors();
      updateOverlay();
      setStatus("已撤销。");
    }
  });
  $("#redoBtn").addEventListener("click", () => {
    if (Rules.redo()) {
      refreshCanvasColors();
      updateOverlay();
      setStatus("已重做。");
    }
  });
  $("#newBtn").addEventListener("click", newGrid);
  $("#saveBtn").addEventListener("click", () => {
    Persistence.save();
    setStatus("方案（画布 + " + Store.blocks.length + " 个纹样块）已保存到本机浏览器。");
  });
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(Rules.exportData(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "brocade-pattern.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- 统计 / 预览 / 断线风险（均按合并画布重算） ----------
  function renderStats() {
    const usage = Rules.colorUsage();
    statsEl.innerHTML = usage.map(u =>
      '<div class="stat"><span><span style="display:inline-block;width:14px;height:14px;background:' +
      u.color + '"></span> 色线' + u.index + "</span><b>" + u.count + "</b></div>"
    ).join("");

    previewEl.innerHTML = Rules.repeatUnit().map(v =>
      '<div class="mini" style="background:' + (v === null ? "#e6dcc9" : COLORS[v]) + '"></div>'
    ).join("");

    const riskyRows = Rules.breakRisk();
    riskEl.innerHTML = riskyRows.length
      ? '<p class="warning">第' + riskyRows.join("、") + '行换色过密，可能断线。</p>'
      : "<p>暂无明显断线风险。</p>";
  }

  // ---------- 小工具 ----------
  function setStatus(msg) {
    $("#statusMsg").textContent = msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  // 纹样块库增删后即时落库（只替换 blocks，不影响尚未保存的画布）
  function patchStorage(patch) {
    const cur = Persistence.load() || {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(cur, patch)));
  }

  init();
})();
