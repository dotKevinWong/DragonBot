"use client";

import { useEffect, useRef, useState } from "react";
import type { DiscordChannel } from "@/lib/guild-settings";
import { FIELD_HINT_CLASS, FIELD_LABEL_CLASS } from "@/lib/form-classes";
import { OptionIcon } from "./picker";

const PILL_CLASS = "inline-flex items-center bg-dc-mention text-dc-mention-text rounded px-0.5 mx-px align-baseline font-medium cursor-default";

/** A Discord channel link as markdown, e.g. [#lounge](https://discord.com/channels/<guild>/<channel>). */
const CHANNEL_LINK_RE = /\[([^\]\n]{1,100})\]\((https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/\d{17,20}\/(\d{17,20}))\)/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A message editor that shows channel mentions and {placeholders} as pills.
 *
 * Storage format (unchanged): newlines as the two characters \n, channel mentions as <#id>.
 * Markdown links to a Discord channel are shown as a pill too, and saved back exactly as written.
 * Typing # opens a channel search; picking one inserts <#id>, which Discord shows as a clickable
 * channel link in messages and embeds.
 */
export function PlaceholderTextarea({ label, description, value, onChange, placeholder, placeholders, channels }: {
  label: string;
  description?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  placeholders?: { label: string; value: string }[];
  channels?: DiscordChannel[];
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const isInternalChange = useRef(false);

  const channelName = (id: string): string | null => channels?.find((c) => c.id === id)?.name ?? null;

  // Storage format → rich HTML for the contenteditable
  function toHTML(raw: string): string {
    // Pull the channel links out first so escaping can't touch them
    const links: string[] = [];
    let text = raw.replace(CHANNEL_LINK_RE, (whole, linkLabel: string, _url: string, id: string) => {
      const name = channelName(id) ?? linkLabel.replace(/^#/, "");
      links.push(`<span contenteditable="false" data-raw="${escapeHtml(whole)}" title="Link to #${escapeHtml(name)}" class="${PILL_CLASS}">#${escapeHtml(name)}</span>`);
      return `\u0000${links.length - 1}\u0000`;
    });
    text = text.replace(/\\n/g, "\n");
    let html = escapeHtml(text);
    html = html.replace(/&lt;#(\d+)&gt;/g, (_, id: string) => {
      const name = channelName(id);
      const shown = name ? `#${escapeHtml(name)}` : "#unknown-channel";
      const title = name ? "" : ` title="Channel ${id} isn't visible to DragonBot"`;
      return `<span contenteditable="false" data-channel-id="${id}"${title} class="${PILL_CLASS}">${shown}</span>`;
    });
    html = html.replace(/\{(member|server)\}/g, `<span contenteditable="false" class="${PILL_CLASS}">{$1}</span>`);
    html = html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[Number(i)] ?? "");
    return html.replace(/\n/g, "<br>");
  }

  // The contenteditable DOM → storage format
  function fromDOM(el: HTMLElement): string {
    let result = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent ?? "";
      } else if (node.nodeName === "BR") {
        result += "\\n";
      } else if (node.nodeName === "DIV" || node.nodeName === "P") {
        // Block elements from Enter key in some browsers
        if (result.length > 0 && !result.endsWith("\\n")) result += "\\n";
        result += fromDOM(node as HTMLElement);
      } else if (node instanceof HTMLElement && node.dataset.channelId) {
        result += `<#${node.dataset.channelId}>`;
      } else if (node instanceof HTMLElement && node.dataset.raw) {
        result += node.dataset.raw;
      } else if (node instanceof HTMLElement && node.textContent?.match(/^\{(member|server)\}$/)) {
        result += node.textContent;
      } else {
        result += node.textContent ?? "";
      }
    }
    return result;
  }

  // Sync HTML into the editor when the value changes from outside (load, reset) or the channels arrive
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    const html = toHTML(value);
    if (el.innerHTML !== html) {
      el.innerHTML = html || "";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, channels]);

  function handleInput() {
    const el = editorRef.current;
    if (!el) return;
    isInternalChange.current = true;
    onChange(fromDOM(el));

    if (!channels || channels.length === 0) { setShowMentions(false); return; }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { setShowMentions(false); return; }

    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) { setShowMentions(false); return; }

    const textBefore = (textNode.textContent ?? "").slice(0, range.startOffset);
    const hashIdx = textBefore.lastIndexOf("#");
    if (hashIdx >= 0) {
      const filter = textBefore.slice(hashIdx + 1);
      if (!/\s/.test(filter) && filter.length <= 30) {
        const cursorRect = range.getBoundingClientRect();
        const editorRect = el.getBoundingClientRect();
        setMentionPos({ top: cursorRect.top - editorRect.top, left: cursorRect.left - editorRect.left });
        setShowMentions(true);
        setMentionFilter(filter.toLowerCase());
        setActiveIndex(0);
        return;
      }
    }
    setShowMentions(false);
  }

  function placeCaretAfter(node: Node, range: Range, sel: Selection) {
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function insertAtCursor(text: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();

    if (text === "{member}" || text === "{server}") {
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.className = PILL_CLASS;
      span.textContent = text;
      range.insertNode(span);
      placeCaretAfter(span, range, sel);
    } else {
      const node = document.createTextNode(text);
      range.insertNode(node);
      placeCaretAfter(node, range, sel);
    }
    handleInput();
  }

  function insertChannelMention(channel: DiscordChannel) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;

    // Remove the # and the typed search text
    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent ?? "";
      const cursorPos = range.startOffset;
      const trigIdx = text.slice(0, cursorPos).lastIndexOf("#");
      if (trigIdx >= 0) {
        textNode.textContent = text.slice(0, trigIdx) + text.slice(cursorPos);
        range.setStart(textNode, trigIdx);
        range.collapse(true);
      }
    }

    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.channelId = channel.id;
    span.className = PILL_CLASS;
    span.textContent = `#${channel.name}`;
    range.insertNode(span);
    // A space after the pill, so typing continues outside it
    const space = document.createTextNode(" ");
    span.after(space);
    placeCaretAfter(space, range, sel);

    setShowMentions(false);
    setMentionFilter("");
    handleInput();
  }

  const filteredChannels = (channels ?? [])
    .filter((c) => c.type !== "category" && c.name.toLowerCase().includes(mentionFilter))
    // Names that start with the search first, as Discord does
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(mentionFilter)) - Number(!b.name.toLowerCase().startsWith(mentionFilter)))
    .slice(0, 10);
  const menuOpen = showMentions && filteredChannels.length > 0;
  const noChannels = channels !== undefined && channels.length === 0;

  return (
    <div>
      {label && <label className={FIELD_LABEL_CLASS}>{label}</label>}
      {placeholders && placeholders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-xs text-dc-text-muted mr-0.5">Insert:</span>
          {placeholders.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => insertAtCursor(p.value)}
              className="px-2 h-6 bg-dc-mention text-dc-mention-text text-xs font-medium rounded-md hover:bg-dc-accent hover:text-white transition-colors cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label={label}
          onInput={handleInput}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
          onKeyDown={(e) => {
            if (!menuOpen) return;
            if (e.key === "Escape") { e.preventDefault(); setShowMentions(false); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => (i + 1) % filteredChannels.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => (i - 1 + filteredChannels.length) % filteredChannels.length); }
            else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const ch = filteredChannels[activeIndex];
              if (ch) insertChannelMention(ch);
            }
          }}
          onBlur={() => setTimeout(() => setShowMentions(false), 150)}
          data-placeholder={placeholder}
          className="w-full px-3 py-2.5 bg-dc-input border border-dc-border rounded-lg text-dc-text-primary text-sm leading-6 outline-none hover:border-[#3d3d45] focus:border-dc-accent transition-colors min-h-24 whitespace-pre-wrap break-words empty:before:content-[attr(data-placeholder)] empty:before:text-dc-text-muted"
        />
        {menuOpen && (
          <div
            className="absolute z-20 w-64 bg-dc-bg-floating border border-dc-border rounded-lg shadow-2xl shadow-black/50 p-1.5"
            style={{
              bottom: `calc(100% - ${mentionPos.top}px + 6px)`,
              left: `${Math.max(0, Math.min(mentionPos.left, (editorRef.current?.offsetWidth ?? 256) - 256))}px`,
            }}
          >
            <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dc-text-muted">
              Channels{mentionFilter ? <> matching <span className="normal-case text-dc-text-secondary">#{mentionFilter}</span></> : null}
            </p>
            {filteredChannels.map((ch, i) => (
              <button
                key={ch.id}
                type="button"
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); insertChannelMention(ch); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left cursor-pointer ${
                  i === activeIndex ? "bg-dc-accent text-white" : "text-dc-text-secondary"
                }`}
              >
                <OptionIcon option={{ kind: ch.type === "voice" ? "voice" : "channel" }} />
                <span className="truncate">{ch.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className={FIELD_HINT_CLASS}>
        {description}
        {description && channels ? " " : null}
        {channels && (noChannels
          ? "Channel names can't be shown because DragonBot can't see this server's channels."
          : <>Type <kbd className="px-1 rounded bg-[#2e2e34] text-dc-text-secondary font-sans">#</kbd> to link a channel.</>)}
      </p>
    </div>
  );
}
