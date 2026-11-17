/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ThemeColor, window } from 'vscode';
import { Container } from '../core/container';
import { GROUP_URI_SCHEME, QUICK_ACCESS_GROUP_COLOR, TODOS_GROUP_COLOR } from './nodes';

export function registerSideBarDecorations() {
    window.registerFileDecorationProvider({
        provideFileDecoration: (uri) => {
            if (uri.scheme === GROUP_URI_SCHEME) {
                return { color: new ThemeColor(uri.path === '/todos' ? TODOS_GROUP_COLOR : QUICK_ACCESS_GROUP_COLOR) };
            }
            if (uri.scheme !== 'projectManager-view') return undefined;

            if (Container.currentProject && uri.path === Container.currentProject.rootPath) {
                return {
                    badge: '✔',
                    color: new ThemeColor('projectManager.sideBar.currentProjectHighlightForeground')
                };
            }
        }
    });
}
