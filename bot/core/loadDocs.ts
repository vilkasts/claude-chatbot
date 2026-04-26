import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// One file in the loaded documentation set.
// `text` is the cleaned content; `chars` lets us cheaply estimate token count later.
export interface DocFile {
  path: string;
  chars: number;
  text: string;
}

// What loadDocs returns to its caller - used by chat.ts and runEval.ts.
export interface LoadedDocs {
  corpus: string;
  files: DocFile[];
  tokensApprox: number;
}

// File extensions we know how to read.
// Plain text formats just go straight in, html needs tags stripped first.
const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md",
  ".markdown",
  ".txt",
]);

// Recursively walk through a directory and return every file path inside it.
// We need the recursion because docs may be organized into nested folders later.
const findAllFilesInDirectory = async (
  directoryPath: string,
): Promise<string[]> => {
  const collectedPaths: string[] = [];
  const directoryEntries = await readdir(directoryPath, {
    withFileTypes: true,
  });

  for (const entry of directoryEntries) {
    const fullPath = path.join(directoryPath, entry.name);

    // If it's a folder, dive into it and add everything from there.
    if (entry.isDirectory()) {
      const nestedPaths = await findAllFilesInDirectory(fullPath);
      collectedPaths.push(...nestedPaths);
      continue;
    }

    // Skip anything that isn't a regular file (symlinks, sockets, etc).
    if (entry.isFile()) {
      collectedPaths.push(fullPath);
    }
  }

  return collectedPaths;
};

// Read a single supported file and return its plain text content.
// Throws for any unsupported extension (caller filters those out beforehand).
const readFileAsText = async (filePath: string): Promise<string> => {
  const extension = path.extname(filePath).toLowerCase();

  if (FILE_EXTENSIONS.has(extension)) {
    return await readFile(filePath, "utf8");
  }

  throw new Error(`Unsupported file extension: ${extension}`);
};

// Main entry: scan a directory, read every supported file, and return them
// together with a rough token estimate so the caller can decide what to do.
export const loadDocs = async (directoryPath: string): Promise<LoadedDocs> => {
  // Step 1 - make sure the directory actually exists and isn't a file.
  let directoryStats;
  try {
    directoryStats = await stat(directoryPath);
  } catch {
    throw new Error(
      `Docs directory "${directoryPath}" not found. Create it and put Clientsy documentation files inside (.md / .txt).`,
    );
  }
  if (!directoryStats.isDirectory()) {
    throw new Error(`"${directoryPath}" is not a directory.`);
  }

  // Step 2 - find every file under that directory and keep only the supported ones.
  const allFilePaths = await findAllFilesInDirectory(directoryPath);
  const supportedFilePaths = allFilePaths.filter((filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    return FILE_EXTENSIONS.has(extension);
  });

  if (supportedFilePaths.length === 0) {
    throw new Error(
      `No supported files in "${directoryPath}" - expected .md or .txt.`,
    );
  }

  // Step 3 - read each file and build a structured list + a single concatenated corpus.
  // The corpus string is only used for the rough token estimate at the end.
  const corpusChunks: string[] = [];
  const documentFiles: DocFile[] = [];

  for (const filePath of supportedFilePaths) {
    const rawText = await readFileAsText(filePath);
    const cleanText = rawText.trim();

    // Path relative to the docs folder, normalised to forward slashes
    // so it looks the same on Windows and Linux.
    const relativePath = path
      .relative(directoryPath, filePath)
      .replace(/\\/g, "/");

    corpusChunks.push(`\n\n## FILE: ${relativePath}\n\n${cleanText}`);
    documentFiles.push({
      path: relativePath,
      chars: cleanText.length,
      text: cleanText,
    });
  }

  // Step 4 - rough token count.
  // Rule of thumb for English/Russian mix: ~4 characters per token.
  // It's good enough to warn the user about size, not for exact billing.
  const fullCorpus = corpusChunks.join("\n");
  const tokensApprox = Math.round(fullCorpus.length / 4);

  // Once we get close to ~150k tokens stuffing everything into the prompt
  // becomes wasteful. At that point we should switch to retrieval (RAG).
  if (tokensApprox > 150_000) {
    console.warn(
      `Warning: corpus is ~${tokensApprox.toLocaleString("en-US")} tokens, approaching the practical system-prompt limit. Consider switching to RAG.`,
    );
  }

  return { corpus: fullCorpus, files: documentFiles, tokensApprox };
};
