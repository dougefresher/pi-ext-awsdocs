# AWS Docs PI Extension

Adapted by [aws-labs](https://github.com/awslabs/mcp)

Pi extension that provides AWS documentation tools:

- `aws_docs_search`
- `aws_docs_read`
- `aws_docs_read_sections`
- `aws_docs_recommend`

`aws_docs_read` and `aws_docs_read_sections` fetch the native `.md` mirror AWS docs serves for most `docs.aws.amazon.com`/`docs.amazonaws.cn` pages (same URL, `.html` swapped for `.md`) — no HTML parsing needed for those. The Python helper (HTML->Markdown via BeautifulSoup/markdownify) is only invoked as a fallback for pages without a markdown mirror, e.g. Neuron SDK docs (`awsdocs-neuron.readthedocs-hosted.com`, a separate ReadTheDocs/Sphinx site).

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

- `python3` — only needed for pages without a `.md` mirror (currently just Neuron SDK docs). `aws_docs_read`/`aws_docs_read_sections` work without it for the vast majority of `docs.aws.amazon.com`/`docs.amazonaws.cn` pages.
- Python modules (only used on the fallback path):
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

### aws-cn caveat

Setting `AWS_DOCUMENTATION_PARTITION=aws-cn` only changes URL validation for `aws_docs_read` (accepts `docs.amazonaws.cn` instead of `docs.aws.amazon.com`). Unlike upstream awslabs-mcp, which runs aws-cn as a separate server exposing only `read_documentation` + `get_available_services`, all four tools stay registered here. `aws_docs_search`, `aws_docs_read_sections`, and `aws_docs_recommend` still call the commercial-partition search/recommendations APIs, which have no China equivalent — they will not return useful results against `docs.amazonaws.cn` content. There is also no `get_available_services` equivalent (AWS China service-availability listing) in this extension.

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
