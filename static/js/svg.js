// AI-generated SVG ko render karne se pehle saaf karta hai:
// <script>, <foreignObject>, on*= events, javascript: links hata deta hai.
function sanitizeSvg(src) {
  // AI aksar xmlns bhool jaata hai; uske bina SVG sahi render nahi hota.
  if (!/\sxmlns\s*=/.test(src)) src = src.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    return null; // kharab SVG
  }
  root.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove());
  const all = [root, ...root.querySelectorAll('*')];
  all.forEach((el) => {
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      const val = a.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'xlink:href') && !val.startsWith('#')) el.removeAttribute(a.name);
    });
  });
  if (!root.getAttribute('viewBox')) return null; // viewBox zaroori hai (mobile scaling)
  root.removeAttribute('width');
  root.removeAttribute('height');
  return document.importNode(root, true);
}
