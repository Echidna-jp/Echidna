/* 轻量界面：提示气泡（可叠加）、FPS 显示 */
(function (SW) {
  'use strict';

  function toast(message, ms) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 800);
    }, ms || 6000);
  }

  function setFps(text) {
    const el = document.getElementById('fps');
    if (!el) return;
    el.style.display = text ? 'block' : 'none';
    if (text) el.textContent = text;
  }

  SW.ui = { toast, setFps };
})((window.SW = window.SW || {}));
