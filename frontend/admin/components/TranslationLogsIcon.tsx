import type { SVGProps } from 'react';

export default function TranslationLogsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 3h10a2 2 0 0 1 2 2v14l-5-3-5 3V5a2 2 0 0 1 2-2z" />
      <path d="M10 8h4" />
      <path d="M10 12h4" />
    </svg>
  );
}
