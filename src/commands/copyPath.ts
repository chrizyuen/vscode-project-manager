/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as path from "path";
import { commands, env, l10n, window, workspace } from "vscode";
import { Container } from "../core/container";
import { isRemotePath } from "../utils/remote";
import { ProjectNode } from "../sidebar/nodes";

interface PathLikeNode {
    command?: { arguments?: any[] };
    folder?: string;
    fullPath?: string;
    change?: { file: string };
    item?: { file: string };
    roots?: string[];
}
function getNodePath(node: ProjectNode | PathLikeNode): string | undefined {
    const n = node as PathLikeNode;
    // project nodes carry the path in the command; Quick Access, path, TODO file and Git change nodes carry it directly
    return n?.folder ?? n?.fullPath ?? n?.change?.file ?? n?.item?.file ?? n?.roots?.[ 0 ] ?? n?.command?.arguments?.[ 0 ];
}

async function copyPath(node: ProjectNode | PathLikeNode) {
    const projectPath = getNodePath(node);
    if (!projectPath) { return; }
    await env.clipboard.writeText(projectPath);
}

async function copyRelativePath(node: ProjectNode | PathLikeNode) {
    const projectPath = getNodePath(node);
    if (!projectPath) { return; }

    const folders = workspace.workspaceFolders;
    if (isRemotePath(projectPath) || !folders || folders.length === 0) {
        window.showWarningMessage(l10n.t("No local workspace folder is open to calculate a relative path"));
        return;
    }

    const base = folders.find(f => f.uri.scheme === "file" &&
        (projectPath === f.uri.fsPath || projectPath.startsWith(f.uri.fsPath + path.sep))) ?? folders[ 0 ];
    await env.clipboard.writeText(path.relative(base.uri.fsPath, projectPath) || ".");
}

export function registerCopyPath() {
    Container.context.subscriptions.push(commands.registerCommand("_projectManager.copyPath#sideBar", (node) => copyPath(node)));
    Container.context.subscriptions.push(commands.registerCommand("_projectManager.copyRelativePath#sideBar", (node) => copyRelativePath(node)));
}
