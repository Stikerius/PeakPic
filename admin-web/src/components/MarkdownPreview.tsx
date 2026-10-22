import { parseMarkdown, type InlineSpan } from "../lib/markdown";

function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (span.bold ? <strong key={index}>{span.text}</strong> : <span key={index}>{span.text}</span>))}
    </>
  );
}

/** Preview exactly as the app renders it (same parser, text only, never HTML). */
export function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="markdown">
      {parseMarkdown(source).map((block, index) => {
        switch (block.kind) {
          case "heading":
            if (block.level === 1) return <h2 key={index}><Spans spans={block.spans} /></h2>;
            if (block.level === 2) return <h3 key={index}><Spans spans={block.spans} /></h3>;
            return <h4 key={index}><Spans spans={block.spans} /></h4>;
          case "paragraph":
            return <p key={index}><Spans spans={block.spans} /></p>;
          case "quote":
            return <blockquote key={index}><Spans spans={block.spans} /></blockquote>;
          case "rule":
            return <hr key={index} />;
          case "bullet":
            return <ul key={index}>{block.items.map((item, i) => <li key={i}><Spans spans={item} /></li>)}</ul>;
          case "numbered":
            return <ol key={index}>{block.items.map((item, i) => <li key={i}><Spans spans={item} /></li>)}</ol>;
        }
      })}
    </div>
  );
}
