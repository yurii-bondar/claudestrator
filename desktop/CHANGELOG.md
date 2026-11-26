## [0.5.0](https://github.com/yurii-bondar/claudestrator/compare/desktop-claudestrator-v0.4.0...desktop-claudestrator-v0.5.0) (2026-11-26)

### Features

* **core:** view any scenario as a diagram, from a menu on each one ([be3887d](https://github.com/yurii-bondar/claudestrator/commit/be3887d2718d2ff618e0ec19ee29778239da151a))

## [0.4.0](https://github.com/yurii-bondar/claudestrator/compare/desktop-claudestrator-v0.3.0...desktop-claudestrator-v0.4.0) (2026-11-26)

### Features

* **core:** join a branch's checks with all, any and not ([32fa7d4](https://github.com/yurii-bondar/claudestrator/commit/32fa7d43c9be29010d19364709394b2d3407cf23))
* **core:** let one agent run outside the sandbox and write named folders ([8030045](https://github.com/yurii-bondar/claudestrator/commit/8030045264c848deb77bcea84161242f394fca1c))
* **core:** start a task from a chosen branch, and plan against it ([4910809](https://github.com/yurii-bondar/claudestrator/commit/4910809b9b856bcdba0d01fbec643eb58794eb78))

### Bug Fixes

* **core:** name the guard token so an agent outside the sandbox still sends it ([b5a436a](https://github.com/yurii-bondar/claudestrator/commit/b5a436a197053acc930848e8103679469ad77fb9))

## [0.3.0](https://github.com/yurii-bondar/claudestrator/compare/desktop-claudestrator-v0.2.0...desktop-claudestrator-v0.3.0) (2026-11-18)

### Features

* **core:** a plan's open questions are answered in place: the planner's answer picked, its other answers, your own words, and a new task for the work an answer leaves out ([3d9e20e](https://github.com/yurii-bondar/claudestrator/commit/3d9e20eec5cc37bbf9a038208a9d31602030a98b))
* **core:** a reviewed pull request's findings can be fixed in a new task, on its branch ([94cfb85](https://github.com/yurii-bondar/claudestrator/commit/94cfb8552fdd7ccd06d1171911866527db336635))
* **core:** an agent can be given only some of the MCP servers, from its config or a server's menu on Integrations ([17c778a](https://github.com/yurii-bondar/claudestrator/commit/17c778afcdb2e3e934f625d4b70eb16aa7895f46))
* **core:** Claude Code in a terminal with Claudestrator in context: its agents as subagents, and a bridge to start and follow tasks ([f8c6c94](https://github.com/yurii-bondar/claudestrator/commit/f8c6c949e6adfc6159fc6cdd434da9b86123ccfd))
* **core:** Integrations folds Jira & Confluence and Bitbucket to their status until you open one ([b8d0baf](https://github.com/yurii-bondar/claudestrator/commit/b8d0baf75742fd8fc9848627514ee5c4f2194c27))
* **core:** sync repos: pull the default branch into the picked repos, resolve conflicts with Claude Code, and delete the branches it already holds ([2a2c088](https://github.com/yurii-bondar/claudestrator/commit/2a2c0883badccf4fc5d52be9ec092e694fca45a7))
* **core:** the composer's scenarios menu lists names only; what a scenario does shows on its info icon ([43a9dfb](https://github.com/yurii-bondar/claudestrator/commit/43a9dfbc0a75d4fe0b7022032760c68819cd0c04))
* **core:** the rail's tasks are folded under Tasks until you open them ([7bf3720](https://github.com/yurii-bondar/claudestrator/commit/7bf3720b30feac0db4a1f77262d8e62638104b25))
* **vscode:** agents with some MCP servers only are started without the tools of the others ([9a3beca](https://github.com/yurii-bondar/claudestrator/commit/9a3beca04b65cfb0b4d92da4100c93f9a03135f1))
* **vscode:** open Claude Code with Claudestrator from the rail or the command palette ([9cea0be](https://github.com/yurii-bondar/claudestrator/commit/9cea0be33d826cc6f8751ad21745f6f542f1491b))
* **vscode:** Repos & checks syncs the picked repos and deletes their merged branches once confirmed ([77e79b4](https://github.com/yurii-bondar/claudestrator/commit/77e79b4bf31b245a205107d094c7d5bd0fdc4920))

### Bug Fixes

* **core:** the composer's scenarios menu stays closed until its button opens it ([dc1a8a5](https://github.com/yurii-bondar/claudestrator/commit/dc1a8a5e6f5d025de3892159feb237f16e300ca4))
* **core:** unsetting a field of an agent the project's config does not name no longer fails, and leaves no empty entry ([beb191f](https://github.com/yurii-bondar/claudestrator/commit/beb191fea0e16aa459eca0fcb84b6d6dbf34b1a3))

## [0.2.0](https://github.com/yurii-bondar/claudestrator/compare/desktop-claudestrator-v0.1.0...desktop-claudestrator-v0.2.0) (2026-11-13)

### Features

* **core:** ⌘-click on a task opens it in a tab, in every host ([9b3ff4c](https://github.com/yurii-bondar/claudestrator/commit/9b3ff4cfd1eedfe994dd6640fadad74a5db24c88))
* **core:** a Jira ticket with sub-tasks splits into tasks of their own, which you start from the list ([f857a9a](https://github.com/yurii-bondar/claudestrator/commit/f857a9a18a8a700052f2dfd99b3289108f489752))
* **core:** a skill for looking into a task, beside the others in Settings → Skills ([e0b2120](https://github.com/yurii-bondar/claudestrator/commit/e0b21201da8696023b6fd0ba15537771df0d070e))
* **core:** a task can keep the computer awake while it runs, with caffeinate or systemd-inhibit ([c28ef77](https://github.com/yurii-bondar/claudestrator/commit/c28ef77d196e8f537386d8dac8aadcf587fda1a9))
* **core:** a workspace that is a git repository gets the repo icon in the rail ([246fab9](https://github.com/yurii-bondar/claudestrator/commit/246fab9e3c0bb078a83236da210543ddf5b2f094))
* **core:** MCP servers you hide count in no warning ([510be69](https://github.com/yurii-bondar/claudestrator/commit/510be697be6ea54541fa496069a789d24392e6fa))
* **core:** primary buttons wear the brand orange in VS Code and JetBrains, as in the desktop app ([0c1ab48](https://github.com/yurii-bondar/claudestrator/commit/0c1ab489bbde64cde62eca694c3bfcde71a891c1)), closes [#b0522f](https://github.com/yurii-bondar/claudestrator/issues/b0522f) [#a24826](https://github.com/yurii-bondar/claudestrator/issues/a24826)
* **core:** Settings → Skills adds Claude Code skills Claudestrator brings, first one for writing libraries ([5177b94](https://github.com/yurii-bondar/claudestrator/commit/5177b94db6981a34c84a272cb0bc08f82ef5dd19))
* **core:** skills for the workspace map and for config and checks, beside the library one ([36e9d5c](https://github.com/yurii-bondar/claudestrator/commit/36e9d5cde1a7595864efe9f0a6c0f0070b41659d))
* **core:** tasks opened in a tab stay over every screen, in the order you drag them to ([8600867](https://github.com/yurii-bondar/claudestrator/commit/86008678c62896c37ac31f30dc9f95f1076a492f))
* **core:** the rail starts with the workspace's folder, not a second Claudestrator ([8a218b2](https://github.com/yurii-bondar/claudestrator/commit/8a218b20f4807877659a5f49adf8376bec1cdb25))
* **vscode:** "Open in Tab" on a task's menu, in the dashboard's rail and the sidebar ([3831841](https://github.com/yurii-bondar/claudestrator/commit/3831841595261391a99f661e66d0d33b9667fadf))

### Bug Fixes

* **core:** a button whose region is drawn anew while it is pressed still gets the click ([0eee6c5](https://github.com/yurii-bondar/claudestrator/commit/0eee6c5e485169149f46ea6e543b07d034c5d337))
* **core:** agents, checks and git hooks get the PATH a terminal has, nvm's node included ([6f2abd4](https://github.com/yurii-bondar/claudestrator/commit/6f2abd4ec2cf33bee229d0c2dc71189166b406b6))
* **core:** the side rail names the account in use as Start does, with its alias ([c415bc7](https://github.com/yurii-bondar/claudestrator/commit/c415bc77d37cbdb1a1a1e4b03496e5be886f936a))
* **desktop:** the first click on the window, back from another app, is a click ([4b753f4](https://github.com/yurii-bondar/claudestrator/commit/4b753f42d79cabdca02492c890390382e68b4e15))
