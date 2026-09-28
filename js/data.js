/*
 * 数据层：排版台的全部状态与本地存取。
 * 只负责“数据是什么、存在哪”，不包含铺放与统计规则，也不直接操作页面。
 */
const STORAGE_KEY = "zfl31Pattern";

// 色线库：索引 0 为地色（未填色）
const COLORS = ["#f7e7c4", "#a6322d", "#1f5f78", "#d6a437", "#355b38", "#713d7b", "#1e1b18", "#e98c52"];

// 基础笔刷（原有“基础纹样块”）
const BRUSHES = [
  { id: "dot", name: "单点" },
  { id: "cross", name: "十字" },
  { id: "diamond", name: "小菱形" }
];

const Store = {
  cols: 18,
  rows: 14,
  cells: [],                 // 长度 cols*rows 的颜色索引数组，即合并画布
  activeColor: 1,            // 当前色线索引
  brush: "dot",              // 填色模式下的基础笔刷
  mode: "paint",             // paint 填色 | select 框选 | stamp 铺放

  // 保存的纹样块：{ id, name, w, h, cells }
  // cells 为捕获时矩形内逐格颜色（含地色 0），长度 w*h
  blocks: [],

  undoStack: [],
  redoStack: [],

  selection: null,           // 已确认框选（规范化）{x0,y0,x1,y1}
  selecting: null,           // 拖动中的临时框 {ax,ay,bx,by}
  hoverIndex: null,          // 铺放悬停格，用于落点预显

  stampBlockId: null,
  stampRepeatX: 1,           // 横向铺放次数
  stampRepeatY: 1,           // 纵向铺放次数
  repeats: {}                // 每个纹样块各自记忆的横纵次数 {id:{x,y}}
};

const Persistence = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (err) {
      return null;
    }
  },
  save() {
    // 保存方案连同纹样块库一起写入
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cols: Store.cols,
      rows: Store.rows,
      cells: Store.cells,
      blocks: Store.blocks
    }));
  }
};
