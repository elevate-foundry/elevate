import { useState, useEffect } from 'react';

// Global tooltip state accessible from anywhere
let showTooltipFn: ((e: MouseEvent, html: string) => void) | null = null;
let hideTooltipFn: (() => void) | null = null;

export function showTooltip(e: MouseEvent | React.MouseEvent, html: string) {
  showTooltipFn?.(e as MouseEvent, html);
}

export function hideTooltip() {
  hideTooltipFn?.();
}

export function Tooltip() {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [content, setContent] = useState('');

  useEffect(() => {
    showTooltipFn = (e, html) => {
      setContent(html);
      setPos({ x: e.clientX + 12, y: e.clientY + 12 });
      setVisible(true);
    };
    hideTooltipFn = () => setVisible(false);
    return () => {
      showTooltipFn = null;
      hideTooltipFn = null;
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="tooltip"
      id="tooltip"
      style={{ left: pos.x, top: pos.y }}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
