export const MOCK_NONCE = "0x1234567890";

export const MOCK_IPFS_HASH = "QmVDEj29zAvoBzSPkJMDx7B1Rb5CR8sGNrwei8DDULvDWp";

export const MOCK_ROLES = [
  {
    name: "Evidence",
    restriction: {
      maxSize: 20971520,
      allowedMimeTypes: [
        "video/mp4",
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/bmp",
        "image/gif",
        "image/tiff",
        "image/webp",
        "application/pdf",
        "text/csv",
        "text/html",
        "text/plain",
      ],
    },
  },
  {
    name: "Policy",
    restriction: {
      maxSize: 10485760,
      allowedMimeTypes: ["application/pdf", "text/markdown"],
    },
  },
  {
    name: "Generic",
    restriction: {
      maxSize: 409600,
      allowedMimeTypes: ["video/x-msvideo", "application/pdf", "image/png"],
    },
  },
];
