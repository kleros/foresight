export const shortenName = (name: string) => (name.length > 16 ? `${name.slice(0, 12)}...` : name);

export const withAlpha = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
