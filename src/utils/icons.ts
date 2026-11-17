/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import fs = require("fs");
import path = require("path");
import { IconPath, Uri, workspace } from "vscode";
import { codicons } from "vscode-ext-codicons";
import { Container } from "../core/container";
import { isRemoteUri, REMOTE_PREFIX, VIRTUAL_WORKSPACE_PREFIX } from "./remote";

export function currentIconThemeHasFolderIcon(): boolean {
    const currentIconTheme = workspace.getConfiguration("workbench").get<string>("iconTheme", "");

    return currentIconTheme === null || currentIconTheme === "vs-seti";
}

function translateCodiconToLocalIcons(codicon: string): string {
    switch (codicon) {
        case codicons.file_code: return "vscode";
        case codicons.git_branch: return "git";
        case codicons.zap: return "svn";
        case codicons.file_directory: return "folder";
        case codicons.root_folder: return "favorites-workspace";
        default: return codicon;
    }
}

export function getProjectIconPath(icon: string, lightDark: string): string {
    return "docs/images/ico-" + translateCodiconToLocalIcons(icon) + "-" + lightDark + ".svg";
}

export function getProjectIcon(icon: string, projectPath: string): string | IconPath {
    if (projectPath.startsWith(`${REMOTE_PREFIX}://codespaces`)) {
        return {
            light: Uri.joinPath(Container.context.extensionUri, getProjectIconPath("favorites-remote-codespaces", "light")),
            dark: Uri.joinPath(Container.context.extensionUri, getProjectIconPath("favorites-remote-codespaces", "dark"))
        };
    }

    return {
        light: Uri.joinPath(Container.context.extensionUri, getProjectIconPath(icon, "light")),
        dark: Uri.joinPath(Container.context.extensionUri, getProjectIconPath(icon, "dark"))
    };
}

export function getCodiconFromUri(uri: Uri): string {
    if (!isRemoteUri(uri)) {
        return codicons.file_directory;
    }

    return uri.scheme === REMOTE_PREFIX
        ? codicons.remote_explorer
        : codicons.remote;
}

export interface TooltipIconInfo {
    icon: string,
    title: string
}

export function getIconDetailsFromProjectPath(projectPath: string): TooltipIconInfo {
    if (projectPath.startsWith(`${REMOTE_PREFIX}://codespaces`)) {
        return {
            icon: codicons.github,
            title: "Codespaces"
        };
    }
    if (projectPath.startsWith(`${REMOTE_PREFIX}://dev-container`)) {
        return {
            icon: codicons.symbol_method,
            title: "Container"
        };
    }
    if (projectPath.startsWith(`${REMOTE_PREFIX}://ssh`)) {
        return {
            icon: codicons.terminal,
            title: "SSH"
        };
    }
    if (projectPath.startsWith(`${REMOTE_PREFIX}://wsl`)) {
        return {
            icon: codicons.terminal_linux,
            title: "WSL"
        };
    }
    if (projectPath.startsWith(`${VIRTUAL_WORKSPACE_PREFIX}://`)) {
        return {
            icon: codicons.remote,
            title: "Virtual Workspace"
        };
    }
    if (path.extname(projectPath) === ".code-workspace") {
        return {
            icon: codicons.root_folder,
            title: "Workspace"
        };
    }
    return {
        icon: codicons.folder,
        title: "Folder"
    };
}

/** Reads the Peacock color (`peacock.color`) from a local project's `.vscode/settings.json`, if any. */
export function getPeacockColor(projectPath: string): string | undefined {
    if (isRemoteUri(Uri.file(projectPath)) || path.extname(projectPath) === ".code-workspace") {
        return undefined;
    }
    try {
        const content = fs.readFileSync(path.join(projectPath, ".vscode", "settings.json"), "utf8");
        const match = /"peacock\.color"\s*:\s*"(#[0-9a-fA-F]{3,8})"/.exec(content);
        return match ? match[1] : undefined;
    } catch {
        return undefined;
    }
}

/** A folder icon filled with the given hex color, as a data URI. */
export function getColoredFolderIcon(color: string): Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="${color}" d="M1.5 2h5l1 1h7a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5z"/></svg>`;
    return Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}
