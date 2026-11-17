/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { l10n } from "vscode";
import { PathNode, QuickAccessNode } from "./nodes";
import type { StorageNode } from "./storageProvider";

const URI_LIST_MIME = "text/uri-list";

/** Folder a drop on `target` copies into, or `undefined` when `target` is not part of Quick Access. */
function getDropFolder(target: StorageNode | undefined): string | undefined {
    if (target instanceof QuickAccessNode) {
        return target.folder;
    }
    if (target instanceof PathNode && target.browsable) {
        try {
            return fs.statSync(target.fullPath).isDirectory() ? target.fullPath : path.dirname(target.fullPath);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/** Local file paths dropped from the OS (or the Explorer view). */
async function getDroppedPaths(dataTransfer: vscode.DataTransfer): Promise<string[]> {
    const paths: string[] = [];
    const uriList = await dataTransfer.get(URI_LIST_MIME)?.asString();
    for (const line of (uriList ?? "").split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith("#")) {
            continue;
        }
        try {
            const uri = vscode.Uri.parse(value, true);
            if (uri.scheme === "file") {
                paths.push(uri.fsPath);
            }
        } catch {
            // not a URI: ignore
        }
    }
    if (paths.length === 0) {
        dataTransfer.forEach(item => {
            const uri = item.asFile()?.uri;
            if (uri?.scheme === "file") {
                paths.push(uri.fsPath);
            }
        });
    }
    return [ ...new Set(paths.map(p => path.resolve(p))) ];
}

function isInside(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** `name copy.ext`, `name copy 2.ext`, ... : the first name not used in `folder`. */
function uniqueName(folder: string, name: string): string {
    const ext = path.extname(name);
    const base = ext ? name.slice(0, -ext.length) : name;
    for (let i = 1; ; i++) {
        const candidate = `${base} copy${i > 1 ? ` ${i}` : ""}${ext}`;
        if (!fs.existsSync(path.join(folder, candidate))) {
            return candidate;
        }
    }
}

/**
 * Copies files and folders dropped on Quick Access (or one of its folders)
 * into that folder. The originals are never moved or changed.
 */
export class QuickAccessDropController implements vscode.TreeDragAndDropController<StorageNode> {
    public readonly dropMimeTypes = [ URI_LIST_MIME, "files" ];
    public readonly dragMimeTypes: string[] = [];

    constructor(private readonly onDidCopy: () => void) { }

    public async handleDrop(target: StorageNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const folder = getDropFolder(target);
        if (!folder) {
            return;
        }
        const sources = (await getDroppedPaths(dataTransfer)).filter(p => fs.existsSync(p));
        if (sources.length === 0 || token.isCancellationRequested) {
            return;
        }

        // copying a folder into itself (or into one of its subfolders) would never end
        const recursive = sources.filter(s => isInside(folder, s) && fs.statSync(s).isDirectory());
        if (recursive.length) {
            vscode.window.showWarningMessage(l10n.t("Cannot copy {0} into itself", recursive.map(r => path.basename(r)).join(", ")));
        }
        const toCopy = sources.filter(s => !recursive.includes(s) && path.dirname(s) !== folder);

        const conflicts = toCopy.filter(s => fs.existsSync(path.join(folder, path.basename(s))));
        let onConflict: "replace" | "keepBoth" = "keepBoth";
        if (conflicts.length) {
            const replace = l10n.t("Replace");
            const keepBoth = l10n.t("Keep Both");
            const names = conflicts.map(c => path.basename(c)).join(", ");
            const choice = await vscode.window.showWarningMessage(
                l10n.t("{0} already exists in {1}.", names, path.basename(folder)),
                { modal: true }, replace, keepBoth);
            if (!choice) {
                return;
            }
            onConflict = choice === replace ? "replace" : "keepBoth";
        }

        // dropping items onto their own folder makes copies next to them
        const sameFolder = sources.filter(s => !recursive.includes(s) && path.dirname(s) === folder);

        fs.mkdirSync(folder, { recursive: true });
        const failed: string[] = [];
        for (const source of [ ...toCopy, ...sameFolder ]) {
            let name = path.basename(source);
            const exists = fs.existsSync(path.join(folder, name));
            if (exists && (onConflict === "keepBoth" || sameFolder.includes(source))) {
                name = uniqueName(folder, name);
            }
            const destination = path.join(folder, name);
            if (isInside(source, destination)) {
                failed.push(l10n.t("{0} is inside the folder it would replace", path.basename(source)));
                continue;
            }
            try {
                if (exists && name === path.basename(source)) {
                    fs.rmSync(destination, { recursive: true, force: true });
                }
                fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
            } catch (error) {
                failed.push(`${path.basename(source)}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.onDidCopy();
        if (failed.length) {
            vscode.window.showErrorMessage(l10n.t("Could not copy {0}", failed.join("; ")));
        }
    }
}
