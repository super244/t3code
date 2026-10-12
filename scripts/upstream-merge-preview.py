#!/usr/bin/env python3
# agent-watermark: model=haiku-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-12
"""Preview merging upstream into this branch without touching the worktree.

Fetches origin, then asks git merge-tree to build the merge in memory. Prints JSON:
  behind, ahead                 commits only upstream / only here
  conflicts                     paths that would conflict
  orchestratorV2Paths           conflicting paths under orchestration/ or with v2 in the name
"""

import argparse
import json
import re
import subprocess
import sys


def git(*args, check=True):
    return subprocess.run(["git", *args], check=check, capture_output=True, text=True)


def conflict_paths(ours, theirs):
    """Conflicting paths from git merge-tree; exit code 1 means conflicts, 0 means clean."""
    result = git("merge-tree", "--write-tree", "--name-only", ours, theirs, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.strip() or "git merge-tree failed")
    lines = result.stdout.splitlines()
    # Output: the result tree id, one line per conflicted path, a blank line, then messages.
    body = []
    for line in lines[1:]:
        if line == "":
            break
        body.append(line)
    return sorted(set(body))


def is_orchestrator_v2(path):
    return bool(re.search(r"(^|/)orchestrat", path, re.IGNORECASE) or re.search(r"v2", path, re.IGNORECASE))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ours", default="main", help="Local branch to merge into.")
    parser.add_argument("--theirs", default="origin/main", help="Upstream ref to merge from.")
    parser.add_argument("--no-fetch", action="store_true", help="Skip git fetch origin.")
    args = parser.parse_args(argv)
    try:
        if not args.no_fetch:
            git("fetch", "origin")
        ahead_text, behind_text = git("rev-list", "--left-right", "--count", f"{args.ours}...{args.theirs}").stdout.split()
        conflicts = conflict_paths(args.ours, args.theirs)
    except (subprocess.CalledProcessError, RuntimeError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(json.dumps({"error": detail}, indent=2))
        return 1
    print(
        json.dumps(
            {
                "ours": args.ours,
                "theirs": args.theirs,
                "ahead": int(ahead_text),
                "behind": int(behind_text),
                "conflicts": conflicts,
                "orchestratorV2Paths": [path for path in conflicts if is_orchestrator_v2(path)],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
