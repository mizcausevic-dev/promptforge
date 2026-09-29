/* ============================================================
   Verificanda — tests.js
   Framework-free unit tests for the pure logic. Loaded by tests.html
   after app.js (with PF_TEST_MODE=true so init() does not auto-run).
   Exposes results on window.PF_TEST_RESULTS and renders into #results.
   ============================================================ */
(function () {
  "use strict";

  const PF = window.PF;
  const results = [];
  let passed = 0, failed = 0;

  function eq(a, b, msg) {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    results.push({ name: msg, ok, got: a, want: b });
    ok ? passed++ : failed++;
    return ok;
  }
  function ok(cond, msg) { results.push({ name: msg, ok: !!cond }); cond ? passed++ : failed++; }
  function run(name, fn) { try { fn(); } catch (e) { failed++; results.push({ name: name + " [threw]", ok: false, err: e.message }); } }

  // ---------- extractVars ----------
  run("extractVars: basic two", () => {
    eq(PF.extractVars("Hello {{name}}, fix {{repo}} please"), ["name", "repo"], "two named vars");
  });
  run("extractVars: dedupes and ignores whitespace", () => {
    eq(PF.extractVars("{{ a }} {{a}} {{ a }}"), ["a"], "dedupes");
  });
  run("extractVars: rejects invalid names", () => {
    eq(PF.extractVars("{{1bad}} {{}} {{-x}} text"), [], "no valid vars from bad names");
  });
  run("extractVars: empty body", () => {
    eq(PF.extractVars(""), [], "empty body -> no vars");
  });

  // ---------- resolveVars ----------
  run("resolveVars: fills and reports missing", () => {
    const r = PF.resolveVars("{{a}} and {{b}}", { a: "X" });
    eq(r.text, "X and {{b}}");
    eq(r.missing, ["b"]);
  });
  run("resolveVars: empty string counts as missing", () => {
    const r = PF.resolveVars("{{a}}", { a: "" });
    eq(r.missing, ["a"], "empty value is missing");
    eq(r.text, "{{a}}");
  });
  run("resolveVars: null inputs", () => {
    const r = PF.resolveVars("{{a}}", null);
    eq(r.missing, ["a"]);
  });
  run("resolveVars: all filled", () => {
    const r = PF.resolveVars("{{a}}-{{b}}", { a: "1", b: "2" });
    eq(r.text, "1-2");
    eq(r.missing, []);
  });

  // ---------- evalResponse ----------
  run("evalResponse: quoted phrase required", () => {
    ok(PF.evalResponse("Returns COMMENT.", 'Expect "APPROVE"') === false, "missing quoted phrase fails");
    ok(PF.evalResponse("Returns APPROVE now", 'Expect "APPROVE"') === true, "present quoted phrase passes");
  });
  run("evalResponse: 60% token threshold", () => {
    // expected tokens (len>3): returns, approve, with, verdict -> 4 tokens
    // response contains 3 of 4 -> 75% -> pass
    ok(PF.evalResponse("returns approve with verdict", "returns approve with verdict and rationale") === true, "3/4 tokens pass");
    // response contains 1 of 4 -> 25% -> fail
    ok(PF.evalResponse("returns only", "returns approve with verdict and rationale") === false, "1/4 tokens fail");
  });
  run("evalResponse: empty expected passes on non-empty response", () => {
    ok(PF.evalResponse("anything", "") === true, "empty expected + non-empty response passes");
    ok(PF.evalResponse("", "") === false, "empty expected + empty response fails (no criteria to satisfy)");
  });

  // ---------- validateImport ----------
  run("validateImport: rejects non-object", () => {
    const r = PF.validateImport(null);
    ok(r.errors.length > 0, "null rejected");
  });
  run("validateImport: rejects empty users", () => {
    const r = PF.validateImport({ prompts: [], users: [] });
    ok(r.errors.some(e => /users\[\] is empty/.test(e)), "empty users blocked");
  });
  run("validateImport: accepts well-formed payload", () => {
    const r = PF.validateImport({ prompts: [{ id: "p1", title: "T", currentVersionId: "v1", upvotes: [] }], users: [{ id: "u1", name: "A", handle: "a", role: "author", color: "#fff" }] });
    eq(r.errors, [], "no errors on valid payload");
    eq(r.warnings, [], "no warnings");
  });
  run("validateImport: warns on unknown upvote user", () => {
    const r = PF.validateImport({ prompts: [{ id: "p1", title: "T", currentVersionId: "v1", upvotes: ["ghost"] }], users: [{ id: "u1", name: "A", handle: "a", role: "author", color: "#fff" }] });
    ok(r.warnings.some(w => /unknown upvote/.test(w)), "warns on ghost upvote");
  });
  run("validateImport: rejects wrong types", () => {
    const r = PF.validateImport({ prompts: "x", users: [{ id: "u1", name: "A", handle: "a", role: "author", color: "#fff" }] });
    ok(r.errors.some(e => /prompts\[\]/.test(e)), "prompts not array");
  });

  // ---------- mergeImport ----------
  run("mergeImport: merges prompts by id, import wins", () => {
    PF.state.db = { users: [{ id: "u1", name: "A", handle: "a", role: "author", color: "#fff" }], prompts: [{ id: "p1", title: "old", currentVersionId: "v1", upvotes: [] }], versions: [], comments: [], testCases: [], folders: [], favorites: {}, currentUserId: "u1" };
    PF.mergeImport({ prompts: [{ id: "p1", title: "new", currentVersionId: "v1", upvotes: [] }, { id: "p2", title: "added", currentVersionId: "v2", upvotes: [] }], users: [{ id: "u1", name: "A", handle: "a", role: "author", color: "#fff" }], versions: [], testCases: [] });
    eq(PF.state.db.prompts.length, 2, "two prompts after merge");
    eq(PF.state.db.prompts.find(p => p.id === "p1").title, "new", "import wins on conflict");
    eq(PF.state.db.schemaVersion, PF.SCHEMA_VERSION, "schemaVersion stamped");
  });
  run("mergeImport: refuses to wipe users when import users empty", () => {
    PF.state.db = { users: [{ id: "u1", name: "A", handle: "a", role: "author", color: "#fff" }], prompts: [], versions: [], comments: [], testCases: [], folders: [], favorites: {}, currentUserId: "u1" };
    PF.mergeImport({ prompts: [], users: [], versions: [] });
    eq(PF.state.db.users.length, 1, "users preserved when import users empty");
  });

  // ---------- parseHash (routing) ----------
  run("parseHash: browse default", () => {
    location.hash = "";
    eq(PF.parseHash().name, "browse");
  });
  run("parseHash: prompt with id", () => {
    location.hash = "#/prompt/p_code_review";
    const r = PF.parseHash();
    eq(r.name, "prompt");
    eq(r.params.id, "p_code_review");
  });
  run("parseHash: edit decodes id", () => {
    location.hash = "#/edit/p_x%20y";
    const r = PF.parseHash();
    eq(r.name, "edit");
    eq(r.params.id, "p_x y");
  });
  run("parseHash: folder route", () => {
    location.hash = "#/folder/f_eng";
    const r = PF.parseHash();
    eq(r.name, "folder");
    eq(r.params.id, "f_eng");
  });
  run("parseHash: new route", () => {
    location.hash = "#/new";
    eq(PF.parseHash().name, "new");
  });

  // ---------- Report ----------
  window.PF_TEST_RESULTS = { passed, failed, results };
  function render() {
    const host = document.getElementById("results");
    if (!host) return;
    const summary = `<div class="test-summary ${failed ? "fail" : "pass"}">${passed} passed, ${failed} failed</div>`;
    const rows = results.map(r => `<div class="test-row ${r.ok ? "pass" : "fail"}"><span class="test-mark">${r.ok ? "✓" : "✗"}</span><span class="test-name">${r.name}</span>${r.err ? `<span class="test-err">${r.err}</span>` : ""}</div>`).join("");
    host.innerHTML = summary + rows;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
