// Offline MathJax (static/vendor/mathjax). $..$ inline, $$..$$ block.
window.MathJax = {
  tex: {
    inlineMath: [['$', '$'], ['\\(', '\\)']],
    displayMath: [['$$', '$$'], ['\\[', '\\]']],
    processEscapes: true,
  },
  svg: { fontCache: 'global' },
  options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'] },
  startup: {
    typeset: false,
    ready() {
      MathJax.startup.defaultReady();
      window._mathReady = true;
      if (window._mathQueue) { typeset(window._mathQueue); window._mathQueue = null; }
    },
  },
};

// MathJax load hone se pehle call ho jaye to queue me rakh leta hai.
window.typeset = function (el) {
  if (window._mathReady) {
    MathJax.typesetPromise([el]).catch((e) => console.warn('MathJax:', e));
  } else {
    window._mathQueue = el;
  }
};
