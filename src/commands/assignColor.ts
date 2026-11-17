/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/
import * as fs from "fs";
import * as path from "path";
import { commands, l10n, QuickPickItem, window } from "vscode";
import { Container } from "../core/container";
import { ProjectNode } from "../sidebar/nodes";
import { isRemotePath } from "../utils/remote";

const PRESET_COLORS: { label: string, color: string }[] = [
    { label: "Vue Green", color: "#42b883" },
    { label: "Azure Blue", color: "#007fff" },
    { label: "React Blue", color: "#61dafb" },
    { label: "Gatsby Purple", color: "#832561" },
    { label: "Angular Red", color: "#dd0531" },
    { label: "JavaScript Yellow", color: "#f9e64f" },
    { label: "Orange", color: "#fd9827" },
    { label: "Teal", color: "#00838f" }
];

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Sets (or removes, when `color` is undefined) `peacock.color` in `<project>/.vscode/settings.json`, keeping the rest of the file as is. */
export function writePeacockColor(projectPath: string, color: string | undefined): void {
    const dir = path.join(projectPath, ".vscode");
    const file = path.join(dir, "settings.json");
    let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const entry = /([ \t]*)"peacock\.color"\s*:\s*"[^"]*"\s*,?[ \t]*\r?\n?/;

    if (content.trim() === "") {
        if (!color) { return; }
        content = `{\n    "peacock.color": "${color}"\n}\n`;
    } else if (entry.test(content)) {
        content = color
            ? content.replace(/("peacock\.color"\s*:\s*)"[^"]*"/, `$1"${color}"`)
            : content.replace(entry, "").replace(/,(\s*\})\s*$/, "$1");
    } else if (color) {
        const close = content.lastIndexOf("}");
        if (close < 0) {
            throw new Error(l10n.t("Cannot update {0}: not a JSON object", file));
        }
        const before = content.slice(0, close).replace(/\s+$/, "");
        const needsComma = !before.endsWith("{") && !before.endsWith(",");
        content = `${before}${needsComma ? "," : ""}\n    "peacock.color": "${color}"\n${content.slice(close)}`;
    } else {
        return;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, content, "utf8");
}

async function assignColor(node: ProjectNode, refresh: () => void) {
    const projectPath = node?.preview?.path;
    if (!projectPath || isRemotePath(projectPath) || path.extname(projectPath) === ".code-workspace") {
        window.showWarningMessage(l10n.t("Colors can only be assigned to local folder projects"));
        return;
    }

    const items: (QuickPickItem & { color?: string, custom?: boolean, remove?: boolean })[] = [
        ...PRESET_COLORS.map(c => ({ label: `$(circle-filled) ${c.label}`, description: c.color, color: c.color })),
        { label: l10n.t("Custom color..."), custom: true },
        { label: l10n.t("Remove color"), remove: true }
    ];
    const picked = await window.showQuickPick(items, { placeHolder: l10n.t("Assign a color to {0}", node.label as string) });
    if (!picked) { return; }

    let color = picked.color;
    if (picked.custom) {
        color = await window.showInputBox({
            prompt: l10n.t("Hex color, e.g. #42b883"),
            validateInput: v => HEX_COLOR.test(v) ? undefined : l10n.t("Enter a hex color like #42b883")
        });
        if (!color) { return; }
    }

    try {
        writePeacockColor(projectPath, picked.remove ? undefined : color);
    } catch (e) {
        window.showErrorMessage((e as Error).message);
        return;
    }
    refresh();
}

export function registerAssignColor(refresh: () => void) {
    Container.context.subscriptions.push(commands.registerCommand("_projectManager.assignColor#sideBar", (node) => assignColor(node, refresh)));
}
