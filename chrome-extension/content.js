// content.js - 在飞书/多维表格页面中检测选中行并显示浮动操作按钮

let fab = null;
let fabDetect = null;
let resultPanel = null;

// 创建浮动按钮组（右下角）
function createFabGroup() {
  if (fab) return;

  const group = document.createElement('div');
  group.id = 'vika-link-opener-group';
  group.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 999999;
    display: none;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
  `;

  // 主按钮：批量打开
  fab = document.createElement('div');
  fab.id = 'vika-link-opener-fab';
  fab.style.cssText = `
    background: #6c5ce7;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(108, 92, 231, 0.4);
    transition: all 0.2s;
    display: flex;
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
      hideFab();
    }
  });

  fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.05)'; });
  fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });

  // 检测按钮
  fabDetect = document.createElement('div');
  fabDetect.id = 'vika-link-detector-fab';
  fabDetect.style.cssText = `
    background: #00b894;
    color: white;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 184, 148, 0.35);
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
    line-height: 1.4;
  `;
  fabDetect.innerHTML = '🔍 检测链接';

  fabDetect.addEventListener('click', (e) => {
    e.stopPropagation();
    const links = getSelectedLinks();
    if (links.length > 0) {
      startDetection(links);
    }
  });

  fabDetect.addEventListener('mouseenter', () => { fabDetect.style.transform = 'scale(1.05)'; });
  fabDetect.addEventListener('mouseleave', () => { fabDetect.style.transform = 'scale(1)'; });

  group.appendChild(fab);
  group.appendChild(fabDetect);
  document.body.appendChild(group);

  return group;
}

