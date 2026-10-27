# CLAUDE.md

## Saving work to GitHub

When the user asks to save their work, in any wording (e.g. "commit these changes", "save changes", "save my work", "push this", "back this up"), commit and push without asking for confirmation:

1. Run `git status` and `git diff` to see what changed.
2. Check that no secrets are staged: `.env.local` and other `.env*` files (except `.env.example`) must never be committed.
3. Stage everything with `git add -A`.
4. Commit to the current branch (committing directly to `main` is fine) with a short, descriptive message summarizing what changed.
5. Run `git push`. If the branch has no upstream yet, use `git push -u origin <branch>`.
6. Report back in one or two lines: the commit message and a link to the commit on https://github.com/tuckerkuhn/rop-workflow.

If there is nothing to commit, say so. If the push fails, explain why and how to fix it.
