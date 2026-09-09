# PromptForge

A local-first, collaborative prompt-engineering platform. Versioned prompts, named variables, side-by-side test cases against mock model responses, and a moderation queue. No backend, no accounts. All data lives in your browser's `localStorage`.

## What it is

A working demo of a prompt library that treats prompts like software: tracked revisions (not overwrites), fill-in variables, a generated form, live preview, copy-with-validation, test cases comparing versions against mock model responses, folders/favorites, import/export, and a moderation workflow (draft / pending / approved / flagged).

## Run it

Zero dependencies, zero build step. Open `index.html` directly, or serve it:

```bash
npx serve .
# then open the printed URL
```

All state persists in `localStorage` under `promptforge.db.v1`. Use **Reset demo data** on the browse page to restore the original seed.

## Features

- **Data model:** prompts with title, body with `{{variables}}`, category, tags, author, version history, moderation state, upvotes, comments.
- **Browse / discovery:** featured prompts, category filters, tag filters, full-text search, Best / New / Hot sort tabs. Public browse shows only approved prompts.
- **Detail page:** body, variable fill form (auto-generated from the prompt), live resolved preview, one-click copy with inline missing-variable validation, version history, attribution panel (original author + contributors), comments, test-case table.
- **Editing workflow:** create prompts, submit revisions as new versions (previous bodies preserved), live preview while editing, seed sample test cases.
- **Organization:** folders/collections, favorites, tags, JSON import/export.
- **Testing layer:** per-prompt test cases (name, expected outcome, notes, variable inputs) with mock model responses shown side-by-side across versions, with PASS/FAIL pills and re-run.
- **Persistence:** `localStorage`. Clear empty states for new users.
- **Moderation:** flag / approve / reject states visible to admins in a dedicated queue; non-approved prompts are hidden from public browse.
- **Mock accounts:** four client-side users (one admin). Switch with the "View as" selector in the top bar. No real auth.

## Architecture

Single-page app, vanilla JS, no framework, no dependencies. Three files:

- `index.html` - shell
- `styles.css` - BERT dark theme + effects (CSSJS Effects Cookbook)
- `seed.js` - mock users + pre-seeded prompts, versions, comments, test cases
- `app.js` - state, persistence, hash routing, all views, event delegation

State is a single `db` object persisted to `localStorage` on every mutation. Routing is hash-based (`#/browse`, `#/prompt/:id`, `#/edit/:id`, `#/new`, `#/mine`, `#/favorites`, `#/folders`, `#/folder/:id`, `#/admin`).

## Repurposing

The data model and views are domain-agnostic. The same shape (versioned items, variables, test cases, moderation) ports to any review-governed content library: runbooks, policies, eval datasets, or internal knowledge articles. Swap the seed and the category taxonomy.
