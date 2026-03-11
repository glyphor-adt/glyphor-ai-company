export type V4APatchOperationType =
  | 'replace'
  | 'insert_after'
  | 'insert_before'
  | 'delete'
  | 'replace_entire';

export interface V4APatchOperation {
  type: V4APatchOperationType;
  oldText?: string;
  newText?: string;
  anchor?: string;
  occurrence?: number;
}

export interface V4AFilePatch {
  path: string;
  operations: V4APatchOperation[];
}

export interface V4APatchDocument {
  version: 'v4a-diff-v1';
  files: V4AFilePatch[];
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Patch field "${field}" must be a non-empty string.`);
  }
  return value;
}

function findOccurrence(haystack: string, needle: string, occurrence = 1): number {
  if (occurrence < 1) throw new Error(`Occurrence must be >= 1 for "${needle.slice(0, 40)}".`);
  let fromIndex = 0;
  for (let i = 1; i <= occurrence; i++) {
    const found = haystack.indexOf(needle, fromIndex);
    if (found === -1) return -1;
    if (i === occurrence) return found;
    fromIndex = found + needle.length;
  }
  return -1;
}

function applyOperation(content: string, operation: V4APatchOperation, path: string): string {
  const occurrence = operation.occurrence ?? 1;

  switch (operation.type) {
    case 'replace': {
      const oldText = requireString(operation.oldText, `${path}.operations.oldText`);
      const newText = typeof operation.newText === 'string' ? operation.newText : '';
      const index = findOccurrence(content, oldText, occurrence);
      if (index === -1) throw new Error(`Could not find replace target in ${path}.`);
      return content.slice(0, index) + newText + content.slice(index + oldText.length);
    }
    case 'insert_after': {
      const anchor = requireString(operation.anchor, `${path}.operations.anchor`);
      const newText = requireString(operation.newText, `${path}.operations.newText`);
      const index = findOccurrence(content, anchor, occurrence);
      if (index === -1) throw new Error(`Could not find insert_after anchor in ${path}.`);
      const insertAt = index + anchor.length;
      return content.slice(0, insertAt) + newText + content.slice(insertAt);
    }
    case 'insert_before': {
      const anchor = requireString(operation.anchor, `${path}.operations.anchor`);
      const newText = requireString(operation.newText, `${path}.operations.newText`);
      const index = findOccurrence(content, anchor, occurrence);
      if (index === -1) throw new Error(`Could not find insert_before anchor in ${path}.`);
      return content.slice(0, index) + newText + content.slice(index);
    }
    case 'delete': {
      const oldText = requireString(operation.oldText, `${path}.operations.oldText`);
      const index = findOccurrence(content, oldText, occurrence);
      if (index === -1) throw new Error(`Could not find delete target in ${path}.`);
      return content.slice(0, index) + content.slice(index + oldText.length);
    }
    case 'replace_entire': {
      return requireString(operation.newText, `${path}.operations.newText`);
    }
    default:
      throw new Error(`Unsupported patch operation "${(operation as V4APatchOperation).type}" for ${path}.`);
  }
}

export function parseV4APatch(input: unknown): V4APatchDocument {
  const doc = typeof input === 'string'
    ? JSON.parse(input) as unknown
    : input;

  if (!doc || typeof doc !== 'object') throw new Error('Patch payload must be an object.');
  const version = (doc as { version?: unknown }).version;
  if (version !== 'v4a-diff-v1') throw new Error('Unsupported patch version. Expected "v4a-diff-v1".');

  const files = (doc as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Patch payload must include at least one file entry.');
  }

  return {
    version: 'v4a-diff-v1',
    files: files.map((file, fileIndex) => {
      if (!file || typeof file !== 'object') {
        throw new Error(`Patch file entry ${fileIndex} must be an object.`);
      }
      const path = requireString((file as { path?: unknown }).path, `files[${fileIndex}].path`);
      const operations = (file as { operations?: unknown }).operations;
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new Error(`Patch file ${path} must include at least one operation.`);
      }
      return {
        path,
        operations: operations as V4APatchOperation[],
      };
    }),
  };
}

export function applyV4APatch(currentContent: string, patch: V4AFilePatch): string {
  return patch.operations.reduce(
    (nextContent, operation) => applyOperation(nextContent, operation, patch.path),
    currentContent,
  );
}
