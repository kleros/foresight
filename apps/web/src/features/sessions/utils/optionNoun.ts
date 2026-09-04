/** The creator's plural noun for the options; "branches" is the fallback that signals missing metadata. */
export const optionNoun = (itemNamePlural: string | null) => (itemNamePlural || "branches").toLowerCase();
