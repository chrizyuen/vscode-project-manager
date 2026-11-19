/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import { execFile } from "child_process";
import { commands, l10n, ProgressLocation, window } from "vscode";
import { ProjectStorage } from "../storage/storage";
import { getGitRoots } from "../sidebar/storageProvider";

/** `git pull --ff-only` on the current branch; resolves false on any failure (no upstream, conflicts, offline...). */
function pull(cwd: string): Promise<boolean> {
    return new Promise(resolve => {
        execFile("git", [ "pull", "--ff-only" ], {
            cwd,
            timeout: 120000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
        }, error => resolve(!error));
    });
}

async function pullAllGitFolders(storage: ProjectStorage, refresh: () => void) {
    const roots = [ ...new Set(storage.getProjects().filter(p => p.enabled).flatMap(p => getGitRoots(p.rootPath))) ];
    if (roots.length === 0) {
        return;
    }
    const results = await window.withProgress(
        { location: ProgressLocation.Notification, title: l10n.t("Pulling latest in git folders...") },
        () => Promise.all(roots.map(pull)));
    // failures are ignored on purpose
    window.setStatusBarMessage(l10n.t("Pulled {0} of {1} git folders", results.filter(Boolean).length, roots.length), 5000);
    refresh();
}

export function registerPullAll(storage: ProjectStorage, refresh: () => void) {
    commands.registerCommand("_projectManager.git.pullAll#sideBar", () => pullAllGitFolders(storage, refresh));
}
