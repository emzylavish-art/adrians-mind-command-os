export const chatGutter = 16;
export const assistantIndent = 12;
export const spacingTokens = [4, 8, 12, 16, 24] as const;

export function allowedLeftEdges(): number[] {
  return [chatGutter, chatGutter + assistantIndent];
}

export function usesSpacingToken(value: number): boolean {
  return value > 0 && value % 4 === 0;
}
