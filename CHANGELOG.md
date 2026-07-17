# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial public release of the MCP server and TypeScript SDK for syntx.ai.
- 19 MCP tools covering identity, AI catalog, chats/messaging, image
  generation, account, and file management.
- 6 resources + 1 resource template (models, plans, user, settings, …).
- 4 prompt templates (`generate-landing`, `summarize-chat`, `translate`,
  `code-review`).
- Dual stdio and HTTP/SSE transports.

### Security
- New `upload-files` tool for path- and base64-based file uploads (no
  credentials are stored in scripts after this refactor — see `CONTRIBUTING.md`).

## [0.1.0] — 2025-01-XX

### Added
- First published version: MCP server + TypeScript SDK for syntx.ai.

[Unreleased]: https://example.com/syntx-ai-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/syntx-ai-mcp/releases/tag/v0.1.0
