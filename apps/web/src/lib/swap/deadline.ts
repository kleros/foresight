/**
 * Seconds a quoted swap stays valid. The SDK's own default is five minutes from the moment each leg is quoted, and a
 * batch of ten options is quoted leg by leg before the wallet even opens, so a hardware wallet could outlast it.
 */
export const QUOTE_DEADLINE_SECONDS = 30n * 60n;
