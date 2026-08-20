---
description: Live examples of all rspress-plugin-obsidian-wikilink features. See callouts, wikilinks, tags, highlights, footnotes, and transclusion in action.
tags:
  - examples
  - demo
---

# Live Examples

This page demonstrates every feature of the plugin. Since the plugin is enabled on this documentation site, everything you see below is rendered live.

## Callouts

Static callouts with different types:

> [!success] Success Callout
> This is a success callout. Use it for positive outcomes.

> [!question] Question Callout
> This is a question callout. Use it for open questions.

> [!bug] Bug Callout
> This is a bug callout. Use it to track known issues.

> [!example] Example Callout
> This is an example callout. Use it for code samples or demonstrations.

> [!quote] Quote Callout
> This is a quote callout. Use it for citations or quotations.

> [!abstract] Abstract Callout
> This is an abstract callout (aliases: `summary`, `tldr`).

> [!failure] Failure Callout
> This is a failure callout. Use it for negative outcomes (aliases: `fail`, `missing`).

> [!check] Check Callout
> This is a check callout (alias of `success`; also: `done`).

Callout titles are inline markdown — **bold**, *italics*, `code`, and
[[advanced|wikilinks]] all render inside the title:

> [!example] A **bold** title linking to [[advanced|Advanced Configuration]]
> The title above renders markdown and resolved wikilinks, matching Obsidian.

Foldable callouts:

> [!success]- Collapsed by Default
> This content is hidden until the user expands the callout.
> You can put multiple paragraphs inside.
>
> - Lists work too
> - And other markdown

> [!example]+ Expanded by Default
> This content is visible immediately, but the user can collapse it.

Nested callouts (a callout inside another callout):

> [!example] Outer Callout
> This is the outer callout containing a nested question.
>
> > [!question] Nested Question
> > This inner callout is fully processed and styled.
>
> Back to the outer callout content. Everything renders correctly thanks to post-order processing.

Triple nesting also works:

> [!abstract] Level 1
> > [!question] Level 2
> > > [!failure] Level 3
> > > Deepest content here.

> [!question] What about `note`, `tip`, `warning`, `danger`, and `info`?
> Rspress ships its own GitHub-style alert transform that claims those types
> (plus `caution` and `details`) *before* plugin remark plugins run, and its
> conversion leaks Obsidian's fold suffix and drops the first paragraph of
> multi-paragraph alerts. This plugin detects those already-converted nodes,
> verifies them against the original source, restores the original
> blockquotes, and renders them with full Obsidian semantics — automatically,
> whenever `enableCallouts` is on. Standard `:::note` directive containers
> keep Rspress's native styling.

The types Rspress claims internally, restored and rendered by the plugin:

> [!note] Note Callout
> This is a standard note callout. Use it for general information.

> [!tip] Tip Callout
> This is a tip callout. Use it for helpful suggestions.

> [!warning] Warning Callout
> This is a warning callout. Use it for cautionary information.

> [!danger] Danger Callout
> This is a danger callout. Use it for critical warnings.

> [!info] Info Callout
> This is an info callout. Use it for supplementary details.

Foldable variants of the restored types — the fold suffix and first paragraph
survive the round trip through Rspress's transform:

> [!note]- Collapsed by Default
> This content is hidden until the user expands the callout.
> You can put multiple paragraphs inside.
>
> - Lists work too
> - And other markdown

> [!tip]+ Expanded by Default
> This content is visible immediately, but the user can collapse it.

Nested callouts using restored types:

> [!note] Outer Callout
> This is the outer note callout containing a nested tip.
>
> > [!tip] Nested Tip
> > This inner callout is fully processed and styled.
>
> Back to the outer callout content. Everything renders correctly thanks to post-order processing.

## Text Highlighting

You can ==highlight important text== using double equals signs. This is great for ==drawing attention== to key concepts in your documentation.

## Wikilinks

Link to other pages in your documentation:

- [[getting-started|Getting Started Guide]] — the main installation and setup guide
- [[advanced|Advanced Configuration]] — detailed options and behavior
- [[api|API Reference]] — programmatic usage and types

Standard markdown links to vault pages resolve through the same rules — Obsidian accepts both syntaxes:

- [Markdown link to the guide](getting-started.md) — the `.md` destination is resolved like a wikilink
- [Markdown link to the vault root](index.md) — resolves the vault root page, not a relative path
- [Markdown link with an anchor](getting-started.md#Install) — `#anchor` destinations resolve to heading slugs

Current page anchor links:

- [[#Callouts]] — jump to the callouts section
- [[#Footnotes]] — jump to the footnotes section

## Tags

This page has the tags #examples and #demo in its frontmatter. When `enableTagLinking` and `enableTagPages` are on, inline tags become links and auto-generated tag pages list all matching pages.

## Footnotes

Footnotes are useful for citations and references[^1]. You can also use inline footnotes^[Like this one, which appears in the text itself] for brief asides.

Multiple footnotes work fine too[^2]. They are collected and rendered at the bottom of the page automatically.

## Obsidian Comments

Comments are stripped from the output. %% This text will not appear in the rendered page. %% Only the visible text remains.

Multi-line comments are also stripped:

%%
This entire block
is a private note
and will not be published.
%%

## Transclusion Demo

The section below is transcluded from the Getting Started page. It demonstrates how `![[Page#Heading]]` embeds content from another file.

![[getting-started#Embed & Transclusion Syntax]]

## Backlinks

Scroll to the bottom of this page to see the backlinks panel — it lists all pages that link to this one.

[^1]: This is a labeled footnote definition. It appears at the end of the page.
[^2]: Another labeled footnote. The plugin handles duplicates gracefully.
