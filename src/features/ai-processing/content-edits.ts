import type { AISuggestionPayload } from "./schema";

type ContentSuggestion = AISuggestionPayload["content_suggestions"][number];

export function applySelectedContentSuggestions(
  source: string,
  suggestions: ContentSuggestion[],
  selectedIndexes: number[],
): string {
  const edits = [...new Set(selectedIndexes)]
    .map((index) => suggestions[index])
    .filter((suggestion): suggestion is ContentSuggestion => Boolean(suggestion))
    .map((suggestion) => ({
      suggestion,
      position: source.indexOf(suggestion.source_excerpt),
    }))
    .filter(({ position }) => position >= 0)
    .sort((left, right) => right.position - left.position);

  let result = source;
  for (const { suggestion, position } of edits) {
    result =
      result.slice(0, position) +
      suggestion.suggested_text +
      result.slice(position + suggestion.source_excerpt.length);
  }
  return result;
}
