"use client";

import { useEffect, useRef, useState } from "react";
import type { DiscordChannel } from "@/lib/guild-settings";
import { FIELD_LABEL_CLASS } from "@/lib/form-classes";

export function PlaceholderTextarea({ label, value, onChange, placeholder, placeholders, channels }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  placeholders?: { label: string; value: string }[];
  channels?: DiscordChannel[];
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const isInternalChange = useRef(false);

  // Convert storage format → rich HTML for contenteditable
  function toHTML(raw: string): string {
    let html = raw.replace(/\\n/g, "\n");
    // Escape HTML entities in plain text
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Restore channel mentions as styled spans
    html = html.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
      const ch = channels?.find((c) => c.id === id);
      const name = (ch ? ch.name : id).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      return `<span contenteditable="false" data-channel-id="${id}" class="inline-flex items-center gap-0.5 bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px align-baseline text-xs cursor-default">#${name}</span>`;
    });
    // Style {member} and {server} placeholders
    html = html.replace(/\{(member|server)\}/g,
      '<span contenteditable="false" class="bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px text-xs cursor-default">{$1}</span>',
    );
    // Newlines to <br>
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  // Extract storage format from the contenteditable DOM
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
      } else if (node instanceof HTMLElement && node.textContent?.match(/^\{(member|server)\}$/)) {
        result += node.textContent;
      } else {
        result += node.textContent ?? "";
      }
    }
    return result;
  }

  // Sync HTML into editor when value changes externally
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
    const storageVal = fromDOM(el);
    onChange(storageVal);

    // Check for # or @ mention trigger
    if (!channels || channels.length === 0) { setShowMentions(false); return; }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { setShowMentions(false); return; }

    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) { setShowMentions(false); return; }

    const textBefore = (textNode.textContent ?? "").slice(0, range.startOffset);

    // Check for # trigger first, then @
    const hashIdx = textBefore.lastIndexOf("#");
    const atIdx = textBefore.lastIndexOf("@");
    const bestIdx = Math.max(hashIdx, atIdx);

    if (bestIdx >= 0) {
      const filter = textBefore.slice(bestIdx + 1);
      if (!filter.includes("\n") && !filter.includes(" ") && filter.length <= 30) {
        // Get cursor position for dropdown placement
        const cursorRect = range.getBoundingClientRect();
        const editorRect = editorRef.current?.getBoundingClientRect();
        if (editorRect) {
          setMentionPos({
            top: cursorRect.top - editorRect.top,
            left: cursorRect.left - editorRect.left,
          });
        }
        setShowMentions(true);
        setMentionFilter(filter.toLowerCase());
        return;
      }
    }
    setShowMentions(false);
  }

  function insertAtCursor(text: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();

    // If it's a placeholder, insert as styled span
    if (text === "{member}" || text === "{server}") {
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.className = "bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px text-xs cursor-default";
      span.textContent = text;
      range.insertNode(span);
      // Move cursor after span
      range.setStartAfter(span);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
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

    // Remove the trigger char + filter text
    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent ?? "";
      const cursorPos = range.startOffset;
      const beforeCursor = text.slice(0, cursorPos);
      const trigIdx = Math.max(beforeCursor.lastIndexOf("#"), beforeCursor.lastIndexOf("@"));
      if (trigIdx >= 0) {
        textNode.textContent = text.slice(0, trigIdx) + text.slice(cursorPos);
        range.setStart(textNode, trigIdx);
        range.collapse(true);
      }
    }

    // Insert channel span
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.channelId = channel.id;
    span.className = "inline-flex items-center gap-0.5 bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px align-baseline text-xs cursor-default";
    span.textContent = `#${channel.name}`;
    range.insertNode(span);

    // Move cursor after
    range.setStartAfter(span);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    setShowMentions(false);
    setMentionFilter("");
    handleInput();
  }

  const filteredChannels = channels?.filter((c) =>
    c.type !== "category" && c.name.toLowerCase().includes(mentionFilter),
  ) ?? [];

  return (
    <div>
      {label && <label className={FIELD_LABEL_CLASS}>{label}</label>}
      {(placeholders || channels) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {placeholders?.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => insertAtCursor(p.value)}
              className="px-2 py-0.5 bg-dc-accent/20 text-dc-accent text-xs rounded hover:bg-dc-accent/30 transition-colors cursor-pointer"
            >
              {p.label}
            </button>
          ))}
          {channels && channels.length > 0 && (
            <span className="text-[11px] text-dc-text-muted self-center ml-1">Type # to mention a channel</span>
          )}
        </div>
      )}
      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
          onKeyDown={(e) => {
            if (showMentions && e.key === "Escape") {
              setShowMentions(false);
              e.preventDefault();
            }
          }}
          onBlur={() => setTimeout(() => setShowMentions(false), 200)}
          data-placeholder={placeholder}
          className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors min-h-20 whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-dc-text-muted"
        />
        {showMentions && filteredChannels.length > 0 && (
          <div
            className="absolute bg-dc-bg-tertiary border border-dc-border rounded-md shadow-lg max-h-48 overflow-y-auto z-10 w-56"
            style={{
              bottom: `calc(100% - ${mentionPos.top}px + 4px)`,
              left: `${Math.min(mentionPos.left, (editorRef.current?.offsetWidth ?? 224) - 224)}px`,
            }}
          >
            {filteredChannels.slice(0, 10).map((ch) => (
              <button
                key={ch.id}
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm text-dc-text-secondary hover:bg-dc-bg-modifier hover:text-dc-text-primary transition-colors cursor-pointer"
                onMouseDown={(e) => { e.preventDefault(); insertChannelMention(ch); }}
              >
                {ch.type === "voice" ? "🔊" : "#"} {ch.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
