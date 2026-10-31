---
name: gogoga-mindmap
description: Write mind maps for the gogoga Mind Map plugin for Obsidian. Use when the user asks to create, draft, or restructure a mind map, 思维导图 or 脑图 as an Obsidian note or as a mindmap code block inside a note, or to turn notes, an article, a book, a meeting or a plan into one. Covers which Markdown becomes nodes, the frontmatter keys for structure and theme, and the %%…%% markers for color, folding, boundaries, summaries and callouts.
---

# gogoga Mind Map

The plugin has no file format of its own: a mind map is a plain Markdown note. Headings and list items are the nodes, and styling lives in Obsidian comments (`%%…%%`) that don't show in Reading view. Write the note, and it opens as a mind map.

## Where to write it

- **A mind map note**: a `.md` file with `mindmap: true` in its frontmatter. It opens as a map.
- **A map inside an ordinary note**: a fenced code block named `mindmap` holding the same Markdown. It can have its own frontmatter at the top of the block.

## What becomes a node

- The single `#` heading is the central topic. Write exactly one. Without one, the file name is used.
- `##` to `######` headings are the levels below it, in order. Don't skip levels.
- Below headings, nested list items (`-`) are deeper levels. Indent with one tab per level.
- A plain paragraph right under a heading or list item is that node's **note** (shown behind a ≡ icon, not on the canvas). Under a list item, indent it to the item's child level.
- A note that itself contains list items or headings must be wrapped in a `> [!note]` callout, every line prefixed with `> `. Otherwise those lines turn into nodes. Always leave one blank line after the last `>` line, even when the next node follows right away: without it, Obsidian's Live Preview pulls the next list items into the callout.
- Keep node text short: a keyword or a short phrase. Put explanations in notes.

Good shape for most maps: `##` for main topics, `###` for subtopics, lists below that.

## Frontmatter

```yaml
---
mindmap: true                 # only for a mind map note; not needed inside a code block
mindmap-structure: mindmap    # logic-right (default) | mindmap (left and right) | org-down | tree-right
mindmap-theme: rainbow        # snow (default) | rainbow | business | warm | mono | line | forest
---
```

Leave structure and theme out unless the user asks or the content clearly calls for one (`org-down` for hierarchies and org charts, `mindmap` for a balanced overview with many main topics).

## Markers

One `%%…%%` comment per node holds all its markers, separated by spaces, for example `%%blue fold%%`.

- On a **heading**, put the comment on its own line right below the heading.
- On a **list item**, put it at the end of the line: `- Item %%red%%`.

| Marker | Meaning |
|---|---|
| `red` `orange` `yellow` `green` `teal` `blue` `purple` `pink` `gray`, or a hex color without `#` like `a3e5a2` | Node color |
| `fold` | Collapsed: children are hidden until clicked |
| `box` / `box=3` / `box "Title"` | Dashed frame around this node and its whole branch; `=3` also takes in the next two siblings |
| `summary "Text"` / `summary=2 "Text"` | Curly brace on the outer side of this node and its whole branch, with the summary text after it; `=2` stretches it over the next sibling too. To summarize several siblings, put it on the first one |
| `callout "Text"` | Small always-visible bubble next to the node; `<br>` for a line break, add `cc=yellow` to fill it |
| `hide` | Kept in the note but not shown in the map |

Text inside a marker can't contain straight double quotes `"` or `%%`.

Use markers sparingly: color the main topics to tell branches apart, fold branches that are details, and add a callout or a summary only where it says something the nodes don't.

## Inside node text

Inline Markdown works: `**bold**`, `==highlight==`, `[[Note]]` links, `[text](https://…)`, `#tags`, `$E=mc^2$` math, `![[image.png|160]]` images. `[ ]` / `[x]` at the start renders as a checkbox. Markers (priority, progress and so on) are emoji at the start of the text, such as ✅ ⏳ ❗ 1️⃣.

## Example: a mind map note

```markdown
---
mindmap: true
---

# Product launch

The launch plan for Q3.

## Goals
%%blue%%

- 10k sign-ups in the first month
- Press coverage in two outlets

## Timeline
%%green callout "Dates are tentative"%%

- Beta %%box "Phase 1"%%
	- Invite 200 users
	- Collect feedback
- Public release
	- Blog post
	- Newsletter

## Risks
%%red fold%%

- ❗ Payment provider review
	Approval can take up to three weeks.
- Server capacity
	> [!note]
	> - Load test in week 2
	> - Autoscaling as a fallback

## Owners
%%summary "Weekly sync on Mondays"%%

- Alice: product
- Bob: engineering
```

## Example: a map inside a note

````markdown
```mindmap
---
mindmap-structure: org-down
---

# Team

## Design
- Research
- UI

## Engineering
- Frontend
- Backend
```
````

## Checklist before handing it over

- Exactly one `#` heading, no skipped heading levels, tabs for list indentation.
- Markers under headings are on their own line; markers on list items are at the end of the line.
- Notes containing lists or headings are wrapped in `> [!note]` and followed by a blank line.
- For a mind map note, `mindmap: true` is in the frontmatter.
