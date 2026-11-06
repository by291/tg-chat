const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Delete a selection or one whole grapheme, including joined emoji and skin-tone sequences. */
export function deleteCharacter(options: {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}) {
  const { text, selectionStart, selectionEnd } = options;
  let deleteFrom = selectionStart;
  if (selectionStart === selectionEnd) {
    const precedingText = text.slice(0, selectionStart);
    for (const segment of graphemeSegmenter.segment(precedingText)) {
      deleteFrom = segment.index;
    }
  }
  return {
    text: text.slice(0, deleteFrom) + text.slice(selectionEnd),
    caret: deleteFrom,
  };
}
