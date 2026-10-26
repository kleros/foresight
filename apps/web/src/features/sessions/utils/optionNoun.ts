/** Lowers only plain capitalised words, so "Movie Titles" reads "movie titles" and "US States" "US states". */
const inSentence = (noun: string) => noun.replace(/\b[A-Z][a-z]+\b/g, (word) => word.toLowerCase());

/** The creator's plural noun for the options; "branches" is the fallback that signals missing metadata. */
export const optionNoun = (itemNamePlural: string | null) => inSentence(itemNamePlural || "branches");

/** The singular, as in "Mint director tokens". */
export const optionNounSingular = (itemName: string | null) => inSentence(itemName || "branch");
