// background.js - Service Worker for Chrome Extension (Manifest V3)

// 安装/更新时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-clipboard-urls',
    title: '打开剪贴板中的所有链接',
    contexts: ['all']
  });
  chrome.contextMenus.create({
    id: 'check-clipboard-urls',
    title: '检测剪贴板中的链接状态',
    contexts: ['all']
  });
});

// 点击右键菜单
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-clipboard-urls') {
    openUrlsFromClipboard();
  }
  if (info.menuItemId === 'check-clipboard-urls') {
    try {
      const text = await readClipboard();
      const urls = extractUrls(text);
      if (urls.length === 0) return;

      // 检测所有链接
      const results = await checkLinks(urls);

      // 生成结果页面 HTML 并在新标签页打开
      const html = buildCheckResultsPage(results);
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
      chrome.tabs.create({ url: dataUrl });
    } catch (e) {
      console.error('Check clipboard failed:', e);
    }
  }
});

// 快捷键：打开 Vika 表格中选中行的链接
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-selected-links') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;
      const tab = tabs[0];
      // 向 content script 请求选中行的链接
      chrome.tabs.sendMessage(tab.id, { action: 'GET_SELECTED_LINKS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('无法与 content script 通信:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.links && response.links.length > 0) {
          openLinks(response.links);
        }
      });
    });
  }
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_LINKS') {
    openLinks(message.links);
    sendResponse({ success: true });
  }
  if (message.action === 'CHECK_LINKS') {
    checkLinks(message.links).then(results => {
      sendResponse({ results });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // 保持消息通道开放，等待异步结果
  }
  return true;
});

// 打开链接
function openLinks(links) {
  for (const url of links) {
    chrome.tabs.create({ url, active: false });
  }
}

// 从剪贴板读取并打开链接
async function openUrlsFromClipboard() {
  try {
    const text = await readClipboard();
    const urls = extractUrls(text);
    if (urls.length > 0) {
      openLinks(urls);
    }
  } catch (e) {
    console.error('Failed to open URLs from clipboard:', e);
  }
}

// 读取剪贴板文本
async function readClipboard() {
  // Service worker 无法直接访问 navigator.clipboard
  // 通过 offscreen document 来实现
  const existingContexts = await chrome.runtime.getContexts({});
  const offscreenDoc = existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');

  if (!offscreenDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: '读取剪贴板中的链接'
    });
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'READ_CLIPBOARD' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response && response.text !== undefined) {
        resolve(response.text);
      } else {
        reject(new Error('No clipboard text'));
      }
    });
  });
}

// ========== 链接检测与 Lab 页识别 ==========

// 批量检测链接状态
async function checkLinks(urls) {
  const MAX_CONCURRENT = 3;
  const results = [];

  for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
    const batch = urls.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.allSettled(
      batch.map(url => checkSingleUrl(url))
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({ url: 'unknown', status: 0, statusText: '', pageType: 'error', error: r.reason?.message || '未知错误' });
      }
    }
  }

  return results;
}

// 检测单个链接
async function checkSingleUrl(url) {
  const norm = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const result = { url: norm, status: null, statusText: '', pageType: 'unknown', error: null, title: '', finalUrl: norm };

  try {
    // 先尝试 HEAD 请求（快），失败则降级到 GET
    let response;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      response = await fetch(norm, {
        method: 'HEAD',
        signal: ctrl.signal,
        redirect: 'follow',
        mode: 'cors'
      });
      clearTimeout(timer);
    } catch (headErr) {
      // HEAD 失败（可能是 CORS 或服务器不支持），尝试带 no-cors 的 GET
      try {
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 10000);
        response = await fetch(norm, {
          method: 'GET',
          signal: ctrl2.signal,
          redirect: 'follow'
        });
        clearTimeout(timer2);
      } catch (getErr) {
        // 彻底失败，可能是网络不通
        result.error = getErr.name === 'TimeoutError' || getErr.name === 'AbortError'
          ? '请求超时'
          : '无法连接';
        return result;
      }
    }

    result.status = response.status;
    result.statusText = getStatusText(response.status);
    result.finalUrl = response.url;

    // 如果请求成功，读取标题和内容用于 Lab 页识别
    if (response.ok && response.status >= 200 && response.status < 400) {
      try {
        const text = await response.text();
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim() : '';

        // 去除 HTML 标签取纯文本用于分析
        const bodyText = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .substring(0, 6000);

        result.pageType = analyzePageType(result.finalUrl, title, bodyText);
        result.title = title;
      } catch (e) {
        // 无法读取内容，仅基于 URL 分析
        result.pageType = analyzePageType(result.finalUrl, '', '');
      }
    }
  } catch (e) {
    result.error = e.name === 'TimeoutError' || e.name === 'AbortError'
      ? '请求超时'
      : `网络错误`;
  }

  return result;
}

