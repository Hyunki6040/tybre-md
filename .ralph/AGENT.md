# Agent Build Instructions

## Project Setup
```bash
# Install frontend dependencies
npm install

# Install Tauri CLI globally (if needed)
cargo install tauri-cli --version "^2"
```

## Running Tests
```bash
# TypeScript type check (zero errors required before marking complete)
npm run type-check

# Frontend build test
npm run build
```

## Build Commands
```bash
# Frontend only (Vite build, verifies TypeScript + bundling)
npm run build

# Full Tauri desktop app
npm run tauri:build
```

## Development Server
```bash
# Frontend dev server only (browser)
npm run dev

# Full Tauri app with hot reload
npm run tauri:dev
```

## Project Structure
```
tybre-md/
├── src/                          # React frontend
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Root component + keyboard shortcuts
│   ├── editor/
│   │   ├── MilkdownEditor.tsx    # Milkdown editor component
│   │   └── SyntaxRevealNodeView.ts  # CRITICAL: PoC NodeView (## hides/shows)
│   ├── components/
│   │   ├── TabBar.tsx            # Multi-tab bar
│   │   └── Sidebar.tsx           # File tree sidebar
│   ├── store/
│   │   └── appStore.ts           # Zustand global state
│   └── styles/
│       ├── globals.css           # CSS variables (Paper/Ink tokens) + Milkdown styles
│       └── components.css        # Component-specific styles
├── src-tauri/                    # Rust/Tauri backend
│   ├── src/
│   │   ├── main.rs               # Tauri entry point
│   │   └── commands.rs           # IPC commands: read_file, write_file, open_folder, etc.
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Key Learnings
- Milkdown v7 NodeView injection: use `editor.action((ctx) => ctx.get(editorViewCtx))` AFTER `editor.create()` to patch `view.setProps({ nodeViews: { heading: factory } })`
- `prosemirror-model` exports `Node` which conflicts with DOM `Node` — import as `PmNode`
- `ViewMutationRecord` from `prosemirror-view` is the correct type for `ignoreMutation`
- tsconfig `moduleResolution: bundler` is required for Vite + Tauri compatibility
- Build output is ~660KB (Milkdown is heavy) — future optimization: lazy-load editor
- TypeScript strict mode: always `npm run type-check` before marking tasks complete

## Feature Development Quality Standards

**CRITICAL**: All new features MUST meet the following mandatory requirements before being considered complete.

### Testing Requirements

- **Minimum Coverage**: 85% code coverage ratio required for all new code
- **Test Pass Rate**: 100% - all tests must pass, no exceptions
- **Test Types Required**:
  - Unit tests for all business logic and services
  - Integration tests for API endpoints or main functionality
  - End-to-end tests for critical user workflows
- **Coverage Validation**: Run coverage reports before marking features complete:
  ```bash
  # Examples by language/framework
  npm run test:coverage
  pytest --cov=src tests/ --cov-report=term-missing
  cargo tarpaulin --out Html
  ```
- **Test Quality**: Tests must validate behavior, not just achieve coverage metrics
- **Test Documentation**: Complex test scenarios must include comments explaining the test strategy

### Git Workflow Requirements

Before moving to the next feature, ALL changes must be:

1. **Committed with Clear Messages**:
   ```bash
   git add .
   git commit -m "feat(module): descriptive message following conventional commits"
   ```
   - Use conventional commit format: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, etc.
   - Include scope when applicable: `feat(api):`, `fix(ui):`, `test(auth):`
   - Write descriptive messages that explain WHAT changed and WHY

2. **Pushed to Remote Repository**:
   ```bash
   git push origin <branch-name>
   ```
   - Never leave completed features uncommitted
   - Push regularly to maintain backup and enable collaboration
   - Ensure CI/CD pipelines pass before considering feature complete

3. **Branch Hygiene**:
   - Work on feature branches, never directly on `main`
   - Branch naming convention: `feature/<feature-name>`, `fix/<issue-name>`, `docs/<doc-update>`
   - Create pull requests for all significant changes

4. **Ralph Integration**:
   - Update .ralph/fix_plan.md with new tasks before starting work
   - Mark items complete in .ralph/fix_plan.md upon completion
   - Update .ralph/PROMPT.md if development patterns change
   - Test features work within Ralph's autonomous loop

### Documentation Requirements

**ALL implementation documentation MUST remain synchronized with the codebase**:

1. **Code Documentation**:
   - Language-appropriate documentation (JSDoc, docstrings, etc.)
   - Update inline comments when implementation changes
   - Remove outdated comments immediately

2. **Implementation Documentation**:
   - Update relevant sections in this AGENT.md file
   - Keep build and test commands current
   - Update configuration examples when defaults change
   - Document breaking changes prominently

3. **README Updates**:
   - Keep feature lists current
   - Update setup instructions when dependencies change
   - Maintain accurate command examples
   - Update version compatibility information

4. **AGENT.md Maintenance**:
   - Add new build patterns to relevant sections
   - Update "Key Learnings" with new insights
   - Keep command examples accurate and tested
   - Document new testing patterns or quality gates

### Feature Completion Checklist

Before marking ANY feature as complete, verify:

- [ ] All tests pass with appropriate framework command
- [ ] Code coverage meets 85% minimum threshold
- [ ] Coverage report reviewed for meaningful test quality
- [ ] Code formatted according to project standards
- [ ] Type checking passes (if applicable)
- [ ] All changes committed with conventional commit messages
- [ ] All commits pushed to remote repository
- [ ] .ralph/fix_plan.md task marked as complete
- [ ] Implementation documentation updated
- [ ] Inline code comments updated or added
- [ ] .ralph/AGENT.md updated (if new patterns introduced)
- [ ] Breaking changes documented
- [ ] Features tested within Ralph loop (if applicable)
- [ ] CI/CD pipeline passes

### Rationale

These standards ensure:
- **Quality**: High test coverage and pass rates prevent regressions
- **Traceability**: Git commits and .ralph/fix_plan.md provide clear history of changes
- **Maintainability**: Current documentation reduces onboarding time and prevents knowledge loss
- **Collaboration**: Pushed changes enable team visibility and code review
- **Reliability**: Consistent quality gates maintain production stability
- **Automation**: Ralph integration ensures continuous development practices

**Enforcement**: AI agents should automatically apply these standards to all feature development tasks without requiring explicit instruction for each task.
