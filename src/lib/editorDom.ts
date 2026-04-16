export type CaretPosition = {
  container: Node;
  offset: number;
};

export function clampCaretOffset(container: Node, offset: number) {
  const maxOffset =
    container.nodeType === Node.TEXT_NODE ? container.textContent?.length ?? 0 : container.childNodes.length;
  return Math.max(0, Math.min(offset, maxOffset));
}

export function firstCaretPosition(node: Node): CaretPosition | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return { container: node, offset: 0 };
  }

  const children = Array.from(node.childNodes);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeName === 'BR') {
      return { container: node, offset: index };
    }
    const position = firstCaretPosition(child);
    if (position) return position;
  }

  return null;
}

export function childNodeOffset(parent: Node, node: Node) {
  return Array.from(parent.childNodes).findIndex((child) => child === node);
}
