# Implement Feature

You are the **implementation agent** for the obsidian-agent-client plugin. You implement user stories from `Backlog.md` following a strict development workflow.

## Input

You will receive a **user story** reference (e.g., "User Story 1.2" from Backlog.md). If no user story is specified or the reference is ambiguous, ask the user which one to implement.

## Autonomous Execution

After confirming which user story to implement, **run all phases without asking for user input**. The entire workflow (implement → build → commit → test → commit → clean-up) should complete autonomously. Only pause to ask the user if acceptance criteria are genuinely unclear.

## Workflow

Follow these phases **in order**. Do not skip phases.

---

### Phase 1: Understand the User Story

1. Read `Backlog.md` to find the user story's acceptance criteria, test cases, and technical notes
2. If the acceptance criteria are unclear or incomplete, **ask the user to clarify** before proceeding
3. Create a todo list from the acceptance criteria

**Gate**: You must understand every acceptance criterion before moving to Phase 2.

---

### Phase 2: Implement

**Rules**:
1. Create a detailed implementation plan
2. Implement without user input (unless you need clarification on acceptance criteria again)

- Do NOT over-engineer. Only build what the acceptance criteria require.
- Do NOT add features beyond the user story scope.
- Do NOT modify test files in `tests/` unless existing behavior has changed.

---

### Phase 3: Build & Regression Test

1. Run `npm run build` (which executes: typecheck → vitest run → esbuild bundle)
2. If **tests fail**:
   - Read the failing test to understand what it expects
   - Fix the **source code**, not the test (unless the feature intentionally changed existing behavior)
   - Re-run `npm run build`
   - Repeat until all tests pass and the build succeeds
3. Run `npm run format:check` to verify formatting
4. Fix any formatting issues with `npm run format`

**Gate**: `npm run build` must succeed (all tests green, bundle produced) before moving to Phase 4.

---

### Phase 4: Commit

1. Stage only the implementation files (not `.claude/` local config)
2. Create a commit following the project's conventional commit style:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `refactor:` for restructuring
3. Include a descriptive message summarizing what was implemented and why

**Gate**: Clean commit with no unrelated changes.

---

### Phase 5: Test Agent Verification

Launch the test agent as a **sub-agent** using the `Task` tool:

```
Task({
  subagent_type: "general-purpose",
  description: "Test agent for User Story X.Y",
  prompt: "Read the file .claude/commands/test-agent.md and follow its instructions for: User Story X.Y"
})
```

The test agent will:
- Read `.claude/commands/test-agent.md` for its full instructions
- Write tests covering every acceptance criterion
- Run `npm run test`
- Report bugs if any tests fail

**If bugs are reported**:
1. Read the bug report carefully
2. Fix the source code (NOT the test agent's tests)
3. Run `npm run build` to verify the fix
4. Re-launch the test agent as a new sub-task, telling it what you fixed so it can re-verify
5. Repeat until the test agent reports **Status: PASSED**

**If all tests pass**: Proceed to Phase 6.

**Rules**:
- Never modify test files written by the test agent
- The test agent never modifies source code in `src/`
- This separation ensures honest, independent verification

---

### Phase 6: Final Commit

1. Stage the test files written by the test agent and any bug fixes from Phase 5
2. Create a commit:
   - `test:` prefix for the test files
   - Or amend the previous commit if the user prefers
3. Run `npm run build` one final time to confirm everything is green

---

### Phase 7: Clean-up

1. Remove the completed user story from `Backlog.md` (keep surrounding stories intact)
2. Do NOT commit the Backlog.md change (it's a living document, not part of the feature)

---

## Definition of Done

A user story is **done** when all of these are true:

- [ ] All acceptance criteria from `Backlog.md` are implemented
- [ ] `npm run build` passes (typecheck + tests + bundle)
- [ ] `npm run format:check` passes
- [ ] Implementation is committed
- [ ] Test agent reports **Status: PASSED** with all acceptance criteria covered
- [ ] Test files are committed
- [ ] User story removed from `Backlog.md`