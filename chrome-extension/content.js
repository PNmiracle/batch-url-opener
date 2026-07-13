// content.js - 在 Vika 页面中检测选中行并显示浮动操作按钮

let fab = null;

// 创建浮动按钮（右下角 FAB）
function createFab() {
  if (fab) return fab;

  fab = document.createElement('div');
  fab.id = 'vika-link-opener-fab';
  fab.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    background: #6c5ce7;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(108, 92, 231, 0.4);
    transition: all 0.2s;
    display: none;
    align-items: center;
    gap: 6px;
    user-select: none;
    line-height: 1.4;
  `;

  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    const links = getSelectedLinks();
    if (links.length > 0) {
      chrome.runtime.sendMessage({ action: 'OPEN_LINKS', links });
      // 打开后隐藏按钮
      hideFab();
    }
  });

  fab.addEventListener('mouseenter', () => {
    fab.style.transform = 'scale(1.05)';
  });
  fab.addEventListener('mouseleave', () => {
    fab.style.transform = 'scale(1)';
  });

  document.body.appendChild(fab);
  return fab;
}

function updateFab(count) {
  const el = createFab();
  el.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
    <span>打开 ${count} 个链接</span>
  `;
  el.style.display = 'flex';
}

function hideFab() {
  if (fab) fab.style.display = 'none';
}

// 解析 rgb 颜色
function parseRGB(color) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  return null;
}

// 检测元素是否是蓝色/紫色选中背景
function isBlueSelected(el) {
  const style = window.getComputedStyle(el);
  const bg = style.backgroundColor;
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;

  const rgb = parseRGB(bg);
  if (!rgb) return false;

  const [r, g, b] = rgb;

  // 常见的选中蓝色背景特征：
  // 1. 蓝色主导：b 高，r 和 g 较低
  // 2. 紫色：r 和 b 高，g 较低
  // 3. 浅蓝色：r、g、b 都较高，但 b 最高
  // 4. 排除灰色/白色（r≈g≈b）
  const diff = Math.max(r, g, b) - Math.min(r, g, b);
  if (diff < 30) return false; // 接近灰色/白色，跳过

  return b > 180 && (b > r || b > g); // 蓝色主导
}

// 向上查找行父元素
function findRowParent(element) {
  let el = element;
  while (el && el !== document.body) {
    const tag = el.tagName;
    const cls = el.className || '';
    const rowAttr = el.getAttribute('data-row') || el.getAttribute('rowkey') || el.getAttribute('row-index');

    if (tag === 'TR' ||
        cls.includes('row') ||
        cls.includes('Row') ||
        rowAttr ||
        el.getAttribute('role') === 'row') {
      return el;
    }
    el = el.parentElement;
  }
  return element;
}

// 获取页面中的选中行
function getSelectedRows() {
  // 方法1：通过常见表格组件的选中类
  const selectors = [
    '.arco-table-row-selected',
    '.ant-table-row-selected',
    '.rc-table-row-selected',
    '.selected',
    '.checked',
    '[aria-selected="true"]',
    '[data-selected="true"]'
  ];

  for (const selector of selectors) {
    try {
      const rows = document.querySelectorAll(selector);
      if (rows.length > 0) return Array.from(rows);
    } catch (e) {
      // 无效选择器，跳过
    }
  }

  // 方法2：通过背景色检测（选中行通常有蓝色背景）
  // 先找所有可能包含链接的容器
  const candidates = document.querySelectorAll('div, tr');
  const selected = [];
  const seen = new Set();

  candidates.forEach(el => {
    if (!el.querySelector('a')) return; // 不包含链接，跳过

    const row = findRowParent(el);
    if (seen.has(row)) return;

    if (isBlueSelected(row)) {
      seen.add(row);
      selected.push(row);
    }
  });

  if (selected.length > 0) return selected;

  return [];
}

// 从选中行中提取链接
function getSelectedLinks() {
  const rows = getSelectedRows();
  const links = [];

  rows.forEach(row => {
    const anchors = row.querySelectorAll('a');
    anchors.forEach(a => {
      const href = a.getAttribute('href') || a.href;
      if (href && href.startsWith('http')) {
        links.push(href);
      }
    });
  });

  // 去重
  return [...new Set(links)];
}

// 检查并更新浮动按钮状态
function checkSelection() {
  // 在页面加载完成后，检查是否有选中行
  if (document.readyState !== 'complete') return;

  const rows = getSelectedRows();
  if (rows.length > 0) {
    const links = getSelectedLinks();
    if (links.length > 0) {
      updateFab(links.length);
    } else {
      hideFab();
    }
  } else {
    hideFab();
  }
}

// 使用 MutationObserver 监听页面变化（选中行变化）
const observer = new MutationObserver((mutations) => {
  // 防抖：减少频繁更新
  clearTimeout(window._checkTimeout);
  window._checkTimeout = setTimeout(checkSelection, 150);
});

observer.observe(document.body, {
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'style', 'aria-selected', 'data-selected']
});

// 监听点击事件（用户可能点击选中行）
document.addEventListener('click', () => {
  clearTimeout(window._checkTimeout);
  window._checkTimeout = setTimeout(checkSelection, 200);
});

// 监听键盘事件（Shift+点击多选）
document.addEventListener('keydown', () => {
  clearTimeout(window._checkTimeout);
  window._checkTimeout = setTimeout(checkSelection, 200);
});

document.addEventListener('keyup', () => {
  clearTimeout(window._checkTimeout);
  window._checkTimeout = setTimeout(checkSelection, 200);
});

// 监听来自 background 的消息（快捷键触发）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_SELECTED_LINKS') {
    const links = getSelectedLinks();
    sendResponse({ links });
  }
  return true;
});

// 页面加载完成后初始化
if (document.readyState === 'complete') {
  checkSelection();
} else {
  window.addEventListener('load', checkSelection);
}
