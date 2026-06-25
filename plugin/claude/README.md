# Maket — Claude Code Plugin

Turns Claude into a visual design collaborator for Maket. The skill orients Claude toward `maket_learn`, then Claude composes HTML/CSS documents through MCP tools.

## What's included

| Type | Name | Description |
|------|------|-------------|
| **Skill** | `maket` | Auto-triggers when the user asks to create a visual document. Calls `maket_learn` for live workflow and composition guidance. |
| **Command** | `/maket` | Guided document creation from a creative brief. Starts with `maket_learn`, then checks assets/chartes, composes, iterates, exports. |

## Installation

### Prerequisites

Maket MCP server must be running — either via `.mcpb` in Claude Desktop or via `.mcp.json` in Claude Code.

### Install the plugin

```bash
# From Claude Code, use the /install-plugin command
# or copy the plugin/claude/ directory to your project's .claude/plugins/
cp -r plugin/claude/ .claude/plugins/maket/
```

## Usage

### Auto-trigger (skill)

Just describe what you want:

> "Create an A3 poster for a jazz festival on June 21st at Parc de la Tete d'Or"

Claude will automatically activate the maket skill, call `maket_learn`, and follow the structured workflow.

### Explicit command

```
/maket A4 flyer for a summer reading program at the municipal library
```

### What happens

1. Claude reads Maket guidance with `maket_learn`
2. Claude analyzes your brief (format, hierarchy, tone)
3. Reads brand charte if one exists (`maket_charte view`)
4. Creates the document and composes the layout with `maket_html set`
5. Opens live preview (`maket_preview open`)
6. Iterates with `maket_html patch` based on user feedback (`maket_workspace list_messages`)
7. Exports as PDF or standalone HTML

## Plugin structure

```
plugin/claude/
├── commands/
│   └── maket.md
├── skills/
│   ├── maket/
│   ├── maket-charte/
│   └── maket-review/
└── README.md
```
