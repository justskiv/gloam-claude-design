# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-31

### Added

- Initial release: a native-looking dark theme for the Claude Design
  (`claude.ai/design`) native panels.
- Toolbar toggle to enable/disable the theme; state persists across sessions.
- Value-based, role-aware color remap that survives styled-components class
  churn across Claude builds, plus a luminance fallback for shades not in the
  token table.
- The cross-origin design preview iframe is never touched; turning the
  extension off restores the page byte-for-byte.
