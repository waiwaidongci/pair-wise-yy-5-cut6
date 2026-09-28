/*
 * 交互层（interact.js）
 * 负责 DOM 渲染与事件绑定：填色、框选存块、纹样块铺放、
 * 撤销/重做、新建网格、保存与导出。数据和计算分别调用 AppData / AppRules。
 */
(function () {
  const data = window.AppData;
  const rules = window.AppRules;

  const grid = document.querySelector("#grid");
  const palette = document.querySelector("#palette");
  const stats = document.querySelector("#stats");
  const preview = document.querySelector("#preview");
  const risk = document.querySelector("#risk");

  const modePaintBtn = document.querySelector("#modePaint");
  const modeSelectBtn = document.querySelector("#modeSelect");
  const modeHint = document.querySelector("#modeHint");

  const blockCreate = document.querySelector("#blockCreate");
  const blockName = document.querySelector("#blockName");
  const saveBlockBtn = document.querySelector("#saveBlockBtn");
  const selectTip = document.querySelector("#selectTip");

  const blockList = document.querySelector("#blockList");
  const repeatXInput = document.querySelector("#repeatX");
  const repeatYInput = document.querySelector("#repeatY");
  const startXInput = document.querySelector("#startX");
  const startYInput = document.querySelector("#startY");
  const pickStartBtn = document.querySelector("#pickStartBtn");
  const tileBtn = document.querySelector("#tileBtn");

  let painting = false;   // 正在拖动连续填色
  let selecting = false;  // 正在拖出框选矩形
  let pickingStart = false; // 等待在画布上点选铺放起点

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  // ---- 渲染 ----
  function render() {
    renderPalette();
    renderGrid();
    renderModes();
    renderBlockForm();
    renderBlocks();
    renderStats();
  }

  function renderPalette() {
    palette.innerHTML = data.colors.map((c, i) =>
      '<button class="swatch ' + (i === data.activeColor ? "active" : "") +
      '" data-color="' + i + '" style="background:' + c + '"></button>'
    ).join("");
    palette.querySelectorAll("[data-color]").forEach(el => {
      el.onclick = () => { data.activeColor = Number(el.dataset.color); render(); };
    });
  }

  function renderGrid() {
    grid.style.gridTemplateColumns = "repeat(" + data.cols + ", 1fr)";
    grid.classList.toggle("selecting", data.mode === "select" || pickingStart);
    grid.innerHTML = data.cells.map((v, i) => {
      const x = i % data.cols, y = Math.floor(i / data.cols);
      const inSel = rules.rectContains(data.selection, x, y);
      return '<div class="cell' + (inSel ? " selected" : "") + '" data-i="' + i +
        '" style="background:' + data.colors[v] + '"></div>';
    }).join("");
    grid.querySelectorAll(".cell").forEach(el => {
      el.onpointerdown = onCellDown;
      el.onpointerenter = onCellEnter;
    });
  }

  function renderModes() {
    modePaintBtn.classList.toggle("active", data.mode === "paint" && !pickingStart);
    modeSelectBtn.classList.toggle("active", data.mode === "select");
    modePaintBtn.classList.toggle("secondary", !(data.mode === "paint" && !pickingStart));
    modeSelectBtn.classList.toggle("secondary", data.mode !== "select");
    if (pickingStart) {
      modeHint.textContent = "点取模式：请在画布上点击铺放起点格。";
    } else if (data.mode === "select") {
      modeHint.textContent = "框选模式：在画布上按住拖出矩形，松开即可起名保存。";
    } else {
      modeHint.textContent = "填色模式：点击填色，按住拖动可连续填色。";
    }
  }

  function renderBlockForm() {
    const sel = data.selection;
    if (sel) {
      const w = sel.x2 - sel.x1 + 1, h = sel.y2 - sel.y1 + 1;
      blockCreate.classList.remove("hidden");
      blockName.placeholder = "纹样块 " + (data.blocks.length + 1) + "（" + w + "×" + h + "）";
      selectTip.classList.add("hidden");
    } else {
      blockCreate.classList.add("hidden");
      blockName.value = "";
      selectTip.classList.remove("hidden");
    }
  }

  function blockMiniHtml(block) {
    return '<div class="block-mini" style="grid-template-columns:repeat(' + block.width +
      ',1fr">' + block.data.map(v =>
        '<span class="block-mini-cell" style="background:' + data.colors[v] + '"></span>'
      ).join("") + "</div>";
  }

  function renderBlocks() {
    if (!data.blocks.length) {
      blockList.innerHTML = '<p class="muted">还没有保存的纹样块，先在框选模式里拖一个矩形。</p>';
      tileBtn.disabled = true;
      return;
    }
    blockList.innerHTML = data.blocks.map(b =>
      '<div class="block-item' + (b.id === data.activeBlockId ? " active" : "") + '" data-id="' + b.id + '">' +
        blockMiniHtml(b) +
        '<div class="block-meta"><b>' + escapeHtml(b.name) + '</b><span>' + b.width + "×" + b.height + "</span></div>" +
        '<button class="block-del" data-del="' + b.id + '" title="删除">×</button>' +
      "</div>"
    ).join("");
    blockList.querySelectorAll("[data-id]").forEach(el => {
      el.onclick = e => {
        if (e.target.closest("[data-del]")) return;
        data.activeBlockId = el.dataset.id;
        render();
      };
    });
    blockList.querySelectorAll("[data-del]").forEach(el => {
      el.onclick = e => {
        e.stopPropagation();
        data.removeBlock(el.dataset.del);
        render();
      };
    });
    tileBtn.disabled = false;
  }

  // 用色统计 / 重复单元预览 / 断线风险均按当前合并画布重算
  function renderStats() {
    const counts = rules.countColors(data.cells);
    stats.innerHTML = counts.map((n, i) =>
      '<div class="stat"><span><span class="chip" style="background:' + data.colors[i] +
      '"></span> 色线' + i + "</span><b>" + n + "</b></div>"
    ).join("");

    const unit = rules.previewUnit(data.cells);
    preview.innerHTML = unit.map(v =>
      '<div class="mini" style="background:' + data.colors[v] + '"></div>'
    ).join("");

    const riskRows = rules.brokenThreadRows(data.cells);
    risk.innerHTML = riskRows.length
      ? '<p class="warning">第' + riskRows.join("、") + "行换色过密，可能断线。</p>"
      : '<p>暂无明显断线风险。</p>';
  }

  // ---- 画布手势 ----
  function onCellDown(e) {
    e.preventDefault();
    const i = Number(e.currentTarget.dataset.i);
    if (pickingStart) {
      startXInput.value = (i % data.cols) + 1;
      startYInput.value = Math.floor(i / data.cols) + 1;
      pickingStart = false;
      render();
      return;
    }
    if (data.mode === "select") {
      selecting = true;
      data.selection = rules.normalizeRect(i % data.cols, Math.floor(i / data.cols), i % data.cols, Math.floor(i / data.cols));
      renderGrid();
      return;
    }
    painting = true;
    paintAt(i);
  }

  function onCellEnter(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (painting && data.mode === "paint") paintAt(i);
    if (selecting) {
      const x1 = data.selection.x1, y1 = data.selection.y1;
      data.selection = rules.normalizeRect(x1, y1, i % data.cols, Math.floor(i / data.cols));
      renderGrid();
    }
  }

  window.addEventListener("pointerup", () => {
    if (painting) painting = false;
    if (selecting) {
      selecting = false;
      renderBlockForm();
      if (data.selection) blockName.focus();
    }
  });

  function paintAt(i) {
    data.snapshot();
    rules.stampTargets(i).forEach(t => { data.cells[t] = data.activeColor; });
    render();
  }

  // ---- 工具按钮 ----
  modePaintBtn.onclick = () => { data.mode = "paint"; pickingStart = false; render(); };
  modeSelectBtn.onclick = () => { data.mode = "select"; pickingStart = false; render(); };

  saveBlockBtn.onclick = () => {
    const sel = data.selection;
    if (!sel) return;
    const cut = rules.extractBlock(sel);
    const name = blockName.value.trim() || ("纹样块 " + (data.blocks.length + 1));
    data.addBlock(name, cut.width, cut.height, cut.data);
    data.selection = null;
    blockName.value = "";
    data.mode = "paint";
    flash(blockCreate, "已保存「" + name + "」");
    render();
  };

  pickStartBtn.onclick = () => {
    pickingStart = !pickingStart;
    renderModes();
    renderGrid();
  };

  tileBtn.onclick = () => {
    const block = data.findBlock(data.activeBlockId);
    if (!block) return;
    const repeatX = Math.min(96, Math.max(1, parseInt(repeatXInput.value, 10) || 1));
    const repeatY = Math.min(96, Math.max(1, parseInt(repeatYInput.value, 10) || 1));
    repeatXInput.value = repeatX;
    repeatYInput.value = repeatY;
    // 界面为 1 起的格号，内部转 0 基坐标
    const startX = (parseInt(startXInput.value, 10) || 1) - 1;
    const startY = (parseInt(startYInput.value, 10) || 1) - 1;

    const writes = rules.tilePlan(block, startX, startY, repeatX, repeatY);
    if (!writes.length) {
      flash(tileBtn, "铺放位置全部越界，没有写入任何格");
      return;
    }
    data.snapshot(); // 整次铺放只记一次撤销
    writes.forEach(w => { data.cells[w.index] = w.color; });
    render();
    const clipped = repeatX * repeatY * block.width * block.height - writes.length;
    flash(tileBtn, clipped
      ? "已铺放 " + writes.length + " 格，越界舍去 " + clipped + " 格"
      : "已铺放 " + writes.length + " 格");
  };

  let flashTimer = null;
  function flash(anchor, text) {
    const host = anchor.parentElement;
    const children = host && host.children ? Array.from(host.children) : [];
    let el = children.find(c => c.classList && c.classList.contains("flash"));
    if (!el) {
      el = document.createElement("p");
      el.className = "flash";
      host.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.remove(), 2200);
  }

  // 基础图章（单点/十字/小菱形）
  document.querySelectorAll("[data-block]").forEach(btn => {
    btn.onclick = () => {
      data.stamp = btn.dataset.block;
      document.querySelectorAll("[data-block]").forEach(b =>
        b.classList.toggle("active", b === btn));
      document.querySelectorAll("[data-block]").forEach(b =>
        b.classList.toggle("secondary", b !== btn));
    };
  });

  // ---- 画布操作（原有能力照常）----
  document.querySelector("#newBtn").onclick = () => {
    const cols = Number(document.querySelector("#cols").value);
    const rows = Number(document.querySelector("#rows").value);
    data.mode = "paint";
    pickingStart = false;
    data.reset(cols, rows); // 纹样块保留
    render();
  };

  document.querySelector("#undoBtn").onclick = () => { if (data.undo()) render(); };
  document.querySelector("#redoBtn").onclick = () => { if (data.redo()) render(); };

  document.querySelector("#saveBtn").onclick = () => {
    data.persist();
    const btn = document.querySelector("#saveBtn");
    flash(btn, "方案与纹样块已保存到本地");
  };

  document.querySelector("#exportBtn").onclick = () => {
    const counts = rules.countColors(data.cells);
    const doc = data.buildExport(counts);
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "brocade-pattern.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- 启动 ----
  data.load(
    Number(document.querySelector("#cols").value),
    Number(document.querySelector("#rows").value)
  );
  document.querySelector("#cols").value = data.cols;
  document.querySelector("#rows").value = data.rows;
  render();
})();
