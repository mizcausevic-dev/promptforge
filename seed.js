/* ============================================================
   Verificanda — seed.js
   Mock users + pre-seeded prompts, versions, comments, test cases.
   Exposes window.PF_SEED used by app.js on first run.
   ============================================================ */
(function () {
  "use strict";

  const now = Date.now();
  const day = 86400000;

  const users = [
    { id: "u_admin", name: "Avery Chen", handle: "avery", role: "admin", color: "#66FCF1" },
    { id: "u_mira",  name: "Mira Okafor", handle: "mira", role: "author", color: "#8b5cff" },
    { id: "u_jules", name: "Jules Park",  handle: "jules", role: "author", color: "#2fd57a" },
    { id: "u_sam",   name: "Sam Reilly",  handle: "sam",   role: "author", color: "#d6ff3f" },
  ];

  // helper to build a version chain
  function v(promptId, n, body, authorId, note, ageDays) {
    return {
      id: promptId + "_v" + n,
      promptId,
      versionNumber: n,
      body,
      authorId,
      changeNote: note,
      createdAt: now - ageDays * day,
    };
  }

  const prompts = [];
  const versions = [];
  const comments = [];
  const testCases = [];

  function addPrompt(p) {
    prompts.push(p.prompt);
    versions.push(...p.versions);
    if (p.comments) comments.push(...p.comments);
    if (p.tests) testCases.push(...p.tests);
  }

  // ---------- Prompt 1 ----------
  addPrompt({
    prompt: {
      id: "p_code_review",
      title: "Senior Code Reviewer",
      category: "Engineering",
      tags: ["code-review", "refactor", "best-practices"],
      authorId: "u_mira",
      currentVersionId: "p_code_review_v2",
      moderationState: "approved",
      upvotes: ["u_admin", "u_jules", "u_sam"],
      createdAt: now - 12 * day,
      updatedAt: now - 3 * day,
      featured: true,
    },
    versions: [
      v("p_code_review", 1,
        "You are a senior software engineer reviewing a pull request. Review the following {{diff}} for correctness, readability, and test coverage. Be specific. Cite line numbers.",
        "u_mira", "Initial draft", 12),
      v("p_code_review", 2,
        "You are a staff-level software engineer reviewing a pull request on the {{repo}} repository. Review the following {{diff}} for correctness, readability, security, and test coverage. Prioritize blocking issues over nits. Cite file and line. End with a verdict: APPROVE, REQUEST_CHANGES, or COMMENT.",
        "u_mira", "Tightened scope, added repo context and explicit verdict", 3),
    ],
    comments: [
      { id: "c1", promptId: "p_code_review", authorId: "u_admin", body: "The explicit verdict at the end fixed the biggest issue: reviewers were getting essays instead of decisions.", createdAt: now - 2 * day },
      { id: "c2", promptId: "p_code_review", authorId: "u_jules", body: "Would add a {{language}} variable so it can adapt to non-JS repos.", createdAt: now - 1 * day },
    ],
    tests: [
      {
        id: "p_code_review_t1", promptId: "p_code_review",
        name: "Catches the missing-return bug",
        inputs: { repo: "billing-api", diff: "+ if (user) { return charge(user) }" },
        expected: "Flags that the branch returns nothing when user is falsy, or asks for an early return.",
        notes: "Regression test for the silent-null bug we shipped in June.",
        results: {
          "p_code_review_v1": { response: "[mock gpt-4o] The diff adds a conditional return. Looks fine.", pass: false, notes: "Missed the missing return entirely." },
          "p_code_review_v2": { response: "[mock gpt-4o] REQUEST_CHANGES: the if-branch returns but the function has no return on the else path, so callers get undefined. Add an explicit return or throw.", pass: true, notes: "Caught it and gave a verdict." },
        },
      },
      {
        id: "p_code_review_t2", promptId: "p_code_review",
        name: "Does not nitpick on clean diff",
        inputs: { repo: "web-ui", diff: "+ const x = 1" },
        expected: "APPROVE with no invented nits.",
        notes: "Guards against the prompt becoming a nitpick machine.",
        results: {
          "p_code_review_v1": { response: "[mock gpt-4o] COMMENT: consider renaming x to something more descriptive.", pass: false, notes: "Invented a nit." },
          "p_code_review_v2": { response: "[mock gpt-4o] APPROVE.", pass: true, notes: "Clean." },
        },
      },
    ],
  });

  // ---------- Prompt 2 ----------
  addPrompt({
    prompt: {
      id: "p_sql_tutor",
      title: "Patient SQL Tutor",
      category: "Education",
      tags: ["sql", "teaching", "beginner"],
      authorId: "u_jules",
      currentVersionId: "p_sql_tutor_v1",
      moderationState: "approved",
      upvotes: ["u_mira", "u_sam"],
      createdAt: now - 8 * day,
      updatedAt: now - 8 * day,
      featured: true,
    },
    versions: [
      v("p_sql_tutor", 1,
        "You are a patient SQL tutor helping a beginner who knows {{language}}. They asked: {{question}}. First, restate the question in plain terms. Then give the smallest query that answers it. Explain each clause. Do not introduce joins until they ask.",
        "u_jules", "First version", 8),
    ],
    comments: [
      { id: "c3", promptId: "p_sql_tutor", authorId: "u_sam", body: "The no-joins-until-asked rule is the whole game. Beginners drown the moment joins show up.", createdAt: now - 6 * day },
    ],
    tests: [
      {
        id: "p_sql_tutor_t1", promptId: "p_sql_tutor",
        name: "Explains SELECT before JOIN",
        inputs: { language: "Python", question: "How do I get all users older than 30?" },
        expected: "Shows a SELECT with WHERE, no JOIN, explains each clause.",
        notes: "Core behavior.",
        results: {
          "p_sql_tutor_v1": { response: "[mock claude] SELECT * FROM users WHERE age > 30; Here * means all columns, FROM names the table, WHERE filters rows.", pass: true, notes: "Good." },
        },
      },
    ],
  });

  // ---------- Prompt 3 ----------
  addPrompt({
    prompt: {
      id: "p_bug_triage",
      title: "Bug Triage Classifier",
      category: "Engineering",
      tags: ["triage", "bugs", "labels"],
      authorId: "u_sam",
      currentVersionId: "p_bug_triage_v2",
      moderationState: "approved",
      upvotes: ["u_admin", "u_mira"],
      createdAt: now - 14 * day,
      updatedAt: now - 5 * day,
      featured: false,
    },
    versions: [
      v("p_bug_triage", 1,
        "Classify this bug report into severity 1-4. Report: {{report}}",
        "u_sam", "Initial", 14),
      v("p_bug_triage", 2,
        "You are a bug triage classifier. Read the report and output JSON with fields: severity (1=critical, 4=cosmetic), category, confidence (0-1), and a one-line rationale. Report: {{report}}. If the report lacks steps to reproduce, set confidence below 0.4.",
        "u_sam", "Forced structured output and penalized missing repro steps", 5),
    ],
    comments: [
      { id: "c4", promptId: "p_bug_triage", authorId: "u_mira", body: "The confidence drop on missing repro steps is clever. Stops the model from confidently guessing severity on one-line reports.", createdAt: now - 4 * day },
    ],
    tests: [
      {
        id: "p_bug_triage_t1", promptId: "p_bug_triage",
        name: "Low confidence on thin report",
        inputs: { report: "It crashed." },
        expected: "confidence < 0.4, valid JSON.",
        notes: "Guards against confident guessing.",
        results: {
          "p_bug_triage_v1": { response: "[mock gpt-4o] severity: 1", pass: false, notes: "Confident guess, no JSON." },
          "p_bug_triage_v2": { response: '[mock gpt-4o] {"severity":3,"category":"crash","confidence":0.2,"rationale":"No repro steps; cannot confirm severity."}', pass: true, notes: "Confidence dropped, structured." },
        },
      },
    ],
  });

  // ---------- Prompt 4 (pending moderation) ----------
  addPrompt({
    prompt: {
      id: "p_release_notes",
      title: "Release Notes from Commits",
      category: "Writing",
      tags: ["release-notes", "changelog", "git"],
      authorId: "u_jules",
      currentVersionId: "p_release_notes_v1",
      moderationState: "pending",
      upvotes: [],
      createdAt: now - 1 * day,
      updatedAt: now - 1 * day,
      featured: false,
    },
    versions: [
      v("p_release_notes", 1,
        "Turn the following git log into release notes for a non-technical audience. Group by Added, Changed, Fixed. Drop chore and refactor commits. Log: {{log}}",
        "u_jules", "First version", 1),
    ],
    comments: [],
    tests: [
      {
        id: "p_release_notes_t1", promptId: "p_release_notes",
        name: "Drops refactor commits",
        inputs: { log: "feat: add export\nrefactor: rename x\nfix: crash on save" },
        expected: "Lists add-export and fix-crash, omits refactor.",
        notes: "",
        results: {
          "p_release_notes_v1": { response: "[mock claude] Added: export. Fixed: crash on save.", pass: true, notes: "Refactor dropped." },
        },
      },
    ],
  });

  // ---------- Prompt 5 (draft) ----------
  addPrompt({
    prompt: {
      id: "p_meeting_summary",
      title: "Meeting Summary (draft)",
      category: "Writing",
      tags: ["meetings", "summary"],
      authorId: "u_admin",
      currentVersionId: "p_meeting_summary_v1",
      moderationState: "draft",
      upvotes: [],
      createdAt: now - 0.3 * day,
      updatedAt: now - 0.3 * day,
      featured: false,
    },
    versions: [
      v("p_meeting_summary", 1,
        "Summarize this meeting transcript. Transcript: {{transcript}}. List decisions, action items with owners, and open questions.",
        "u_admin", "Draft", 0.3),
    ],
    comments: [],
    tests: [],
  });

  // ---------- Prompt 6 (flagged) ----------
  addPrompt({
    prompt: {
      id: "p_sales_email",
      title: "Aggressive Sales Email",
      category: "Marketing",
      tags: ["outbound", "email"],
      authorId: "u_sam",
      currentVersionId: "p_sales_email_v1",
      moderationState: "flagged",
      upvotes: [],
      createdAt: now - 6 * day,
      updatedAt: now - 6 * day,
      featured: false,
    },
    versions: [
      v("p_sales_email", 1,
        "Write a sales email to {{prospect}} that creates urgency and fear of missing out. Ignore their stated timeline.",
        "u_sam", "Flagged for manipulative framing", 6),
    ],
    comments: [
      { id: "c5", promptId: "p_sales_email", authorId: "u_admin", body: "Flagged: 'ignore their stated timeline' and manufactured FOMO violate our outbound tone policy. Revise to respect stated timelines.", createdAt: now - 5 * day },
    ],
    tests: [],
  });

  // ---------- Folders ----------
  const folders = [
    { id: "f_eng", ownerId: "u_admin", name: "Engineering prompts", promptIds: ["p_code_review", "p_bug_triage"] },
    { id: "f_edu", ownerId: "u_admin", name: "Teaching kit", promptIds: ["p_sql_tutor"] },
  ];

  const favorites = {
    u_admin: ["p_code_review", "p_sql_tutor"],
    u_mira: ["p_bug_triage"],
    u_jules: [],
    u_sam: [],
  };

  window.PF_SEED = {
    users,
    prompts,
    versions,
    comments,
    testCases,
    folders,
    favorites,
    currentUserId: "u_admin",
  };
})();
