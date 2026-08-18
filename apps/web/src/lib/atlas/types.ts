/**
 * The port over a content-addressed store,
 * implemented by `ipfs.ts` against Atlas.
 */
export interface MetadataUploader {
  uploadFile(file: File): Promise<string>;
  uploadJson(name: string, value: unknown): Promise<string>;
  /** Untyped on purpose: callers only ever compare the result to what they sent. */
  readJson(uri: string): Promise<unknown>;
}
