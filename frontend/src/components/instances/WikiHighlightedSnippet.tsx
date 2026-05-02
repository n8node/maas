"use client";

import { Fragment } from "react";

/** Must match backend memory.wikiSnippetHLStart / wikiSnippetHLEnd (PostgreSQL ts_headline). */
const HL_OPEN = "[[MNQ-HL]]";
const HL_CLOSE = "[[/MNQ-HL]]";

/** Renders wiki query citation text with matched query terms wrapped by the backend for visibility. */
export function WikiHighlightedSnippet({ text }: { text: string }) {
  if (!text.includes(HL_OPEN)) {
    return <>{text}</>;
  }

  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < text.length) {
    const o = text.indexOf(HL_OPEN, i);
    if (o === -1) {
      nodes.push(<Fragment key={`w-${k++}`}>{text.slice(i)}</Fragment>);
      break;
    }
    if (o > i) {
      nodes.push(<Fragment key={`w-${k++}`}>{text.slice(i, o)}</Fragment>);
    }
    const c = text.indexOf(HL_CLOSE, o + HL_OPEN.length);
    if (c === -1) {
      nodes.push(<Fragment key={`w-${k++}`}>{text.slice(o)}</Fragment>);
      break;
    }
    const inner = text.slice(o + HL_OPEN.length, c);
    nodes.push(
      <mark
        key={`w-${k++}`}
        className="rounded-sm bg-[#faeeda] px-0.5 font-medium text-[#633806]"
      >
        {inner}
      </mark>,
    );
    i = c + HL_CLOSE.length;
  }

  return <>{nodes}</>;
}
