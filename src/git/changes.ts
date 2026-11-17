/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { execFile } from "child_process";
import * as path from "path";

/** A file with uncommitted changes, from `git status`. */
export interface GitChange {
    /** Absolute path of the file (the new path for renames) */
    file: string;
    /** Folder the change was listed for */
    root: string;
    /** Two-letter porcelain status (index, work tree), e.g. "M ", " M", "??" */
    status: string;
    /** Original path, for renames and copies */
    originalFile?: string;
}

export const MAX_GIT_CHANGES = 500;

function git(cwd: string, args: string[]): Promise<string | undefined> {
    return new Promise(resolve => {
        execFile("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
            resolve(error ? undefined : stdout);
        });
    });
}

/**
 * Files with uncommitted changes under `root` (staged, unstaged and untracked,
 * honoring .gitignore). Returns `undefined` when `root` is not in a git repository.
 */
export async function getGitChanges(root: string): Promise<GitChange[] | undefined> {
    // `root`'s path inside the repository; building paths from it (rather than
    // from the top level) keeps them under `root` even through symlinks
    const prefix = await git(root, [ "rev-parse", "--show-prefix" ]);
    if (prefix === undefined) {
        return undefined;
    }
    const toFile = (repoPath: string) => path.join(root, path.relative(prefix.trim(), repoPath));
    const out = await git(root, [ "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "." ]);
    if (out === undefined) {
        return undefined;
    }
    // porcelain paths are relative to the repository root
    const fields = out.split("\0");
    const changes: GitChange[] = [];
    for (let i = 0; i < fields.length; i++) {
        const entry = fields[ i ];
        if (entry.length < 4) {
            continue;
        }
        const status = entry.substring(0, 2);
        const change: GitChange = { file: toFile(entry.substring(3)), root, status };
        if (status[ 0 ] === "R" || status[ 0 ] === "C") {
            change.originalFile = toFile(fields[ ++i ] ?? "");
        }
        changes.push(change);
    }
    return changes.sort((a, b) => a.file.localeCompare(b.file));
}

export interface GitStatusInfo {
    /** Single letter shown next to the file */
    letter: string;
    /** Readable status, for the tooltip */
    label: string;
    /** Theme color id */
    color: string;
    deleted: boolean;
}

/** Maps a porcelain status to the letter and color used by the built-in Git extension. */
export function describeGitStatus(status: string): GitStatusInfo {
    const [ x, y ] = status;
    if (status === "??") {
        return { letter: "U", label: "Untracked", color: "gitDecoration.untrackedResourceForeground", deleted: false };
    }
    if (x === "U" || y === "U" || status === "AA" || status === "DD") {
        return { letter: "!", label: "Conflict", color: "gitDecoration.conflictingResourceForeground", deleted: false };
    }
    if (x === "D" || y === "D") {
        return { letter: "D", label: "Deleted", color: "gitDecoration.deletedResourceForeground", deleted: true };
    }
    if (x === "R") {
        return { letter: "R", label: "Renamed", color: "gitDecoration.renamedResourceForeground", deleted: false };
    }
    if (x === "A" || x === "C") {
        return { letter: "A", label: "Added", color: "gitDecoration.addedResourceForeground", deleted: false };
    }
    const staged = x !== " " && y === " ";
    return {
        letter: "M",
        label: staged ? "Modified (staged)" : "Modified",
        color: staged ? "gitDecoration.stageModifiedResourceForeground" : "gitDecoration.modifiedResourceForeground",
        deleted: false
    };
}
