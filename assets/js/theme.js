/*
 * 主题切换（主页 / 博客 / 所有文章页共用）
 *
 * 三件事：
 *   1. 有存过偏好就用存过的，否则跟随系统；
 *   2. 绑定 .theme-toggle 按钮，切换时写回 localStorage；
 *   3. 切换后派发 themechange 事件，供按 token 取色的组件（如主页终端）重绘。
 *
 * 首屏防闪白不在这里做：各页 <head> 里有一行内联脚本提前写 data-theme。
 * 这里用 DOMContentLoaded 绑定按钮，保证 window.theme 早于其它脚本可用。
 */
(function () {
  var H = document.documentElement;
  var KEY = 'theme';

  function readSaved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  // 内联脚本已经写好了；万一没有（直接引用本文件而漏了内联）则在这里补上
  if (H.getAttribute('data-theme') !== 'light' && H.getAttribute('data-theme') !== 'dark') {
    H.setAttribute('data-theme', readSaved() || systemTheme());
  }

  function current() {
    return H.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function syncMeta(theme) {
    var m = document.querySelector('meta[name="color-scheme"]');
    if (m) m.setAttribute('content', theme);
    var t = document.querySelector('meta[name="theme-color"]');
    if (t) t.setAttribute('content', theme === 'light' ? '#F4F5F7' : '#000000');
  }

  function apply(theme, persist) {
    H.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem(KEY, theme); } catch (e) {}
    }
    syncMeta(theme);
    var tip = theme === 'light' ? '切换到深色' : '切换到浅色';
    Array.prototype.forEach.call(document.querySelectorAll('.theme-toggle'), function (btn) {
      btn.setAttribute('aria-label', tip);
      btn.setAttribute('title', tip);
    });
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  function toggle() {
    apply(current() === 'light' ? 'dark' : 'light', true);
  }

  syncMeta(current());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.theme-toggle'), function (btn) {
      btn.addEventListener('click', toggle);
    });
    // 按钮初始状态（图标由各页自己的标记决定）
    var tip = current() === 'light' ? '切换到深色' : '切换到浅色';
    Array.prototype.forEach.call(document.querySelectorAll('.theme-toggle'), function (btn) {
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', tip);
      if (!btn.getAttribute('title')) btn.setAttribute('title', tip);
    });
  }

  // 用户没手动选过时，跟随系统变化
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function (e) {
      if (readSaved()) return;
      apply(e.matches ? 'light' : 'dark', false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  window.theme = { get: current, set: apply, toggle: toggle };
})();
