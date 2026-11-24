/** Seer's routers at their Gnosis addresses, which a Gnosis fork keeps. */
export const GNOSIS_ROUTER = "0xec9048b59b3467415b1a38f63416407ea0c70fb8";
/** Redeems a child's tokens straight to collateral; nothing else Foresight sends goes through it. */
export const CONDITIONAL_ROUTER = "0x774284d5cdfec3a0a0ebc7283ad4d5b33013c29c";
export const SEER_ROUTERS = [GNOSIS_ROUTER, CONDITIONAL_ROUTER] as const;

export const isRouter = (address: string) => (SEER_ROUTERS as readonly string[]).includes(address);

/** Every ERC-20 transfer into or out of Seer's routers: a connected wallet's redeem shows only there. */
export const ROUTER_TRANSFERS = { params: [{ from: [...SEER_ROUTERS] }, { to: [...SEER_ROUTERS] }] };