// 状态码中文说明
function getStatusText(status) {
  if (status >= 200 && status < 300) return '正常';
  if (status >= 300 && status < 400) return '重定向';
  if (status === 400) return '请求错误';
  if (status === 401) return '需要认证';
  if (status === 403) return '禁止访问';
  if (status === 404) return '页面不存在';
  if (status === 410) return '已删除';
  if (status >= 500) return '服务器错误';
  return '';
}

// ==== Lab 页 vs 个人主页识别 ====
// 通过 URL、页面标题、页面内容的启发式规则综合判断
function analyzePageType(url, title, content) {
  let score = 0; // 正分 = 实验室倾向，负分 = 个人主页倾向

  const urlLower = url.toLowerCase();

  // ---- URL 特征 ----
  const labUrlPatterns = [
    '/lab/', '/labs/', '/laboratory/', '/laboratories/',
    '/group/', '/groups/', '/team/', '/teams/',
    'lab.', 'laboratory', 'researchgroup', 'research-group',
    '/research/', 'center-for-', 'institute-for-',
    'lab-', '-lab'
  ];
  const personalUrlPatterns = [
    '/~', '/people/', '/faculty/', '/staff/',
    '/professor', '/professors/',
    '/member/', '/person/'
  ];

  for (const p of labUrlPatterns) {
    if (urlLower.includes(p)) score += 3;
  }
  for (const p of personalUrlPatterns) {
    if (urlLower.includes(p)) score -= 3;
  }

  // URL 中包含纯人名模式（小写字母+连字符，通常个人页）
  // e.g. /john-smith, /jane-doe
  const namePathMatch = url.match(/\/([a-z]+-[a-z]+)(?:\/|\.html?|$)/);
  if (namePathMatch && !labUrlPatterns.some(p => urlLower.includes(p))) {
    score -= 1;
  }

  // ---- 标题特征 ----
  if (title) {
    const titleLower = title.toLowerCase();
    const labTitleWords = [
      'laboratory', ' lab ', 'lab group', 'research group',
      'research lab', 'research team', ' lab at ', ' lab |',
      'research center', 'research centre'
    ];
    const personalTitleWords = [
      'professor', 'assistant professor', 'associate professor',
      'faculty', ' ph.d', ' phd', ' dr. ',
      'curriculum vitae', 'biography', 'homepage', 'home page',
      'personal page'
    ];

    for (const w of labTitleWords) {
      if (titleLower.includes(w)) score += 2;
    }
    for (const w of personalTitleWords) {
      if (titleLower.includes(w)) score -= 2;
    }

    // 标题仅为人名（常见个人页特征）
    if (/^[\w\s\-.,']{3,40}$/.test(title) && !titleLower.includes('lab') && !titleLower.includes('group')) {
      score -= 1;
    }
  }

  // ---- 内容特征 ----
  if (content) {
    const contentLower = content.toLowerCase();

    // Lab 指标：多人邮箱
    const emails = contentLower.match(/[\w.+-]+@[\w.+-]+\.\w+/g) || [];
    const uniqueDomains = new Set(emails.map(e => e.split('@')[1]));
    if (emails.length >= 5 && uniqueDomains.size >= 2) score += 3;
    else if (emails.length >= 3) score += 2;

    // Lab 指标：团队/成员相关词汇
    const labContentWords = [
      'our team', 'group members', 'lab members', 'team members',
      'current members', 'people in the lab', 'we are a',
      'our research', 'our lab', 'research interests include',
      'principal investigator', 'graduate students',
      'postdoctoral', 'postdoctoral fellows', 'phd students',
      'undergraduate researchers'
    ];
    for (const w of labContentWords) {
      if (contentLower.includes(w)) score += 1;
    }

    // 个人页指标
    const personalContentWords = [
      'curriculum vitae', 'my research', 'about me',
      'i am a', 'my email', 'my cv'
    ];
    for (const w of personalContentWords) {
      if (contentLower.includes(w)) score -= 1;
    }

    // 多个 "people" 相关标题 = lab 特征
    const peopleHeaders = (contentLower.match(/people|members|team/g) || []).length;
    if (peopleHeaders >= 4) score += 2;
  }

  // ---- 判定 ----
  if (score >= 4) return 'lab';
  if (score <= -4) return 'personal';
  if (score >= 2) return 'likely-lab';
  if (score <= -2) return 'likely-personal';
  return 'unknown';
}

// 从文本中提取 URL
function extractUrls(text) {
  const cleaned = text
    .replace(/[，]/g, ',')
    .replace(/[\s]+/g, '\n')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const urls = cleaned.filter(s => {
    if (/^https?:\/\//i.test(s)) return true;
    if (/^[\w-]+\.\w{2,}/.test(s)) return true;
    return false;
  });

  // 去重
  const seen = new Set();
  const result = [];
  for (const u of urls) {
    const norm = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
  }
  return result;
}

// 生成检测结果 HTML 页面
function buildCheckResultsPage(results) {
  const PAGE_TYPE_LABELS = {
    'personal': '🏠 个人主页',
    'likely-personal': '🏠 可能是个人主页',
    'lab': '🧪 实验室页面',
    'likely-lab': '🧪 可能是实验室页面',
    'unknown': '❓ 未知',
    'error': '⚠️ 无法判断'
  };

  const ok = results.filter(r => r.status >= 200 && r.status < 300).length;
  const dead = results.filter(r => r.status === 404 || r.status === 410 || r.status >= 500 || r.error).length;
  const labs = results.filter(r => r.pageType === 'lab' || r.pageType === 'likely-lab').length;
  const personals = results.filter(r => r.pageType === 'personal' || r.pageType === 'likely-personal').length;

  let rows = '';
  results.forEach((r, i) => {
    let icon, st, sc;
    if (r.error) {
      icon = '🔴'; st = '无法连接'; sc = '#888';
    } else if (r.status >= 200 && r.status < 300) {
      icon = '✅'; st = r.status + ' ' + (r.statusText || '正常'); sc = '#00b894';
    } else if (r.status === 404 || r.status === 410) {
      icon = '❌'; st = r.status + ' 不存在'; sc = '#d63031';
    } else if (r.status >= 500) {
      icon = '💥'; st = r.status + ' 服务器错误'; sc = '#d63031';
    } else if (r.status >= 300) {
      icon = '🔄'; st = r.status + ' 重定向'; sc = '#e17055';
    } else {
      icon = '⚠️'; st = r.status + ' 客户端错误'; sc = '#fdcb6e';
    }

    const shortUrl = r.url.replace(/^https?:\/\//, '').substring(0, 50);
    const bg = i % 2 === 0 ? '#fafbfc' : '';

    rows += `
      <tr style="background:${bg}" onclick="window.open('${r.url.replace(/'/g, "\\'")}','_blank')" title="点击打开：${r.url}">
        <td style="text-align:center">${icon}</td>
        <td style="color:${sc};font-weight:500">${st}</td>
        <td style="color:#6c5ce7;font-size:12px">${PAGE_TYPE_LABELS[r.pageType] || '❓ 未知'}</td>
        <td style="color:#555;font-size:12px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortUrl}</td>
      </tr>`;
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>链接检测结果</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f6fa; padding: 24px; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 18px; color: #1a1a2e; margin-bottom: 12px; }
  .summary { font-size: 13px; color: #555; margin-bottom: 16px; padding: 12px 16px; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .summary span { margin-right: 16px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  th { background: #6c5ce7; color: #fff; font-size: 12px; padding: 10px 12px; text-align: left; }
  th:first-child { text-align: center; width: 36px; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; cursor: pointer; }
  tr:hover td { background: #f0f4ff !important; }
  .tip { margin-top: 16px; font-size: 11px; color: #aaa; }
</style>
</head>
<body>
<div class="container">
  <h1>🔍 链接检测结果</h1>
  <div class="summary">
    <span style="color:#00b894;">✅ ${ok} 正常</span>
    ${dead > 0 ? '<span style="color:#e17055;">❌ ' + dead + ' 异常</span>' : ''}
    <span>🏠 个人主页 ${personals}</span>
    <span>🧪 实验室 ${labs}</span>
    <span style="color:#888;">共 ${results.length} 个</span>
  </div>
  <table>
    <thead>
      <tr>
        <th></th>
        <th>状态</th>
        <th>页面类型</th>
        <th>链接</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="tip">点击任意行可在新标签页中打开对应链接</div>
</div>
</body>
</html>`;
}
