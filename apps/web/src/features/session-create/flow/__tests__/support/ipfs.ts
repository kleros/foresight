import type { MetadataUploader } from "@/lib/atlas/types";

/** An in-memory content-addressed store, and a record of what it was given. */
export function fakeIpfs() {
  const stored = new Map<string, unknown>();
  const filesUploaded: string[] = [];
  let next = 0;

  const uploader: MetadataUploader = {
    async uploadFile(file: File) {
      const uri = `/ipfs/Qm${file.name}${next++}`;
      filesUploaded.push(file.name);
      stored.set(uri, file.name);
      return uri;
    },
    async uploadJson(_name: string, value: unknown) {
      const uri = `/ipfs/QmDoc${next++}`;
      stored.set(uri, JSON.parse(JSON.stringify(value)));
      return uri;
    },
    async readJson(uri: string) {
      if (!stored.has(uri)) throw new Error(`nothing at ${uri}`);
      return stored.get(uri);
    },
  };

  return { uploader, filesUploaded, stored };
}
