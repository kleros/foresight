export const abi = [
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "question_id",
        type: "bytes32",
      },
    ],
    name: "getOpeningTS",
    outputs: [
      {
        internalType: "uint32",
        name: "",
        type: "uint32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;
