# AWS Docs PI Extension

Adapted by [aws-labs](https://github.com/awslabs/mcp)

Pi extension that provides AWS documentation tools:

- `aws_docs_search`
- `aws_docs_read`
- `aws_docs_read_sections`
- `aws_docs_recommend`

This v1 intentionally uses a Python helper for HTML->Markdown and section extraction to mirror AWS MCP behavior closely.

## Install

### Option 1: Install as a pi package from git

```bash
pi install git:github.com/dougefresher/pi-ext-awsdocs
```

Or add it to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "git:github.com/dougefresher/pi-ext-awsdocs"
  ]
}
```

### Option 2: Arch Linux (AUR)

```bash
paru pi-ext-aws-docs
```

## Runtime Requirements

- `python3`
- Python modules:
  - `bs4` (beautifulsoup4)
  - `markdownify`

### Arch Linux install

```bash
sudo pacman -S python-beautifulsoup4 python-markdownify
```

## Environment Variables

- `AWS_DOCUMENTATION_PARTITION=aws|aws-cn` (default: `aws`)
- `MCP_USER_AGENT=...` override HTTP User-Agent
- `AWS_DOCS_PYTHON_BIN=python3` override Python executable path

## Self-test (hidden command)

This extension includes a hidden input command:

```bash
/aws-docs-selftest
```

It is intentionally implemented via input interception (not command registration), so it won't appear in slash command lists.

## How to load in pi

Place this extension in one of:

- `~/.pi/agent/extensions/aws-docs/index.ts`
- `.pi/extensions/aws-docs/index.ts`

(or use `pi -e /path/to/index.ts` for testing)