function updateFab(count) {
  const group = createFabGroup();
  fab.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
    <span>打开 ${count} 个链接</span>
  `;
  group.style.display = 'flex';
}

function hideFab() {
  const group = document.getElementById('vika-link-opener-group');
  if (group) group.style.display = 'none';
  hideResultPanel();
}

// ========== 链接检测 ==========

// 页面类型中文标签和图标
const PAGE_TYPE_LABELS = {
  'personal': '🏠 个人主页',
  'likely-personal': '🏠 可能是个人主页',
  'lab': '🧪 实验室页面',
  'likely-lab': '🧪 可能是实验室页面',
  'unknown': '❓ 未知类型',
  'error': '⚠️ 无法判断'
};

// 状态图标
function getStatusIcon(result) {
  if (result.error) return '🔴';
  if (result.status >= 200 && result.status < 300) return '✅';
  if (result.status >= 300 && result.status < 400) return '🔄';
  if (result.status === 404 || result.status === 410) return '❌';
  if (result.status >= 400 && result.status < 500) return '⚠️';
  if (result.status >= 500) return '💥';
  return '❓';
}

// 开始检测
async function startDetection(links) {
  // 更新检测按钮状态
  fabDetect.innerHTML = '⏳ 检测中...';
  fabDetect.style.pointerEvents = 'none';
  fabDetect.style.opacity = '0.7';

  // 显示结果面板（loading 状态）
  showResultPanel(links.length, 'loading');

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'CHECK_LINKS', links }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });

    if (response.error) {
      showResultPanel(0, 'error', response.error);
      return;
    }

    // 统计结果
    const results = response.results;
    const stats = {
      total: results.length,
      ok: results.filter(r => r.status >= 200 && r.status < 300).length,
      redirect: results.filter(r => r.status >= 300 && r.status < 400).length,
      notFound: results.filter(r => r.status === 404 || r.status === 410).length,
      serverError: results.filter(r => r.status >= 500).length,
      clientError: results.filter(r => r.status >= 400 && r.status < 500 && r.status !== 404 && r.status !== 410).length,
      dead: results.filter(r => r.error).length,
      labs: results.filter(r => r.pageType === 'lab' || r.pageType === 'likely-lab').length,
      personals: results.filter(r => r.pageType === 'personal' || r.pageType === 'likely-personal').length
    };

    showResultPanel(results.length, 'done', null, results, stats);
  } catch (e) {
    showResultPanel(0, 'error', e.message);
  } finally {
    // 恢复检测按钮
    fabDetect.innerHTML = '🔍 检测链接';
    fabDetect.style.pointerEvents = '';
    fabDetect.style.opacity = '1';
  }
}

// 创建/更新结果面板
function showResultPanel(total, state, errorMsg, results, stats) {
  // 移除旧面板
  hideResultPanel();

  resultPanel = document.createElement('div');
  resultPanel.id = 'vika-link-detector-panel';
  resultPanel.style.cssText = `
    position: fixed;
    bottom: 140px;
    right: 24px;
    z-index: 999998;
    width: 460px;
    max-height: 500px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;

  // 标题栏
  const header = document.createElement('div');
  header.style.cssText = 'padding: 12px 16px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center;';
  header.innerHTML = `
    <span style="font-size: 14px; font-weight: 600; color: #1a1a2e;">🔍 链接检测</span>
    <span style="font-size: 11px; color: #aaa; cursor: pointer;" id="detector-close-btn">✕ 关闭</span>
  `;
  resultPanel.appendChild(header);

  header.querySelector('#detector-close-btn').addEventListener('click', hideResultPanel);

  // 内容区
  const content = document.createElement('div');
  content.style.cssText = 'padding: 12px 16px; overflow-y: auto; flex: 1;';

  if (state === 'loading') {
    content.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; color: #888; font-size: 13px; padding: 20px 0;">
        <span style="display:inline-block;width:18px;height:18px;border:2px solid #e0e0e0;border-top-color:#6c5ce7;border-radius:50%;animation:spin 0.8s linear infinite;"></span>
        正在检测 ${total} 个链接...
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
  } else if (state === 'error') {
    content.innerHTML = `<div style="color: #e17055; font-size: 13px; padding: 10px 0;">检测失败：${errorMsg}</div>`;
  } else if (state === 'done') {
    // 统计摘要
    const summary = document.createElement('div');
    summary.style.cssText = 'font-size: 12px; color: #555; margin-bottom: 10px; line-height: 1.8;';
    const parts = [];
    if (stats.ok > 0) parts.push(`<span style="color:#00b894;">✅ ${stats.ok} 正常</span>`);
    if (stats.redirect > 0) parts.push(`🔄 ${stats.redirect} 重定向`);
    if (stats.notFound > 0) parts.push(`<span style="color:#e17055;">❌ ${stats.notFound} 个404</span>`);
    if (stats.clientError > 0) parts.push(`<span style="color:#fdcb6e;">⚠️ ${stats.clientError} 客户端错误</span>`);
    if (stats.serverError > 0) parts.push(`<span style="color:#d63031;">💥 ${stats.serverError} 服务器错误</span>`);
    if (stats.dead > 0) parts.push(`<span style="color:#888;">🔴 ${stats.dead} 无法连接</span>`);
    summary.innerHTML = parts.join(' &nbsp;|&nbsp; ') || '无结果';

    const typeInfo = document.createElement('div');
    typeInfo.style.cssText = 'font-size: 12px; color: #555; margin-bottom: 12px; line-height: 1.8;';
    typeInfo.innerHTML = `🏠 个人主页 ${stats.personals} &nbsp;|&nbsp; 🧪 实验室 ${stats.labs}`;
    
    content.appendChild(summary);
    content.appendChild(typeInfo);

    // 结果列表
    const list = document.createElement('div');
    list.style.cssText = 'max-height: 280px; overflow-y: auto;';

    results.forEach((r, i) => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 8px 10px;
        border-radius: 6px;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s;
        ${i % 2 === 0 ? 'background: #fafbfc;' : ''}
      `;
      item.addEventListener('mouseenter', () => { item.style.background = '#f0f4ff'; });
      item.addEventListener('mouseleave', () => { item.style.background = i % 2 === 0 ? '#fafbfc' : ''; });
      item.addEventListener('click', () => { window.open(r.url, '_blank'); });

      const statusIcon = getStatusIcon(r);
      const statusText = r.error ? '无法连接' : `${r.status} ${r.statusText}`;
      const statusColor = r.error ? '#888' :
        r.status >= 200 && r.status < 300 ? '#00b894' :
        r.status >= 300 && r.status < 400 ? '#e17055' :
        r.status === 404 ? '#d63031' : 
        r.status >= 500 ? '#d63031' : '#fdcb6e';

      // 截断 URL 显示
      const displayUrl = r.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const shortUrl = displayUrl.length > 35 ? displayUrl.substring(0, 32) + '...' : displayUrl;

      item.innerHTML = `
        <span style="flex-shrink:0;">${statusIcon}</span>
        <span style="font-weight:500; color:${statusColor}; min-width:65px; flex-shrink:0;">${statusText}</span>
        <span style="color:#6c5ce7; font-size:11px; min-width:90px; flex-shrink:0;">${PAGE_TYPE_LABELS[r.pageType] || '❓ 未知'}</span>
        <span style="color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.url}">${shortUrl}</span>
      `;

      list.appendChild(item);
    });

    content.appendChild(list);
  }

  resultPanel.appendChild(content);
  document.body.appendChild(resultPanel);
}

function hideResultPanel() {
  if (resultPanel) {
    resultPanel.remove();
    resultPanel = null;
  }
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
    '[data-selected="true"]',
    // 飞书多维表格特有
    '.dtable-row-active',
    '.dtable-row-selected',
    '.dtable-cell-selected',
    '.currentRow',
    '.table-row-active',
    '.table-cell-active',
    '[data-dtable-active="true"]'
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

// 监听键盘事件（Shift+点击多选）——使用 capture 阶段，避免被飞书内部拦截
function handleKeyEvent(e) {
  clearTimeout(window._checkTimeout);
  window._checkTimeout = setTimeout(checkSelection, 200);
}

document.addEventListener('keydown', handleKeyEvent, true);
document.addEventListener('keyup', handleKeyEvent, true);

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
