import clsx from "clsx";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";

import { unescapeNewlines } from "@/utils/markdown";

const urlTransform = (url: string): string => {
  const safe = defaultUrlTransform(url);
  return /^(https:|mailto:)/i.test(safe) ? safe : "";
};

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-fs-accent underline">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => (alt ? <span className="text-fs-text-secondary italic">{alt}</span> : null),
};

const PROSE = [
  "text-fs-text-primary flex flex-col gap-2 text-sm",
  "[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:pl-5",
  "[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1 [&_ol]:pl-5",
  "[&_code]:bg-fs-surface-tint [&_code]:rounded-xs [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:bg-fs-surface-tint [&_pre]:rounded-fs [&_pre]:overflow-x-auto [&_pre]:p-3",
  "[&_blockquote]:border-fs-border [&_blockquote]:text-fs-text-secondary [&_blockquote]:border-l-2 [&_blockquote]:pl-3",
  "[&_hr]:border-fs-border",
  "[&_a]:break-words",
].join(" ");

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx(PROSE, className)}>
      <ReactMarkdown remarkPlugins={[remarkBreaks]} urlTransform={urlTransform} components={components}>
        {unescapeNewlines(children)}
      </ReactMarkdown>
    </div>
  );
}
