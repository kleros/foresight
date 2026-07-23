export const shortenAddress = (address: string, chars = 4) =>
  address.length > chars * 2 + 2 ? `${address.slice(0, chars + 2)}...${address.slice(-chars)}` : address;
