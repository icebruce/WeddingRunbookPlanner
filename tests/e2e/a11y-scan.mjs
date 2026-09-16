/**
 * A small accessibility scan, run inside the page.
 *
 * It is not a replacement for axe-core; it checks the things this app has
 * actually been caught failing: controls without an accessible name, text
 * below the contrast it needs, icons below the (lower) contrast an icon
 * needs, and ARIA that says something untrue. Being small means it can run
 * on every screen in both themes on every project without slowing the suite
 * down.
 */
export const SCAN = `(() => {
  const luminance = rgb => {
    const [r, g, b] = rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  /**
   * Computed colours come back in two notations. rgb()/rgba() carries 0-255
   * channels; color(srgb ...) — which is what a color-mix() resolves to —
   * carries 0-1. Reading the second as the first makes every mixed colour look
   * almost black, which turns real contrast failures into false ones and
   * hides the real ones.
   */
  const parse = colour => {
    if (!colour) return null;
    const match = colour.match(/[\\d.]+(?:e[-+]?\\d+)?/g);
    if (!match) return null;

    const numbers = match.map(Number);
    if (/^color\\(/.test(colour)) {
      const [r, g, b, a = 1] = numbers;
      return { rgb: [r * 255, g * 255, b * 255], alpha: a };
    }
    const [r, g, b, a = 1] = numbers;
    return { rgb: [r, g, b], alpha: a };
  };

  /** The colour actually behind an element, walking up past transparency. */
  const backdrop = node => {
    let current = node;
    while (current && current !== document.documentElement) {
      const parsed = parse(getComputedStyle(current).backgroundColor);
      if (parsed && parsed.alpha > 0.85) return parsed.rgb;
      current = current.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return body ? body.rgb : [255, 255, 255];
  };

  const ratio = (a, b) => {
    const light = Math.max(luminance(a), luminance(b));
    const dark = Math.min(luminance(a), luminance(b));
    return (light + 0.05) / (dark + 0.05);
  };

  const visible = node => {
    // Anything hidden from the accessibility tree is not text anyone reads.
    if (node.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.2) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const describes = node => {
    const label = node.getAttribute('aria-label');
    if (label && label.trim()) return true;
    const describedBy = node.getAttribute('aria-labelledby');
    if (describedBy && describedBy.split(/\\s+/).some(id => document.getElementById(id))) return true;
    if (node.textContent && node.textContent.trim()) return true;
    if (node.title && node.title.trim()) return true;
    // A form control can be named by its own <label>.
    if (node.labels && node.labels.length) return true;
    return false;
  };

  const problems = [];
  const where = node => {
    const id = node.id ? '#' + node.id : '';
    const cls = typeof node.className === 'string' && node.className ? '.' + node.className.trim().split(/\\s+/).join('.') : '';
    return (node.tagName.toLowerCase() + id + cls).slice(0, 90);
  };

  // 1. Every control says what it does.
  for (const node of document.querySelectorAll('button, a[href], [role="button"], input, select, textarea, summary')) {
    if (!visible(node)) continue;
    if (node.type === 'hidden') continue;
    if (!describes(node)) problems.push({ kind: 'unnamed', where: where(node) });
  }

  // 2. Text meets its contrast.
  const TEXT_SELECTOR = 'h1,h2,h3,p,span,strong,small,b,button,a,label,td,th,li,legend,dt,dd';
  for (const node of document.querySelectorAll(TEXT_SELECTOR)) {
    if (!visible(node)) continue;
    const text = [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim());
    if (!text) continue;

    const style = getComputedStyle(node);
    const colour = parse(style.color);
    if (!colour || colour.alpha < 0.9) continue;

    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const needed = large ? 3 : 4.5;

    const measured = ratio(colour.rgb, backdrop(node));
    if (measured + 0.05 < needed) {
      problems.push({
        kind: 'contrast',
        where: where(node),
        text: node.textContent.trim().slice(0, 40),
        ratio: Math.round(measured * 100) / 100,
        needed
      });
    }
    if (size < 12) problems.push({ kind: 'tiny-text', where: where(node), size });
  }

  // 3. Icons meet the 3:1 floor for non-text UI (DESIGN_GUIDE §8), not the
  // 4.5:1 text needs. Icons are drawn with \`stroke="currentColor"\` (or
  // fill), so their colour is the element's own \`color\`, not text content —
  // the text-contrast pass above never looks at them at all, which is
  // exactly how the drag grip's failing contrast (F25 follow-up) passed
  // every existing check.
  const iconShown = node => {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.2) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  for (const node of document.querySelectorAll('svg.icon')) {
    // Icons are always aria-hidden (decorative; the control they sit in
    // carries the name), so this cannot reuse \`visible()\` above — that
    // treats aria-hidden as invisible, which is right for the accessible-name
    // and text checks but wrong here: an aria-hidden icon can still be the
    // only thing on screen a sighted person reads. checkVisibility (where
    // supported) also correctly follows an ancestor's opacity — a hover-only
    // control's icon is not counted while nothing has revealed it.
    const shown = typeof node.checkVisibility === 'function'
      ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : iconShown(node);
    if (!shown) continue;

    const colour = parse(getComputedStyle(node).color);
    if (!colour || colour.alpha < 0.9) continue;

    const measured = ratio(colour.rgb, backdrop(node));
    if (measured + 0.05 < 3) {
      const owner = node.closest('button, [role="button"], a, .card-grip, .tag, .stage-tag') || node.parentElement || node;
      problems.push({
        kind: 'icon-contrast',
        where: where(owner),
        ratio: Math.round(measured * 100) / 100,
        needed: 3
      });
    }
  }

  // 4. No ARIA that says something untrue.
  for (const node of document.querySelectorAll('[aria-selected]')) {
    const role = node.getAttribute('role') || node.tagName.toLowerCase();
    const allowed = ['option', 'tab', 'row', 'gridcell', 'treeitem', 'columnheader', 'rowheader'];
    if (!allowed.includes(role)) problems.push({ kind: 'bad-aria', where: where(node), detail: 'aria-selected on ' + role });
  }
  for (const node of document.querySelectorAll('[aria-labelledby]')) {
    const missing = node.getAttribute('aria-labelledby').split(/\\s+/).filter(id => !document.getElementById(id));
    if (missing.length) problems.push({ kind: 'bad-aria', where: where(node), detail: 'aria-labelledby points at nothing' });
  }

  return problems;
})()`;
