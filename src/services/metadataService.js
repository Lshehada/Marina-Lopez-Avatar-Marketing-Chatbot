export function extractCitations(response) {
  const citations = [];
  const seen = new Set();

  for (const item of response?.output || []) {
    if (item?.type !== 'message') {
      continue;
    }

    for (const content of item?.content || []) {
      const annotations =
        content?.annotations ||
        content?.text?.annotations ||
        [];

      for (const annotation of annotations) {
        if (
          annotation?.type !==
          'file_citation'
        ) {
          continue;
        }

        const fileId =
          annotation.file_id ||
          annotation.fileId ||
          annotation.file_citation
            ?.file_id ||
          null;

        if (!fileId) {
          continue;
        }

        const uniqueKey = [
          fileId,
          annotation.index ??
            annotation.start_index ??
            ''
        ].join(':');

        if (seen.has(uniqueKey)) {
          continue;
        }

        seen.add(uniqueKey);

        citations.push({
          file_id: fileId,

          filename:
            annotation.filename ||
            annotation.file_name ||
            null,

          text:
            annotation.text ||
            annotation.quote ||
            null,

          citation_index:
            annotation.index ??
            annotation.start_index ??
            null
        });
      }
    }
  }

  return citations;
}

export function extractFileSearchResults(
  response
) {
  const results = [];
  const seen = new Set();

  for (const item of response?.output || []) {
    if (
      item?.type !==
      'file_search_call'
    ) {
      continue;
    }

    for (const result of item?.results || []) {
      const fileId =
        result.file_id ||
        result.fileId ||
        null;

      if (
        !fileId ||
        seen.has(fileId)
      ) {
        continue;
      }

      seen.add(fileId);

      results.push({
        file_id: fileId,

        filename:
          result.filename ||
          result.file_name ||
          null,

        text:
          typeof result.text === 'string'
            ? result.text
            : null,

        relevance_score:
          result.score ?? null,

        citation_index: null
      });
    }
  }

  return results;
}