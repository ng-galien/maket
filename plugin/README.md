# Maket — Claude Code Plugin

Turns Claude into a visual design director. Claude composes HTML/CSS documents with typographic hierarchy, brand chartes, and a structured design workflow.

## What's included

| Type | Name | Description |
|------|------|-------------|
| **Skill** | `maket` | Auto-triggers when the user asks to create a visual document. Encodes design principles, composition rules, and workflow. |
| **Command** | `/maket` | Guided document creation from a creative brief. Analyze brief, check assets/chartes, compose, iterate, export. |

## Installation

### Prerequisites

Maket MCP server must be running — either via `.mcpb` in Claude Desktop or via `.mcp.json` in Claude Code.

### Install the plugin

```bash
# From Claude Code, use the /install-plugin command
# or copy the plugin/ directory to your project's .claude/plugins/
cp -r plugin/ .claude/plugins/maket/
```

## Usage

### Auto-trigger (skill)

Just describe what you want:

> "Create an A3 poster for a jazz festival on June 21st at Parc de la Tete d'Or"

Claude will automatically activate the maket skill and follow the structured workflow.

### Explicit command

```
/maket A4 flyer for a summer reading program at the municipal library
```

### What happens

1. Claude analyzes your brief (format, hierarchy, tone)
2. Reads brand charte if one exists (`maket_charte view`)
3. Creates the document and composes the layout with `maket_html set`
4. Opens live preview (`maket_preview open`)
5. Iterates with `maket_html patch` based on user feedback (`maket_message list`)
6. Exports as PDF or standalone HTML

## Plugin structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── commands/
│   └── maket.md
├── skills/
│   └── maket/
│       ├── SKILL.md
│       └── references/
│           ├── layout-patterns.md
│           └── typography.md
└── README.md
```
