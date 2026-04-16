export type InlineDiffOp = {
  id: string;
  type: 'equal' | 'insert' | 'delete';
  text: string;
};

export type ComparisonBlock = {
  id: string;
  type: 'unchanged' | 'added' | 'deleted' | 'modified';
  baseText: string;
  currentText: string;
  ops: InlineDiffOp[];
};

function tokenizeForInlineDiff(text: string) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function normalizeTokens(text: string) {
  return text
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
    .filter(Boolean);
}

function paragraphSimilarity(left: string, right: string) {
  const leftTokens = normalizeTokens(left);
  const rightTokens = normalizeTokens(right);

  if (leftTokens.length === 0 && rightTokens.length === 0) {
    return 1;
  }

  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();

  for (const token of leftTokens) {
    leftCounts.set(token, (leftCounts.get(token) ?? 0) + 1);
  }

  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  let total = 0;

  for (const [token, count] of leftCounts.entries()) {
    const rightCount = rightCounts.get(token) ?? 0;
    overlap += Math.min(count, rightCount);
    total += Math.max(count, rightCount);
  }

  for (const [token, count] of rightCounts.entries()) {
    if (!leftCounts.has(token)) {
      total += count;
    }
  }

  return total === 0 ? 0 : overlap / total;
}

function substitutionCost(left: string, right: string) {
  if (left === right) return 0;
  return paragraphSimilarity(left, right) >= 0.35 ? 1 : 2;
}

function buildInlineDiff(left: string, right: string, blockId: string): InlineDiffOp[] {
  const leftTokens = tokenizeForInlineDiff(left);
  const rightTokens = tokenizeForInlineDiff(right);
  const n = leftTokens.length;
  const m = rightTokens.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        leftTokens[i] === rightTokens[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: InlineDiffOp[] = [];
  let i = 0;
  let j = 0;
  let index = 0;

  while (i < n && j < m) {
    if (leftTokens[i] === rightTokens[j]) {
      ops.push({ id: `${blockId}-equal-${index}`, type: 'equal', text: leftTokens[i] });
      i += 1;
      j += 1;
      index += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ id: `${blockId}-delete-${index}`, type: 'delete', text: leftTokens[i] });
      i += 1;
      index += 1;
    } else {
      ops.push({ id: `${blockId}-insert-${index}`, type: 'insert', text: rightTokens[j] });
      j += 1;
      index += 1;
    }
  }

  while (i < n) {
    ops.push({ id: `${blockId}-delete-${index}`, type: 'delete', text: leftTokens[i] });
    i += 1;
    index += 1;
  }

  while (j < m) {
    ops.push({ id: `${blockId}-insert-${index}`, type: 'insert', text: rightTokens[j] });
    j += 1;
    index += 1;
  }

  return ops;
}

function splitParagraphs(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function buildComparisonBlocks(baseText: string, currentText: string) {
  const baseParagraphs = splitParagraphs(baseText);
  const currentParagraphs = splitParagraphs(currentText);
  const n = baseParagraphs.length;
  const m = currentParagraphs.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));

  for (let i = n; i >= 0; i -= 1) {
    for (let j = m; j >= 0; j -= 1) {
      if (i === n) {
        dp[i][j] = m - j;
        continue;
      }
      if (j === m) {
        dp[i][j] = n - i;
        continue;
      }

      const replaceCost = substitutionCost(baseParagraphs[i], currentParagraphs[j]) + dp[i + 1][j + 1];
      const deleteCost = 1 + dp[i + 1][j];
      const insertCost = 1 + dp[i][j + 1];
      dp[i][j] = Math.min(replaceCost, deleteCost, insertCost);
    }
  }

  const blocks: ComparisonBlock[] = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    const id = `block-${i}-${j}`;

    if (i === n) {
      blocks.push({
        id,
        type: 'added',
        baseText: '',
        currentText: currentParagraphs[j],
        ops: [{ id: `${id}-insert`, type: 'insert', text: currentParagraphs[j] }]
      });
      j += 1;
      continue;
    }

    if (j === m) {
      blocks.push({
        id,
        type: 'deleted',
        baseText: baseParagraphs[i],
        currentText: '',
        ops: [{ id: `${id}-delete`, type: 'delete', text: baseParagraphs[i] }]
      });
      i += 1;
      continue;
    }

    if (baseParagraphs[i] === currentParagraphs[j] && dp[i][j] === dp[i + 1][j + 1]) {
      blocks.push({
        id,
        type: 'unchanged',
        baseText: baseParagraphs[i],
        currentText: currentParagraphs[j],
        ops: [{ id: `${id}-equal`, type: 'equal', text: currentParagraphs[j] }]
      });
      i += 1;
      j += 1;
      continue;
    }

    const replacePenalty = substitutionCost(baseParagraphs[i], currentParagraphs[j]);
    const replaceCost = replacePenalty + dp[i + 1][j + 1];
    const deleteCost = 1 + dp[i + 1][j];
    const insertCost = 1 + dp[i][j + 1];

    if (replacePenalty === 1 && dp[i][j] === replaceCost && replaceCost <= deleteCost && replaceCost <= insertCost) {
      blocks.push({
        id,
        type: 'modified',
        baseText: baseParagraphs[i],
        currentText: currentParagraphs[j],
        ops: buildInlineDiff(baseParagraphs[i], currentParagraphs[j], id)
      });
      i += 1;
      j += 1;
    } else if (dp[i][j] === deleteCost && deleteCost <= insertCost) {
      blocks.push({
        id,
        type: 'deleted',
        baseText: baseParagraphs[i],
        currentText: '',
        ops: [{ id: `${id}-delete`, type: 'delete', text: baseParagraphs[i] }]
      });
      i += 1;
    } else {
      blocks.push({
        id,
        type: 'added',
        baseText: '',
        currentText: currentParagraphs[j],
        ops: [{ id: `${id}-insert`, type: 'insert', text: currentParagraphs[j] }]
      });
      j += 1;
    }
  }

  return blocks;
}

export function applyComparisonAction(
  blocks: ComparisonBlock[],
  targetBlockId: string,
  targetOpId: string | null,
  action: 'restore' | 'remove'
) {
  const paragraphs: string[] = [];

  for (const block of blocks) {
    if (block.type === 'unchanged') {
      paragraphs.push(block.currentText);
      continue;
    }

    if (block.type === 'added') {
      if (!(block.id === targetBlockId && action === 'remove')) {
        paragraphs.push(block.currentText);
      }
      continue;
    }

    if (block.type === 'deleted') {
      if (block.id === targetBlockId && action === 'restore') {
        paragraphs.push(block.baseText);
      }
      continue;
    }

    let paragraph = '';
    for (const op of block.ops) {
      if (op.type === 'equal') {
        paragraph += op.text;
      } else if (op.type === 'insert') {
        if (!(block.id === targetBlockId && op.id === targetOpId && action === 'remove')) {
          paragraph += op.text;
        }
      } else if (op.type === 'delete') {
        if (block.id === targetBlockId && op.id === targetOpId && action === 'restore') {
          paragraph += op.text;
        }
      }
    }

    const cleaned = paragraph.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (cleaned) {
      paragraphs.push(cleaned);
    }
  }

  return paragraphs.join('\n\n');
}
