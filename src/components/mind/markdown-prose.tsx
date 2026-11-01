import type { ReactNode } from "react";
import type { BlockNode, InlineNode } from "@/lib/mind/markdown-safe";
import { parseMarkdownBlocks } from "@/lib/mind/markdown-safe";

function renderInlines(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
        return <span key={key}>{node.value}</span>;
      case "code":
        return (
          <code key={key} className="md-inline-code">
            {node.value}
          </code>
        );
      case "strong":
        return <strong key={key}>{renderInlines(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInlines(node.children, key)}</em>;
      case "link":
        if (!node.href) {
          return (
            <span key={key} className="md-link-inert" title="Blocked link scheme">
              {renderInlines(node.children, key)}
            </span>
          );
        }
        return (
          <a
            key={key}
            className="md-link"
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {renderInlines(node.children, key)}
          </a>
        );
      default:
        return null;
    }
  });
}

function renderBlocks(blocks: BlockNode[], keyPrefix = "b"): ReactNode[] {
  return blocks.map((block, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (block.type) {
      case "paragraph":
        return (
          <p key={key} className="md-p">
            {renderInlines(block.children, key)}
          </p>
        );
      case "heading": {
        const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={key} className={`md-h md-h${block.level}`}>
            {renderInlines(block.children, key)}
          </Tag>
        );
      }
      case "blockquote":
        return (
          <blockquote key={key} className="md-quote">
            {renderBlocks(block.children, key)}
          </blockquote>
        );
      case "list": {
        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag key={key} className={block.ordered ? "md-ol" : "md-ul"}>
            {block.items.map((item, j) => (
              <li key={`${key}-i${j}`}>{renderInlines(item, `${key}-i${j}`)}</li>
            ))}
          </ListTag>
        );
      }
      case "table":
        return (
          <div key={key} className="md-table-wrap" role="region" aria-label="Table" tabIndex={0}>
            <table className="md-table">
              <thead>
                <tr>
                  {block.headers.map((h, j) => (
                    <th key={`${key}-h${j}`}>{renderInlines(h, `${key}-h${j}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={`${key}-r${r}`}>
                    {row.map((cell, c) => (
                      <td key={`${key}-r${r}-c${c}`}>{renderInlines(cell, `${key}-r${r}-c${c}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "hr":
        return <hr key={key} className="md-hr" />;
      case "code":
        return (
          <pre key={key} className="md-code-block">
            <code>{block.code}</code>
          </pre>
        );
      default:
        return null;
    }
  });
}

/** Presentational safe Markdown prose — no dangerouslySetInnerHTML. */
export function MarkdownProse({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  if (blocks.length === 0) return null;
  return <div className="md-prose">{renderBlocks(blocks)}</div>;
}
